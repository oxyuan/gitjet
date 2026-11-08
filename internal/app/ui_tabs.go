package app

import (
	"encoding/base64"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

func (t *docTab) dirty() bool {
	return t.src != nil && t.src.Buffer != nil && t.src.Buffer.Modified()
}

func (a *nativeApp) findTab(id string) int {
	for i, t := range a.tabs {
		if t.id == id {
			return i
		}
	}
	return -1
}

func (a *nativeApp) activateTab(i int) {
	if i >= 0 && i < len(a.tabs) {
		a.activeTab = i
	}
}

func (a *nativeApp) closeTab(i int) {
	if i < 0 || i >= len(a.tabs) {
		return
	}
	tab := a.tabs[i]
	if tab.kind == tabSource && a.lsp != nil {
		a.lsp.didClose(tab)
	}
	if tab.dirty() {
		a.dialog = dialogState{kind: dialogConfirm, title: a.t("Unsaved changes"), message: a.t("Close without saving?"), tabIndex: i, action: "close-tab"}
		return
	}
	a.tabs = append(a.tabs[:i], a.tabs[i+1:]...)
	if a.activeTab >= len(a.tabs) {
		a.activeTab = len(a.tabs) - 1
	}
	if a.activeTab < 0 {
		a.activeTab = 0
	}
}

func (a *nativeApp) closeOtherTabs(i int) {
	if i < 0 || i >= len(a.tabs) {
		return
	}
	keep := a.tabs[i]
	var out []*docTab
	for _, t := range a.tabs {
		if t == keep || t.dirty() {
			out = append(out, t)
		}
	}
	a.tabs = out
	a.activeTab = a.findTab(keep.id)
}

func (a *nativeApp) closeActiveTab() {
	a.closeTab(a.activeTab)
}

// openDiff opens and loads a diff tab.
func (a *nativeApp) openDiff(opts git.DiffOptions) {
	if strings.TrimSpace(opts.Path) == "" {
		return
	}
	if !opts.IgnoreWhitespace {
		opts.IgnoreWhitespace = a.settings.IgnoreWhitespace
	}
	if opts.Context == 0 {
		opts.Context = a.settings.DiffContext
	}
	id := fmt.Sprintf("diff:%s:%s:%s", opts.Target, opts.Revision, opts.Path)
	if i := a.findTab(id); i >= 0 {
		a.activeTab = i
		a.redraw()
		return
	}
	tab := &docTab{kind: tabDiff, id: id, title: opts.Path, path: opts.Path, revision: opts.Revision, opts: opts}
	a.tabs = append(a.tabs, tab)
	a.activeTab = len(a.tabs) - 1
	a.loadDiff(tab)
}

func (a *nativeApp) loadDiff(tab *docTab) {
	opts := tab.opts
	go func() {
		fd, err := a.g.Diff(opts)
		if err == nil && !fd.Binary && !a.isImage(fd.Path) {
			fd = a.fillDiffTexts(fd, opts)
		}
		mygoMain(func() {
			if err != nil {
				tab.err = err.Error()
				a.redraw()
				return
			}
			a.buildDiff(tab, fd)
			a.redraw()
		})
	}()
}

// fillDiffTexts gives a worktree or index diff the full texts its viewer
// compares. git's own diff for those targets is a patch only.
func (a *nativeApp) fillDiffTexts(fd git.FileDiff, opts git.DiffOptions) git.FileDiff {
	if fd.OldText != "" || fd.NewText != "" {
		return fd
	}
	oldPath := fd.Path
	if fd.OldPath != "" {
		oldPath = fd.OldPath
	}
	read := func(path, rev string) string {
		if path == "" || rev == "empty" {
			return ""
		}
		f, err := a.g.File(path, rev)
		if err != nil || f.Binary || !f.Exists {
			return ""
		}
		return f.Text
	}
	switch opts.Target {
	case git.DiffWorkingTree:
		fd.OldText = read(oldPath, "INDEX")
		if fd.OldText == "" {
			fd.OldText = read(oldPath, "HEAD")
		}
		fd.NewText = read(fd.Path, "")
	case git.DiffStaged:
		fd.OldText = read(oldPath, "HEAD")
		fd.NewText = read(fd.Path, "INDEX")
	case git.DiffHead:
		fd.OldText = read(oldPath, "HEAD")
		fd.NewText = read(fd.Path, "")
	case git.DiffCommit:
		fd.OldText = read(oldPath, opts.Revision+"^")
		fd.NewText = read(fd.Path, opts.Revision)
	case git.DiffRange:
		fd.OldText = read(oldPath, opts.From)
		fd.NewText = read(fd.Path, opts.Revision)
	}
	return fd
}

func (a *nativeApp) buildDiff(tab *docTab, fd git.FileDiff) {
	tab.loaded = true
	tab.err = ""
	if fd.Binary || a.isImage(fd.Path) {
		tab.binary = true
		if a.isImage(fd.Path) {
			a.loadDiffImage(tab, fd)
		}
		return
	}
	old := editor.NewBuffer(fd.OldText)
	newBuf := editor.NewBuffer(fd.NewText)
	lang := editor.LanguageFor(fd.Path)
	if lang == nil && fd.Language != "" {
		lang = editor.LanguageNamed(fd.Language)
	}
	old.SetLanguage(lang)
	newBuf.SetLanguage(lang)
	st := &editor.DiffState{
		Old:           old,
		New:           newBuf,
		Editable:      false,
		Inline:        editor.DiffInlineWord,
		LineSelection: true,
		Wrap:          a.diffWrap(tab),
	}
	st.OnLineSelection = func(r editor.DiffLineRange) {
		tab.selStart, tab.selEnd, tab.selSide, tab.hasSel = r.Start, r.End, r.Side, true
	}
	if a.settings.DiffContext < 0 {
		st.ExpandUnchanged = true
	} else {
		st.ContextLines = a.settings.DiffContext
	}
	st.Theme = editor.DefaultTheme(ui.LightTheme())
	st.RenderAnnotation = a.renderDiffAnnotation
	tab.diff = st
	tab.title = fd.Path
	a.loadDiffBlame(tab)
}

type diffBlameKey struct {
	tab  *docTab
	old  bool
	line int
}

// loadDiffBlame annotates the diff's two sides with the commits that last
// changed each line: the index and working tree, or the two revisions.
func (a *nativeApp) loadDiffBlame(tab *docTab) {
	oldPath := tab.path
	if tab.opts.OldPath != "" {
		oldPath = tab.opts.OldPath
	}
	oldRev, newRev := "", ""
	switch tab.opts.Target {
	case git.DiffWorkingTree:
		oldRev, newRev = "INDEX", ""
	case git.DiffStaged:
		oldRev, newRev = "HEAD", "INDEX"
	case git.DiffHead:
		oldRev, newRev = "HEAD", ""
	case git.DiffCommit:
		oldRev, newRev = tab.opts.Revision+"^", tab.opts.Revision
	case git.DiffRange:
		oldRev, newRev = tab.opts.From, tab.opts.Revision
	}
	opts := git.BlameOptions{IgnoreWhitespace: a.settings.IgnoreWhitespace}
	if oldRev != "" {
		go func() {
			res, err := a.g.Blame(oldPath, oldRev, opts)
			if err == nil {
				mygoMain(func() {
					tab.blameOld = res.Lines
					a.redraw()
				})
			}
		}()
	}
	go func() {
		res, err := a.g.Blame(tab.path, newRev, opts)
		if err == nil {
			mygoMain(func() {
				tab.blameNew = res.Lines
				a.redraw()
			})
		}
	}()
}

func (a *nativeApp) renderDiffAnnotation(c *ui.Context, ann editor.DiffAnnotation) {
	key, ok := ann.Key.(diffBlameKey)
	if !ok || key.tab == nil {
		return
	}
	var line git.BlameLine
	lines := key.tab.blameNew
	if key.old {
		lines = key.tab.blameOld
	}
	if key.line < 0 || key.line >= len(lines) {
		return
	}
	line = lines[key.line]
	t := c.Theme()
	row := ui.Row(c).Height(ann.Height).Padding(0, 6).Gap(6).AlignItems(ui.Center)
	row.Children(func() {
		name := line.Author
		if line.Uncommitted {
			name = a.t("You · uncommitted")
		}
		ui.Text(c, a.stamp(line.Time)).FontSize(9).TextColor(t.TextMuted)
		ui.Text(c, name).FontSize(9).TextColor(t.TextMuted).MaxLines(1)
		ui.Text(c, line.Short).FontSize(9).Font("monospace").TextColor(t.Accent)
		ui.Text(c, line.Summary).FontSize(9).TextColor(t.TextMuted).MaxLines(1)
	})
	row.ContextMenu(func(m *ui.Menu) {
		if m.Item(a.t("Show Commit")).Chosen() {
			a.openCommitTab(line.Commit)
		}
		if m.Item(a.t("Show File at This Commit")).Chosen() {
			a.openSource(key.tab.path, line.Commit)
		}
		if m.Item(a.t("History of This Line")).Chosen() {
			a.showLineHistory(key.tab.path, key.line+1)
		}
		if m.Item(a.t("Copy Revision Number")).Chosen() {
			a.copyText(line.Commit)
		}
	})
}

func (a *nativeApp) loadDiffImage(tab *docTab, fd git.FileDiff) {
	oldPath := fd.Path
	if fd.OldPath != "" {
		oldPath = fd.OldPath
	}
	oldRev, newRev := "", ""
	switch tab.opts.Target {
	case git.DiffWorkingTree:
		oldRev, newRev = "INDEX", ""
	case git.DiffStaged:
		oldRev, newRev = "HEAD", "INDEX"
	case git.DiffHead:
		oldRev, newRev = "HEAD", ""
	case git.DiffCommit:
		oldRev, newRev = tab.opts.Revision+"^", tab.opts.Revision
	case git.DiffRange:
		oldRev, newRev = tab.opts.From, tab.opts.Revision
	}
	load := func(path, rev string) ui.ImageSource {
		if rev == "empty" {
			return nil
		}
		img, err := a.g.Image(path, rev)
		if err != nil {
			return nil
		}
		data, err := base64.StdEncoding.DecodeString(img.Data)
		if err != nil {
			return nil
		}
		src, _ := ui.DecodeImage(data)
		return src
	}
	go func() {
		oldSrc := load(oldPath, oldRev)
		newSrc := load(tab.path, newRev)
		mygoMain(func() {
			tab.imageOld = oldSrc
			tab.imageNew = newSrc
			if newSrc != nil {
				tab.image = newSrc
			} else {
				tab.image = oldSrc
			}
			a.redraw()
		})
	}()
}

func (a *nativeApp) diffWrap(tab *docTab) bool {
	return true
}

// openSource opens a file at a revision: "" for the working tree, "INDEX"
// for the index, or a commit.
func (a *nativeApp) openSource(path, revision string) {
	if strings.TrimSpace(path) == "" {
		return
	}
	id := "file:" + revision + ":" + path
	if i := a.findTab(id); i >= 0 {
		a.activeTab = i
		a.redraw()
		return
	}
	tab := &docTab{kind: tabSource, id: id, title: path, path: path, revision: revision}
	a.tabs = append(a.tabs, tab)
	a.activeTab = len(a.tabs) - 1
	a.loadSource(tab)
	if revision == "" {
		a.ensureLSP()
	}
}

func (a *nativeApp) newSourceState(tab *docTab) *editor.State {
	buf := editor.NewBuffer(tab.file.Text)
	if lang := editor.LanguageFor(tab.path); lang != nil {
		buf.SetLanguage(lang)
	}
	readOnly := tab.revision != ""
	st := &editor.State{Buffer: buf, ReadOnly: readOnly, LineHeight: 1.5}
	if tab.base != nil {
		if lang := editor.LanguageFor(tab.path); lang != nil {
			tab.base.SetLanguage(lang)
		}
		st.DiffBase = tab.base
	}
	path := tab.path
	st.OnDefinition = func(off int) { a.jumpToDefinition(tab, off) }
	st.OnHover = func(r editor.HoverRequest) { a.hover(tab, r) }
	st.OnCompletion = func(r editor.CompletionRequest) { a.complete(tab, r) }
	st.OnGutterClick = func(line int) { a.gutterMenu(tab, line) }
	st.ContextMenu = func(m *ui.Menu) {
		pos := st.CursorPos()
		a.pathMenu(m, path, pos.Line+1)
		m.Separator()
		if m.Item(a.t("Show History")).Chosen() {
			a.showFileHistory(path)
		}
		m.EditItems()
	}
	return st
}

func (a *nativeApp) loadSource(tab *docTab) {
	path, rev := tab.path, tab.revision
	go func() {
		file, err := a.g.File(path, rev)
		var base *editor.Buffer
		if rev == "" && err == nil && !file.Binary {
			if idx, berr := a.g.File(path, "INDEX"); berr == nil && !idx.Binary && idx.Exists {
				base = editor.NewBuffer(idx.Text)
			} else if head, herr := a.g.File(path, "HEAD"); herr == nil && !head.Binary && head.Exists {
				base = editor.NewBuffer(head.Text)
			}
		}
		mygoMain(func() {
			if err != nil {
				tab.err = err.Error()
				a.redraw()
				return
			}
			tab.file = file
			tab.binary = file.Binary
			tab.missing = !file.Exists
			tab.truncated = file.Truncated
			tab.fileSize = file.Size
			if file.Binary {
				if a.isImage(path) {
					a.loadSourceImage(tab)
				}
				a.redraw()
				return
			}
			tab.base = base
			if tab.src != nil && tab.gotoLine > 0 {
				tab.src.GoTo(editor.Pos{Line: tab.gotoLine - 1})
				tab.src.ScrollTo(tab.gotoLine - 1)
			}
			a.loadBlame(tab)
			a.redraw()
		})
	}()
}

func (a *nativeApp) loadSourceImage(tab *docTab) {
	path, rev := tab.path, tab.revision
	go func() {
		img, err := a.g.Image(path, rev)
		var src ui.ImageSource
		if err == nil {
			data, decErr := base64.StdEncoding.DecodeString(img.Data)
			if decErr == nil {
				src, _ = ui.DecodeImage(data)
			}
		}
		mygoMain(func() {
			if err != nil {
				tab.err = err.Error()
			}
			tab.image = src
			a.redraw()
		})
	}()
}

func (a *nativeApp) loadBlame(tab *docTab) {
	if tab == nil || tab.kind != tabSource || tab.binary {
		return
	}
	path, rev := tab.path, tab.revision
	ignore := tab.blameIgnore
	go func() {
		br, err := a.g.Blame(path, rev, git.BlameOptions{IgnoreWhitespace: ignore})
		mygoMain(func() {
			if err == nil {
				tab.blame = br.Lines
			}
			a.redraw()
		})
	}()
}

func (a *nativeApp) tabView(c *ui.Context, tab *docTab) {
	switch tab.kind {
	case tabDiff:
		a.diffView(c, tab)
	case tabSource:
		a.sourceView(c, tab)
	case tabRevisionTree:
		a.revisionTreeView(c, tab)
	}
}

func (a *nativeApp) diffView(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		a.diffToolbar(c, tab)
		if tab.err != "" {
			ui.Text(c, tab.err).TextColor(t.Danger).Padding(12)
			return
		}
		if tab.binary {
			if tab.imageOld != nil || tab.imageNew != nil {
				a.imageDiffView(c, tab)
			} else {
				ui.Column(c).Fill().Center().Children(func() {
					ui.Text(c, fmt.Sprintf("%s · %d bytes", a.t("Binary file"), tab.fileSize)).FontSize(12).TextColor(t.TextMuted)
				})
			}
			return
		}
		if tab.diff == nil || !tab.loaded {
			ui.Row(c).Padding(12).Gap(8).Children(func() { ui.Spinner(c); ui.Text(c, a.t("Loading diff")) })
			return
		}
		tab.diff.Theme = editor.DefaultTheme(t)
		tab.diff.Wrap = a.diffWrap(tab)
		tab.diff.Annotations = tab.diff.Annotations[:0]
		if tab.diffBlameOn {
			for i := range tab.blameOld {
				tab.diff.Annotations = append(tab.diff.Annotations, editor.DiffAnnotation{Side: editor.DiffOld, Line: i, Height: 15, Key: diffBlameKey{tab: tab, old: true, line: i}})
			}
			for i := range tab.blameNew {
				tab.diff.Annotations = append(tab.diff.Annotations, editor.DiffAnnotation{Side: editor.DiffNew, Line: i, Height: 15, Key: diffBlameKey{tab: tab, line: i}})
			}
		}
		editor.DiffView(c, tab.diff).Grow(1).FillWidth()
	})
}

func (a *nativeApp) imageDiffView(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Padding(6, 10).Gap(8).Children(func() {
			ui.Segmented(c, &tab.imageMode, a.t("Side by side"), a.t("Overlay"))
			if tab.imageMode == 1 {
				ui.Text(c, a.t("Opacity")).FontSize(10).TextColor(t.TextMuted)
				ui.Slider(c, &tab.imageAlpha, 0, 1).Width(160)
			}
			ui.Spacer(c).Grow(1)
			if tab.imageOld == nil {
				ui.Text(c, a.t("No image in this version")).FontSize(10).TextColor(t.TextMuted)
			}
		})
		if tab.imageMode == 1 {
			ui.Box(c).Grow(1).Fill().Children(func() {
				if tab.imageOld != nil {
					ui.Image(c, tab.imageOld).Fit(ui.Contain).Grow(1).FillWidth()
				}
				if tab.imageNew != nil {
					img := ui.Image(c, tab.imageNew).Fit(ui.Contain).Absolute().Left(0).Top(0).Fill()
					img.Opacity(float32(tab.imageAlpha))
				}
			})
			return
		}
		ui.Row(c).Grow(1).AlignItems(ui.Stretch).Children(func() {
			ui.Column(c).Grow(1).BorderWidth(0, 1, 0, 0).BorderColor(t.Border).Children(func() {
				ui.Text(c, a.t("Before")).FontSize(10).TextColor(t.TextMuted).Padding(6)
				if tab.imageOld != nil {
					ui.Image(c, tab.imageOld).Fit(ui.Contain).Grow(1).FillWidth()
				} else {
					ui.Spacer(c).Grow(1)
				}
			})
			ui.Column(c).Grow(1).Children(func() {
				ui.Text(c, a.t("After")).FontSize(10).TextColor(t.TextMuted).Padding(6)
				if tab.imageNew != nil {
					ui.Image(c, tab.imageNew).Fit(ui.Contain).Grow(1).FillWidth()
				} else {
					ui.Spacer(c).Grow(1)
				}
			})
		})
	})
}

func (a *nativeApp) diffToolbar(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Row(c).Padding(6, 10).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Text(c, filepath.Base(tab.path)).FontSize(12).FontWeight(600)
		switch tab.opts.Target {
		case git.DiffWorkingTree, git.DiffStaged, git.DiffHead:
			if ui.Button(c, a.t("Index ↔ Worktree")).Clicked() {
				a.openDiff(git.DiffOptions{Path: tab.path, OldPath: tab.opts.OldPath, Target: git.DiffWorkingTree, Context: a.settings.DiffContext})
			}
			if ui.Button(c, a.t("HEAD ↔ Index")).Clicked() {
				a.openDiff(git.DiffOptions{Path: tab.path, OldPath: tab.opts.OldPath, Target: git.DiffStaged, Context: a.settings.DiffContext})
			}
			if ui.Button(c, a.t("HEAD ↔ Worktree")).Clicked() {
				a.openDiff(git.DiffOptions{Path: tab.path, OldPath: tab.opts.OldPath, Target: git.DiffHead, Context: a.settings.DiffContext})
			}
		}
		if tab.opts.OldPath != "" && tab.opts.OldPath != tab.path {
			ui.Text(c, "← "+tab.opts.OldPath).FontSize(10).TextColor(t.TextMuted)
		}
		if tab.diff != nil {
			add, del := tab.diff.Stats()
			ui.Text(c, fmt.Sprintf("+%d −%d", add, del)).FontSize(10).TextColor(t.TextMuted)
		}
		ui.Spacer(c).Grow(1)
		layout := 0
		if tab.diff != nil && tab.diff.Layout == editor.DiffUnified {
			layout = 1
		}
		if ui.Segmented(c, &layout, a.t("Split"), a.t("Unified")).Changed() {
			if tab.diff != nil {
				if layout == 0 {
					tab.diff.Layout = editor.DiffSplit
				} else {
					tab.diff.Layout = editor.DiffUnified
				}
			}
		}
		ignore := a.settings.IgnoreWhitespace
		if ui.Checkbox(c, &ignore, a.t("Ignore whitespace")).Changed() {
			a.settings.IgnoreWhitespace = ignore
			tab.opts.IgnoreWhitespace = ignore
			a.loadDiff(tab)
		}
		if tab.diff != nil {
			if i, inside := tab.diff.CurrentHunk(); inside {
				if ui.Button(c, "↑").Clicked() {
					tab.diff.GoToHunk(i - 1)
				}
				if ui.Button(c, "↓").Clicked() {
					tab.diff.GoToHunk(i + 1)
				}
				ui.Text(c, fmt.Sprintf("%d/%d", i+1, len(tab.diff.Hunks()))).FontSize(10).TextColor(t.TextMuted)
			} else if n := len(tab.diff.Hunks()); n > 0 {
				if ui.Button(c, "↑").Clicked() {
					tab.diff.GoToHunk(n - 1)
				}
				if ui.Button(c, "↓").Clicked() {
					tab.diff.GoToHunk(0)
				}
				ui.Text(c, fmt.Sprintf("0/%d", n)).FontSize(10).TextColor(t.TextMuted)
			}
		}
		target := tab.opts.Target
		if target == git.DiffWorkingTree || target == git.DiffStaged {
			action := a.applyAction(tab)
			fileLabel, hunkLabel, linesLabel := a.t("Stage File"), a.t("Stage Hunk"), a.t("Stage Lines")
			if action == "unstage" {
				fileLabel, hunkLabel, linesLabel = a.t("Unstage File"), a.t("Unstage Hunk"), a.t("Unstage Lines")
			}
			if ui.Button(c, fileLabel).Clicked() {
				a.diffAction(tab, -1, nil, action)
			}
			if target == git.DiffWorkingTree && ui.Button(c, a.t("Rollback File")).Clicked() {
				a.diffAction(tab, -1, nil, "rollback")
			}
			if tab.diff != nil {
				if i, inside := tab.diff.CurrentHunk(); inside {
					if ui.Button(c, hunkLabel).Clicked() {
						a.diffAction(tab, i, nil, action)
					}
					if target == git.DiffWorkingTree && ui.Button(c, a.t("Rollback Hunk")).Clicked() {
						a.diffAction(tab, i, nil, "rollback")
					}
				}
				if tab.hasSel {
					if ui.Button(c, linesLabel).Clicked() {
						a.diffAction(tab, -1, selectedLines(tab), action)
					}
					if target == git.DiffWorkingTree && ui.Button(c, a.t("Rollback Lines")).Clicked() {
						a.diffAction(tab, -1, selectedLines(tab), "rollback")
					}
				}
			}
		}
		blame := tab.diffBlameOn
		if ui.Checkbox(c, &blame, a.t("Annotate")).Changed() {
			tab.diffBlameOn = blame
		}
		if ui.Button(c, a.t("Open File")).Clicked() {
			a.openSource(tab.path, tab.revision)
		}
		if target != git.DiffCommit && target != git.DiffRange {
			if ui.Button(c, a.t("Diff Tool")).Clicked() {
				a.externalDiff(tab.opts)
			}
		}
		if ui.Button(c, a.t("Copy Path")).Clicked() {
			a.copyText(tab.path)
		}
	})
}

func (a *nativeApp) sourceView(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		a.sourceToolbar(c, tab)
		if tab.err != "" {
			ui.Text(c, tab.err).TextColor(t.Danger).Padding(12)
			return
		}
		if tab.missing {
			ui.Text(c, a.t("File does not exist in this revision")).TextColor(t.TextMuted).Padding(12)
			return
		}
		if tab.binary {
			if tab.image != nil {
				ui.Column(c).Fill().Center().Children(func() {
					ui.Image(c, tab.image).Fit(ui.Contain).Grow(1).MaxWidth(900)
				})
			} else {
				ui.Text(c, fmt.Sprintf("%s · %d bytes", a.t("Binary file"), tab.fileSize)).TextColor(t.TextMuted).Padding(12)
			}
			return
		}
		if tab.src == nil {
			if tab.file.Exists {
				tab.src = a.newSourceState(tab)
				if tab.gotoLine > 0 {
					tab.src.GoTo(editor.Pos{Line: tab.gotoLine - 1})
					tab.src.ScrollTo(tab.gotoLine - 1)
					tab.gotoLine = 0
				}
				if a.lsp != nil {
					a.lsp.didOpen(tab)
					if ds := a.lsp.diags[tab.path]; len(ds) > 0 {
						tab.src.SetDiagnostics(tab.src.Buffer.Version(), ds)
					}
				}
			} else {
				ui.Row(c).Padding(12).Gap(8).Children(func() { ui.Spinner(c); ui.Text(c, a.t("Loading file")) })
				return
			}
		}
		if tab.blameOn {
			ui.Row(c).Fill().AlignItems(ui.Stretch).Children(func() {
				a.blameColumn(c, tab)
				tab.src.Theme = editor.DefaultTheme(t)
				editor.View(c, tab.src).Grow(1).FillWidth()
			})
			return
		}
		tab.src.Theme = editor.DefaultTheme(t)
		a.setBlameInlay(tab)
		if a.lsp != nil {
			a.lsp.sync(tab)
		}
		editor.View(c, tab.src).Grow(1).FillWidth()
	})
}

// setBlameInlay shows the commit that last changed the cursor line at the
// end of it, as the IDE's inline blame does.
func (a *nativeApp) setBlameInlay(tab *docTab) {
	if tab.src == nil || len(tab.blame) == 0 {
		return
	}
	pos := tab.src.CursorPos()
	if pos.Line < 0 || pos.Line >= len(tab.blame) {
		tab.src.SetInlays(nil)
		return
	}
	l := tab.blame[pos.Line]
	start := tab.src.Buffer.Offset(editor.Pos{Line: pos.Line})
	end := start + len(tab.src.Buffer.Line(pos.Line))
	label := fmt.Sprintf("  %s · %s · %s", l.Author, l.Short, a.stamp(l.Time))
	if l.Uncommitted {
		label = "  " + a.t("You · uncommitted")
	}
	tab.src.SetInlays([]editor.Inlay{{Offset: end, Text: label}})
}

func (a *nativeApp) sourceToolbar(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Row(c).Padding(6, 10).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		rev := tab.revision
		if rev == "" {
			rev = a.t("Working Tree")
		} else if rev == "INDEX" {
			rev = a.t("Index")
		} else if len(rev) > 10 {
			rev = rev[:10]
		}
		ui.Text(c, filepath.Base(tab.path)).FontSize(12).FontWeight(600)
		ui.Text(c, rev).FontSize(10).TextColor(t.TextMuted)
		if tab.src != nil && tab.src.Buffer.Modified() {
			ui.Text(c, "●").FontSize(9).TextColor(t.Warning)
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Working Tree")).Clicked() {
			a.openSource(tab.path, "")
		}
		if ui.Button(c, a.t("Index")).Clicked() {
			a.openSource(tab.path, "INDEX")
		}
		if ui.Button(c, "HEAD").Clicked() {
			a.openSource(tab.path, "HEAD")
		}
		if tab.src != nil {
			wrap := tab.src.SoftWrap
			if ui.Checkbox(c, &wrap, a.t("Wrap")).Changed() {
				tab.src.SoftWrap = wrap
			}
		}
		if tab.src != nil {
			if ui.Button(c, "↑").Clicked() {
				tab.src.Run(editor.PreviousHunk)
			}
			if ui.Button(c, "↓").Clicked() {
				tab.src.Run(editor.NextHunk)
			}
		}
		if tab.revision == "" {
			if ui.Button(c, a.t("Save")).Clicked() {
				a.saveSource(tab)
			}
			if ui.Button(c, a.t("Show Diff")).Clicked() {
				a.openDiff(git.DiffOptions{Path: tab.path, Target: git.DiffWorkingTree, Context: a.settings.DiffContext})
			}
		}
		blame := tab.blameOn
		if ui.Checkbox(c, &blame, a.t("Annotate")).Changed() {
			tab.blameOn = blame
		}
		if tab.revision == "" {
			ignoreWs := tab.blameIgnore
			if ui.Checkbox(c, &ignoreWs, a.t("Ignore whitespace")).Changed() {
				tab.blameIgnore = ignoreWs
				a.loadBlame(tab)
			}
		}
		if ui.Button(c, a.t("History")).Clicked() {
			a.openLocalHistory(tab)
		}
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeActiveTab()
		}
	})
}

// blameColumn paints the blame annotation column beside the source editor.
// It follows the editor's own scroll: LineTop and ScrollY are the last
// frame's geometry.
func (a *nativeApp) blameColumn(c *ui.Context, tab *docTab) {
	t := c.Theme()
	width := float32(180)
	box := ui.Box(c).Width(width).FillHeight().Background(t.Surface).Clip()
	box.BorderWidth(0, 1, 0, 0).BorderColor(t.Border)
	box.Children(func() {
		if tab.src == nil || len(tab.blame) == 0 {
			return
		}
		lineH := tab.src.LineTop(1) - tab.src.LineTop(0)
		if lineH <= 0 {
			lineH = 19.5
		}
		scroll := float32(tab.src.ScrollY())
		first := int(scroll/float32(lineH)) - 1
		if first < 0 {
			first = 0
		}
		last := first + 90
		if last >= len(tab.blame) {
			last = len(tab.blame) - 1
		}
		font := ui.Font{Size: 10}
		for line := first; line <= last && line < len(tab.blame); line++ {
			l := tab.blame[line]
			y := float32(tab.src.LineTop(line)) - scroll
			row := ui.Box(c).Absolute().Top(y).Left(0).Width(width).Height(float32(lineH)).Padding(0, 6).AlignItems(ui.Center)
			row.Children(func() {
				label := l.Author
				if label == "" {
					label = l.Short
				}
				if l.Uncommitted {
					label = a.t("You · uncommitted")
				}
				ui.Text(c, label).FontSize(font.Size).TextColor(t.TextMuted).MaxLines(1)
			})
			row.ContextMenu(func(m *ui.Menu) {
				a.blameMenu(m, tab, line)
			})
		}
	})
}

func (a *nativeApp) blameMenu(m *ui.Menu, tab *docTab, line int) {
	if line < 0 || line >= len(tab.blame) {
		return
	}
	l := tab.blame[line]
	if m.Item(a.t("Show Commit")).Chosen() {
		a.openCommitTab(l.Commit)
	}
	if m.Item(a.t("Show File at This Commit")).Chosen() {
		a.openSource(tab.path, l.Commit)
	}
	if m.Item(a.t("Show History")).Chosen() {
		a.showLineHistory(tab.path, line+1)
	}
	if m.Item(a.t("Copy Revision Number")).Chosen() {
		a.copyText(l.Commit)
	}
	m.Separator()
	if m.Item(a.t("Close Annotations")).Chosen() {
		tab.blameOn = false
	}
}

func (a *nativeApp) saveSource(tab *docTab) {
	if tab.src == nil || tab.revision != "" {
		return
	}
	text := tab.src.Buffer.String()
	a.busyRun("save", func() error {
		return a.g.SaveFile(tab.path, text)
	})
	tab.src.Buffer.MarkSaved()
	if a.lsp != nil {
		a.lsp.didSave(tab)
	}
	tab.title = tab.path
	a.loadBlame(tab)
	a.redraw()
}

func (a *nativeApp) revisionTreeView(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Padding(6, 10).Gap(8).Children(func() {
			ui.Text(c, tab.revision).FontSize(12).FontWeight(600)
			ui.Spacer(c).Grow(1)
			if ui.Button(c, a.t("Close")).Clicked() {
				a.closeActiveTab()
			}
		})
		list := tab.files
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Gap(1).Children(func() {
				for _, f := range list {
					f := f
					row := ui.ButtonBase(c).Padding(3, 8).Radius(4)
					row.Children(func() { ui.Text(c, f.Path).FontSize(12) })
					if row.Clicked() {
						if tab.from != "" {
							a.openDiff(git.DiffOptions{
								Path:     f.Path,
								Target:   git.DiffRange,
								From:     tab.from,
								Revision: tab.revision,
								Context:  a.settings.DiffContext,
							})
						} else {
							a.openSource(f.Path, tab.revision)
						}
					}
				}
				if len(list) == 0 {
					ui.Text(c, a.t("No files")).TextColor(t.TextMuted).Padding(8)
				}
			})
		})
	})
}

func (a *nativeApp) openBrowseRevisionDialog() {
	a.dialog = dialogState{kind: dialogPrompt, title: a.t("Browse Repository at Revision"), message: a.t("Revision"), action: "browse-revision", text: a.snapshot.State.Head}
}

func (a *nativeApp) openRevisionTree(rev string) {
	if rev == "" {
		return
	}
	id := "tree:" + rev
	if i := a.findTab(id); i >= 0 {
		a.activeTab = i
		return
	}
	tab := &docTab{kind: tabRevisionTree, id: id, title: a.t("Files at ") + rev[:min(8, len(rev))], revision: rev}
	a.tabs = append(a.tabs, tab)
	a.activeTab = len(a.tabs) - 1
	go func() {
		files, err := a.g.TreeAtRevision(rev)
		mygoMain(func() {
			if err != nil {
				tab.err = err.Error()
			}
			tab.files = files
			a.redraw()
		})
	}()
}
