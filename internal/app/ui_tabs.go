package app

import (
	"encoding/base64"
	"fmt"
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
	if tab.dirty() {
		a.dialog = dialogState{kind: dialogConfirm, title: a.t("Unsaved changes"), message: a.t("Close without saving?"), tabIndex: i, action: "close-tab"}
		return
	}
	if tab.kind == tabSource && a.lsp != nil {
		a.lsp.didClose(tab)
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
	tab := &docTab{kind: tabDiff, id: id, title: opts.Path, path: opts.Path, revision: opts.Revision, opts: opts, wrapOn: true}
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
	tab.truncated = fd.Truncated
	tab.status = fd.Status
	if fd.Binary || a.isImage(fd.Path) {
		tab.binary = true
		if a.isImage(fd.Path) {
			a.loadDiffImage(tab, fd)
		}
		return
	}
	if (tab.opts.IgnoreWhitespace || tab.opts.IgnoreWhitespaceEOL) && fd.Patch != "" {
		if patches, err := editor.ParsePatch(fd.Patch); err == nil && len(patches) > 0 {
			st := &editor.DiffState{Editable: false, Inline: editor.DiffInlineWord, LineSelection: true, Wrap: tab.wrapOn}
			st.SetPatch(patches[0])
			st.OnLineSelection = func(r editor.DiffLineRange) {
				tab.selStart, tab.selEnd, tab.selSide, tab.hasSel = r.Start, r.End, r.Side, true
			}
			if a.settings.DiffContext < 0 {
				st.ExpandUnchanged = true
			} else {
				st.ContextLines = a.settings.DiffContext
			}
			st.Theme = editorTheme(gitjetTheme(false))
			st.RenderAnnotation = a.renderDiffAnnotation
			tab.diff = st
			tab.title = fd.Path
			a.loadDiffBlame(tab)
			return
		}
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
	st.Theme = editorTheme(gitjetTheme(false))
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
	return tab.wrapOn
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
		if tab.truncated {
			ui.Text(c, a.t("The file is too large to show whole")).FontSize(10).TextColor(t.Warning).Padding(4, 10)
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
		if n := len(tab.diff.Hunks()); n == 0 {
			ui.Column(c).Fill().Center().Children(func() {
				ui.Text(c, a.t("No differences")).TextColor(t.TextMuted)
			})
			return
		}
		tab.diff.Theme = editorTheme(t)
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
		if tab.diff.Layout == editor.DiffSplit {
			oldLabel, newLabel := a.diffSideLabels(tab)
			ui.Row(c).Height(22).AlignItems(ui.Center).Background(ui.Hex(palette(c.Theme()).panel2)).
				BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(palette(c.Theme()).border)).Children(func() {
				ui.Text(c, oldLabel).FontSize(10.5).TextColor(ui.Hex(palette(c.Theme()).muted)).
					PaddingX(10).WidthPercent(50)
				ui.Box(c).Width(1).FillHeight().Background(ui.Hex(palette(c.Theme()).border))
				ui.Text(c, newLabel).FontSize(10.5).TextColor(ui.Hex(palette(c.Theme()).muted)).PaddingX(10).Grow(1)
			})
		}
		editor.DiffView(c, tab.diff).Grow(1).FillWidth()
	})
}

func (a *nativeApp) diffSideLabels(tab *docTab) (string, string) {
	switch tab.opts.Target {
	case git.DiffWorkingTree:
		return a.t("Index"), a.t("Working Tree")
	case git.DiffStaged:
		return "HEAD", a.t("Index")
	case git.DiffHead:
		return "HEAD", a.t("Working Tree")
	case git.DiffCommit:
		return tab.opts.Revision + "^", tab.opts.Revision
	case git.DiffRange:
		return tab.opts.From, tab.opts.Revision
	}
	return a.t("Before"), a.t("After")
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
	p := palette(c.Theme())
	ui.Column(c).BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
		// Title row: what file, what it changed, and the ways out.
		ui.Row(c).Height(34).Padding(0, 8, 0, 10).Gap(7).AlignItems(ui.Center).Background(ui.Hex(p.panel)).Children(func() {
			status := tab.status
			if status == "" {
				status = "modified"
			}
			ui.Text(c, statusLetterKind(status)).FontSize(11).Font("monospace").FontWeight(700).
				TextColor(statusKindColor(p, status))
			ui.Row(c).TextColor(fileTint(tab.path)).Center().Children(func() {
				a.icon(c, "file", 15)
			})
			ui.Text(c, tab.path).FontSize(12).Font("monospace").TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
			if tab.opts.OldPath != "" && tab.opts.OldPath != tab.path {
				ui.Text(c, "← "+tab.opts.OldPath).FontSize(10.5).TextColor(ui.Hex(p.muted2)).MaxLines(1)
			}
			if tab.diff != nil {
				add, del := tab.diff.Stats()
				ui.Text(c, fmt.Sprintf("+%d", add)).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.added))
				ui.Text(c, fmt.Sprintf("−%d", del)).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.deleted))
			}
			ui.Spacer(c).Grow(1)
			if a.toolbarButton(c, "file", a.t("Open File"), false) {
				a.openSource(tab.path, tab.revision)
			}
			target := tab.opts.Target
			if target != git.DiffCommit && target != git.DiffRange {
				if a.toolbarButton(c, "external", a.t("Diff Tool"), false) {
					a.externalDiff(tab.opts)
				}
			}
			if _, clicked := a.smallIconButton(c, "copy", a.t("Copy Path"), false); clicked {
				a.copyText(tab.path)
			}
			more := ui.ButtonBase(c).Size(26, 26).Radius(4).Center().Tooltip(a.t("Compare"))
			if more.Hovered() {
				more.Background(ui.Hex(p.hover))
			}
			more.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.fgSoft)).Center().Children(func() {
					a.icon(c, "more", 16)
				})
			})
			more.PopoverMenuButton(func(m *ui.Menu) {
				switch target {
				case git.DiffWorkingTree, git.DiffStaged, git.DiffHead:
					if m.Item(a.t("Index ↔ Worktree")).Chosen() {
						a.openDiff(git.DiffOptions{Path: tab.path, OldPath: tab.opts.OldPath, Target: git.DiffWorkingTree, Context: a.settings.DiffContext})
					}
					if m.Item(a.t("HEAD ↔ Index")).Chosen() {
						a.openDiff(git.DiffOptions{Path: tab.path, OldPath: tab.opts.OldPath, Target: git.DiffStaged, Context: a.settings.DiffContext})
					}
					if m.Item(a.t("HEAD ↔ Worktree")).Chosen() {
						a.openDiff(git.DiffOptions{Path: tab.path, OldPath: tab.opts.OldPath, Target: git.DiffHead, Context: a.settings.DiffContext})
					}
					m.Separator()
				}
				if m.Item(a.t("Annotate")).Checked(tab.diffBlameOn).Chosen() {
					tab.diffBlameOn = !tab.diffBlameOn
				}
				if m.Item(a.t("Copy Path")).Chosen() {
					a.copyText(tab.path)
				}
			})
		})
		// Toolbar row: layout, wrapping, whitespace, navigation, staging.
		ui.Row(c).Height(30).PaddingX(6).Gap(2).AlignItems(ui.Center).
			Background(ui.Hex(p.panel2)).BorderWidth(1, 0, 0, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			layout := 0
			if tab.diff != nil && tab.diff.Layout == editor.DiffUnified {
				layout = 1
			}
			if next := a.iconSegment(c, layout, "columns", "rows"); next != layout && tab.diff != nil {
				if next == 0 {
					tab.diff.Layout = editor.DiffSplit
				} else {
					tab.diff.Layout = editor.DiffUnified
				}
			}
			wrap := tab.wrapOn
			if a.toolbarToggle(c, "rows", a.t("Wrap"), wrap) {
				tab.wrapOn = !wrap
			}
			if a.toolbarToggle(c, "eye", a.t("Whitespace"), tab.opts.IgnoreWhitespace) {
				tab.opts.IgnoreWhitespace = !tab.opts.IgnoreWhitespace
				a.loadDiff(tab)
			}
			if a.toolbarToggle(c, "eye", a.t("Ignore EOL"), tab.opts.IgnoreWhitespaceEOL) {
				tab.opts.IgnoreWhitespaceEOL = !tab.opts.IgnoreWhitespaceEOL
				a.loadDiff(tab)
			}
			toolbarRule(c)
			if tab.diff != nil {
				n := len(tab.diff.Hunks())
				i, inside := tab.diff.CurrentHunk()
				if _, clicked := a.smallIconButton(c, "prevDiff", a.t("Previous change"), n == 0); clicked && n > 0 {
					tab.diff.GoToHunk(i - 1)
				}
				if _, clicked := a.smallIconButton(c, "nextDiff", a.t("Next change"), n == 0); clicked && n > 0 {
					tab.diff.GoToHunk(i + 1)
				}
				label := fmt.Sprintf("%d/%d", i+1, n)
				if !inside {
					label = fmt.Sprintf("–/%d", n)
				}
				ui.Text(c, label).FontSize(10.5).TextColor(ui.Hex(p.muted2)).PaddingX(4)
			}
			ui.Spacer(c).Grow(1)
			target := tab.opts.Target
			if target == git.DiffWorkingTree || target == git.DiffStaged {
				action := a.applyAction(tab)
				fileIcon, fileLabel := "stage", a.t("Stage File")
				hunkIcon, hunkLabel := "stage", a.t("Stage Hunk")
				lineIcon, lineLabel := "stage", a.t("Stage Lines")
				if action == "unstage" {
					fileIcon, fileLabel = "unstage", a.t("Unstage File")
					hunkIcon, hunkLabel = "unstage", a.t("Unstage Hunk")
					lineIcon, lineLabel = "unstage", a.t("Unstage Lines")
				}
				if a.toolbarButton(c, fileIcon, fileLabel, false) {
					a.diffAction(tab, -1, nil, action)
				}
				if target == git.DiffWorkingTree {
					if a.toolbarButton(c, "undo", a.t("Rollback File"), false) {
						a.diffAction(tab, -1, nil, "rollback")
					}
				}
				if tab.diff != nil {
					if i, inside := tab.diff.CurrentHunk(); inside {
						toolbarRule(c)
						if a.toolbarButton(c, hunkIcon, hunkLabel, false) {
							a.diffAction(tab, i, nil, action)
						}
						if target == git.DiffWorkingTree && a.toolbarButton(c, "undo", a.t("Rollback Hunk"), false) {
							a.diffAction(tab, i, nil, "rollback")
						}
					}
					if tab.hasSel {
						toolbarRule(c)
						if a.toolbarButton(c, lineIcon, fmt.Sprintf("%s (%d)", lineLabel, len(selectedLines(tab))), false) {
							a.diffAction(tab, -1, selectedLines(tab), action)
						}
						if target == git.DiffWorkingTree && a.toolbarButton(c, "undo", a.t("Rollback Lines"), false) {
							a.diffAction(tab, -1, selectedLines(tab), "rollback")
						}
					}
				}
			}
		})
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
		if tab.truncated {
			ui.Text(c, a.t("The file is too large to show whole")).FontSize(10).TextColor(t.Warning).Padding(4, 10)
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
				tab.src.Theme = editorTheme(t)
				editor.View(c, tab.src).Grow(1).FillWidth()
			})
			return
		}
		tab.src.Theme = editorTheme(t)
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
	if tab.src == nil {
		return
	}
	if len(tab.blame) == 0 {
		tab.src.SetInlays(nil)
		return
	}
	pos := tab.src.CursorPos()
	if pos.Line < 0 || pos.Line >= len(tab.blame) || pos.Line >= tab.src.Buffer.LineCount() {
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
	p := palette(c.Theme())
	ui.Column(c).BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
		rev := tab.revision
		label := rev
		switch rev {
		case "":
			label = a.t("Working Tree")
		case "INDEX":
			label = a.t("Index")
		default:
			if len(label) > 10 {
				label = label[:10]
			}
		}
		ui.Row(c).Height(34).Padding(0, 8, 0, 10).Gap(7).AlignItems(ui.Center).
			Background(ui.Hex(p.panel)).Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
				a.icon(c, "file", 15)
			})
			ui.Text(c, tab.path).FontSize(12).Font("monospace").TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
			ui.Text(c, label).FontSize(10.5).TextColor(ui.Hex(p.muted2)).MaxLines(1)
			if tab.src != nil && tab.src.Buffer.Modified() {
				ui.Box(c).Size(5, 5).Radius(3).Background(ui.Hex(p.accent))
			}
			ui.Spacer(c).Grow(1)
			if tab.revision == "" {
				if a.toolbarButton(c, "save", a.t("Save"), false) {
					a.saveSource(tab)
				}
				if a.toolbarButton(c, "diff", a.t("Show Diff"), false) {
					a.openDiff(git.DiffOptions{Path: tab.path, Target: git.DiffWorkingTree, Context: a.settings.DiffContext})
				}
			}
			if _, clicked := a.smallIconButton(c, "close", a.t("Close"), false); clicked {
				a.closeActiveTab()
			}
		})
		ui.Row(c).Height(30).PaddingX(6).Gap(2).AlignItems(ui.Center).
			Background(ui.Hex(p.panel2)).BorderWidth(1, 0, 0, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			seg := ui.Row(c).Height(22).Radius(5).Border(1, ui.Hex(p.border)).
				Background(ui.Hex(p.input)).Children(func() {
				choices := []struct{ label, rev string }{
					{a.t("Working Tree"), ""},
					{a.t("Index"), "INDEX"},
					{"HEAD", "HEAD"},
				}
				for _, choice := range choices {
					choice := choice
					on := tab.revision == choice.rev
					b := ui.ButtonBase(c).Height(20).PaddingX(7).Center()
					if on {
						b.Background(ui.Hex(p.selection))
					} else if b.Hovered() {
						b.Background(ui.Hex(p.hover))
					}
					b.Children(func() {
						col := p.muted
						if on {
							col = p.fg
						}
						ui.Text(c, choice.label).FontSize(11).TextColor(ui.Hex(col))
					})
					if b.Clicked() {
						a.openSource(tab.path, choice.rev)
					}
				}
			})
			_ = seg
			if tab.src != nil {
				if a.toolbarToggle(c, "rows", a.t("Wrap"), tab.src.SoftWrap) {
					tab.src.SoftWrap = !tab.src.SoftWrap
				}
				toolbarRule(c)
				if _, clicked := a.smallIconButton(c, "prevDiff", a.t("Previous change"), false); clicked {
					tab.src.Run(editor.PreviousHunk)
				}
				if _, clicked := a.smallIconButton(c, "nextDiff", a.t("Next change"), false); clicked {
					tab.src.Run(editor.NextHunk)
				}
			}
			ui.Spacer(c).Grow(1)
			if a.toolbarToggle(c, "user", a.t("Annotate"), tab.blameOn) {
				tab.blameOn = !tab.blameOn
			}
			if tab.revision == "" && a.toolbarToggle(c, "eye", a.t("Ignore whitespace"), tab.blameIgnore) {
				tab.blameIgnore = !tab.blameIgnore
				a.loadBlame(tab)
			}
			if a.toolbarButton(c, "clock", a.t("History"), false) {
				a.openLocalHistory(tab)
			}
		})
	})
}

// blameColumn paints the blame annotation column beside the source editor.
// It follows the editor's own scroll: LineTop and ScrollY are the last
// frame's geometry.
func (a *nativeApp) blameColumn(c *ui.Context, tab *docTab) {
	t := c.Theme()
	width := float32(210)
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
	a.busy++
	a.redraw()
	go func() {
		err := a.g.SaveFile(tab.path, text)
		mygoMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			tab.src.Buffer.MarkSaved()
			if a.lsp != nil {
				a.lsp.didSave(tab)
			}
			tab.title = tab.path
			a.loadBlame(tab)
			a.refresh()
		})
	}()
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
