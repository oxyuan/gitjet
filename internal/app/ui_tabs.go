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
	tab.diff = st
	tab.title = fd.Path
}

func (a *nativeApp) loadDiffImage(tab *docTab, fd git.FileDiff) {
	// The working-tree side is the file itself; a deleted file has none.
	rev := ""
	switch tab.opts.Target {
	case git.DiffStaged:
		rev = "INDEX"
	case git.DiffCommit, git.DiffRange:
		rev = tab.opts.Revision
	}
	go func() {
		img, err := a.g.Image(fd.Path, rev)
		var src ui.ImageSource
		if err == nil {
			data, decErr := base64.StdEncoding.DecodeString(img.Data)
			if decErr == nil {
				src, _ = ui.DecodeImage(data)
			}
		}
		mygoMain(func() {
			tab.image = src
			tab.imageMime = rev
			if err != nil {
				tab.err = err.Error()
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
			buf := editor.NewBuffer(file.Text)
			if lang := editor.LanguageFor(path); lang != nil {
				buf.SetLanguage(lang)
			}
			readOnly := rev != ""
			tab.src = &editor.State{Buffer: buf, ReadOnly: readOnly, LineHeight: 1.5}
			tab.base = base
			if base != nil {
				if lang := editor.LanguageFor(path); lang != nil {
					base.SetLanguage(lang)
				}
				tab.src.DiffBase = base
			}
			tab.src.OnDefinition = func(off int) { a.jumpToDefinition(tab, off) }
			tab.src.OnHover = func(r editor.HoverRequest) { a.hover(tab, r) }
			tab.src.OnCompletion = func(r editor.CompletionRequest) { a.complete(tab, r) }
			tab.src.OnGutterClick = func(line int) { a.gutterMenu(tab, line) }
			tab.src.ContextMenu = func(m *ui.Menu) {
				if m.Item(a.t("Copy Path")).Chosen() {
					a.copyText(path)
				}
				if m.Item(a.t("Copy Absolute Path")).Chosen() {
					a.copyText(a.absPath(path))
				}
				if m.Item(a.t("Show History")).Chosen() {
					a.showFileHistory(path)
				}
				m.Separator()
				m.EditItems()
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
	ignore := a.settings.IgnoreWhitespace
	go func() {
		br, err := a.g.Blame(path, rev, git.BlameOptions{IgnoreWhitespace: ignore, IgnoreRevsFile: ".git-blame-ignore-revs"})
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
			ui.Column(c).Fill().Center().Gap(8).Children(func() {
				ui.Text(c, a.t("Binary file")).FontSize(14)
				if tab.image != nil {
					ui.Image(c, tab.image).Fit(ui.Contain).Grow(1).MaxWidth(700)
				}
			})
			return
		}
		if tab.diff == nil || !tab.loaded {
			ui.Row(c).Padding(12).Gap(8).Children(func() { ui.Spinner(c); ui.Text(c, a.t("Loading diff")) })
			return
		}
		tab.diff.Theme = editor.DefaultTheme(t)
		tab.diff.Wrap = a.diffWrap(tab)
		editor.DiffView(c, tab.diff).Grow(1).FillWidth()
	})
}

func (a *nativeApp) diffToolbar(c *ui.Context, tab *docTab) {
	t := c.Theme()
	ui.Row(c).Padding(6, 10).Gap(8).AlignItems(ui.Center).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		ui.Text(c, filepath.Base(tab.path)).FontSize(12).FontWeight(600)
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
			if ui.Button(c, a.t("Apply File")).Clicked() {
				a.applyDiffFile(tab)
			}
			if tab.diff != nil {
				if i, inside := tab.diff.CurrentHunk(); inside {
					if ui.Button(c, a.t("Apply Hunk")).Clicked() {
						a.applyDiffHunk(tab, i)
					}
				}
				if tab.hasSel {
					if ui.Button(c, a.t("Apply Lines")).Clicked() {
						a.applyDiffLines(tab)
					}
				}
			}
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
			ui.Row(c).Padding(12).Gap(8).Children(func() { ui.Spinner(c); ui.Text(c, a.t("Loading file")) })
			return
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
		editor.View(c, tab.src).Grow(1).FillWidth()
	})
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
	box := ui.Box(c).Width(width).FillHeight().Background(t.Surface)
	box.BorderWidth(0, 1, 0, 0).BorderColor(t.Border)
	box.Children(func() {
		if tab.src == nil || len(tab.blame) == 0 {
			return
		}
		first, last := tab.src.VisibleLines()
		if first < 0 {
			first = 0
		}
		lineH := tab.src.LineTop(1) - tab.src.LineTop(0)
		if lineH <= 0 {
			lineH = 19.5
		}
		scroll := float32(tab.src.ScrollY())
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
						a.openSource(f.Path, tab.revision)
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
	rev := a.snapshot.State.Head
	if rev == "" {
		return
	}
	a.openRevisionTree(rev)
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
