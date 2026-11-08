package app

import (
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

// mainView is the repository window: title bar, tool window, editor area
// and status bar.
func (a *nativeApp) mainView(c *ui.Context) {
	ui.Column(c).Fill().Children(func() {
		a.titleBar(c)
		ui.Split(c, &a.sideSplit, func() {
			a.toolWindow(c)
		}, func() {
			a.editorArea(c)
		}).Grow(1)
		a.statusBar(c)
	})
}

func (a *nativeApp) titleBar(c *ui.Context) {
	p := palette(c.Theme())
	title := ui.Row(c).Height(52).PaddingStart(12).PaddingEnd(12).AlignItems(ui.Center).Gap(2).
		BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).DragWindow().
		Background(ui.Hex(p.panel).Alpha(0.84))
	if runtime.GOOS == "darwin" {
		title.PaddingStart(84)
	}
	title.Children(func() {
		ui.Row(c).Gap(8).PaddingEnd(9).AlignItems(ui.Center).Children(func() {
			a.kitLogo(c)
			ui.Text(c, "GitJet").FontSize(13.5).FontWeight(650).LetterSpacing(-0.015)
			if a.repoOpen {
				ui.Text(c, "/").FontSize(13).TextColor(ui.Hex(p.muted2))
				name := a.snapshot.State.Name
				if name == "" {
					name = filepath.Base(a.snapshot.State.Root)
				}
				ui.Text(c, name).FontSize(12.5).TextColor(ui.Hex(p.muted)).MaxWidth(300).MaxLines(1)
			}
		})
		ui.Row(c).Gap(2).AlignItems(ui.Center).Grow(1).Children(func() {
			if _, clicked := a.kitIconButton(c, "open", a.t("Open Repository"), 30, 16, false, false, false); clicked {
				a.chooseAndOpen()
			}
			kitToolbarRule(c)
			if _, clicked := a.kitIconButton(c, "refresh", a.t("Refresh"), 30, 16, a.busy > 0, false, false); clicked {
				a.refresh()
			}
			fetch, clicked := a.kitIconButton(c, "fetch", a.t("Fetch"), 30, 16, !a.repoOpen, false, a.snapshot.State.Behind > 0)
			fetch.ContextMenu(func(m *ui.Menu) {
				if m.Item(a.t("All remotes")).Chosen() {
					a.fetchWith(git.FetchOptions{All: true, Prune: a.fetchPrune, Tags: a.fetchTags})
				}
				if m.Item("origin").Chosen() {
					a.fetchWith(git.FetchOptions{Remote: "origin", Prune: a.fetchPrune, Tags: a.fetchTags})
				}
				m.Separator()
				if m.Item(a.t("Prune")).Checked(a.fetchPrune).Chosen() {
					a.fetchPrune = !a.fetchPrune
				}
				if m.Item(a.t("Tags")).Checked(a.fetchTags).Chosen() {
					a.fetchTags = !a.fetchTags
				}
			})
			if clicked {
				a.fetchWith(git.FetchOptions{All: true, Prune: a.fetchPrune, Tags: a.fetchTags})
			}
			if _, clicked := a.kitIconButton(c, "pull", a.t("Pull"), 30, 16, !a.repoOpen || a.busy > 0, false, a.snapshot.State.Behind > 0); clicked {
				a.openPullDialog()
			}
			_, clicked = a.kitIconButton(c, "push", a.t("Push"), 30, 16, !a.repoOpen || a.busy > 0, false, a.snapshot.State.Ahead > 0)
			if clicked {
				a.openPushDialog()
			}
			ui.Spacer(c).Grow(1)
			ui.Spacer(c).Grow(1)
			if _, clicked := a.kitIconButton(c, "settings", a.t("Settings"), 30, 16, false, false, false); clicked {
				a.openSettingsDialog()
			}
		})
		a.quickTrigger(c)
	})
}

// quickTrigger is the centered search affordance of the title bar.
func (a *nativeApp) quickTrigger(c *ui.Context) {
	quick, clicked := a.kitSearch(c, a.t("Search files"), "⌘P", a.repoOpen)
	quick.Absolute().LeftPercent(50).TranslatePercent(-50, 0)
	if clicked {
		a.openQuickOpen()
	}
}

func (a *nativeApp) toolWindow(c *ui.Context) {
	t := c.Theme()
	p := palette(t)
	ui.Column(c).FillHeight().Background(ui.Hex(p.panel).Mix(ui.Hex(p.bg), 0.12)).BorderWidth(0, 1, 0, 0).
		BorderColor(ui.Hex(p.border)).Children(func() {
		// Tool order is the stored preference; the history lives in the dock
		// below the editor, not here.
		type toolTab struct {
			index int
			label string
		}
		byName := map[string]toolTab{
			"files":    {2, a.t("Files")},
			"commit":   {0, a.t("Commit")},
			"branches": {1, a.t("Branches")},
			"console":  {4, a.t("Console")},
		}
		var tabs []toolTab
		for _, name := range a.settings.ToolTabs {
			if tab, ok := byName[name]; ok {
				tabs = append(tabs, tab)
			}
		}
		ui.Row(c).Height(48).PaddingX(10).PaddingY(8).Gap(4).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			for _, tab := range tabs {
				tab := tab
				active := a.sideTab == tab.index
				count := 0
				if tab.index == 0 {
					count = a.snapshot.State.Changed + a.snapshot.State.Untracked + a.snapshot.State.Conflicts
				}
				if _, clicked := a.kitToolTab(c, iconNameForTab(tab.index), tab.label, count, active); clicked {
					a.sideTab = tab.index
				}
			}
		})
		if !a.repoOpen {
			a.noRepoPane(c)
			return
		}
		ui.Box(c).Grow(1).MinHeight(0).Children(func() {
			switch a.sideTab {
			case 0:
				a.commitPane(c)
			case 1:
				a.branchesPane(c)
			case 2:
				a.filesPane(c)
			case 4:
				a.consolePane(c)
			}
		})
	})
}

func (a *nativeApp) noRepoPane(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Fill().Center().Gap(10).Padding(24).Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
			a.icon(c, "git", 26)
		})
		ui.Text(c, a.t("No repository")).FontSize(14).FontWeight(600).TextColor(ui.Hex(p.fg))
		ui.Text(c, a.t("Open a repository to begin")).FontSize(11.5).TextColor(ui.Hex(p.muted)).MaxWidth(220)
		if a.primaryButton(c, a.t("Open Repository")) {
			a.chooseAndOpen()
		}
		if a.secondaryButton(c, a.t("Clone Repository"), false) {
			a.openCloneDialog()
		}
		if a.secondaryButton(c, a.t("Create Repository"), false) {
			a.openInitDialog()
		}
	})
}

func (a *nativeApp) commitPane(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Grow(1).MinHeight(0).Background(ui.Hex(p.panel)).Children(func() {
		// The panel toolbar: refresh, expand, view mode, more.
		ui.Row(c).Height(40).Padding(4, 10).Gap(3).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			if _, clicked := a.iconButton(c, "refresh", a.t("Refresh"), false); clicked {
				a.refresh()
			}
			toolbarRule(c)
			if _, clicked := a.iconButton(c, "expand", a.t("Expand all"), false); clicked {
				a.changeClosed = map[string]bool{}
				for _, row := range a.changes {
					dir := filepath.Dir(row.change.Path)
					for dir != "." && dir != "/" {
						a.openDirs[dir] = true
						dir = filepath.Dir(dir)
					}
				}
			}
			if _, clicked := a.iconButton(c, "collapse", a.t("Collapse all"), false); clicked {
				a.changeClosed = map[string]bool{}
				for _, cl := range a.snapshot.Changelists.Items {
					a.changeClosed["cl:"+cl.ID] = true
				}
				a.changeClosed["staged"] = true
				a.changeClosed["conflicts"] = true
				a.changeClosed["ignored"] = true
				a.openDirs = map[string]bool{}
			}
			ui.Spacer(c).Grow(1)
			viewIcon, viewTip := "list", a.t("View Flat")
			if a.changeView == "flat" {
				viewIcon, viewTip = "folder", a.t("View Tree")
			}
			if _, clicked := a.iconButton(c, viewIcon, viewTip, false); clicked {
				if a.changeView == "tree" {
					a.changeView = "flat"
				} else {
					a.changeView = "tree"
				}
			}
			more := ui.ButtonBase(c).Size(26, 26).Radius(4).Center().Tooltip(a.t("More actions"))
			if more.Hovered() {
				more.Background(ui.Hex(p.hover))
			}
			more.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.fgSoft)).Center().Children(func() {
					a.icon(c, "more", 16)
				})
			})
			more.PopoverMenuButton(func(m *ui.Menu) {
				picked := a.pickedChangeRows()
				one := len(picked) == 1
				if m.Item(a.t("Open Source")).Disabled(!one).Chosen() && one {
					a.openSource(picked[0].change.Path, "")
				}
				if m.Item(a.t("Show Diff")).Disabled(!one).Chosen() && one {
					a.openDiffFor(picked[0])
				}
				if len(picked) > 0 {
					if m.Item(a.t("Stage Selected")).Chosen() {
						a.stage(a.pickedChangePaths(false))
					}
					if m.Item(a.t("Unstage Selected")).Chosen() {
						a.unstage(a.pickedChangePaths(true))
					}
					if m.Item(a.t("Rollback Selected")).Chosen() {
						a.rollback(a.pickedChangePaths(false))
					}
				}
				m.Separator()
				if m.Item(a.t("Undo Commit")).Chosen() {
					a.undoCommit()
				}
				if m.Item(a.t("Patches")).Chosen() {
					a.openPatchDialog()
				}
				if m.Item(a.t("Edit .gitignore")).Chosen() {
					a.editGitignore()
				}
				if m.Item(a.t("Stash changes")).Chosen() {
					a.openStashDialog()
				}
				m.Separator()
				show := a.showStaged
				if m.Item(a.t("Show staged changes")).Checked(show).Chosen() {
					a.showStaged = !show
					a.rebuildRows()
				}
				if m.Item(a.t("Clear all stashes")).Chosen() {
					a.busyRun("stash", func() error {
						_, err := a.g.ClearStashes()
						return err
					})
				}
			})
		})
		// The change list: staged and conflicted files first, then one
		// section per changelist, as the page groups them.
		ui.Scroll(c).Grow(1).MinHeight(0).Children(func() {
			ui.Column(c).Gap(1).Padding(6, 8, 12, 8).Children(func() {
				staged, conflicts, changed, untracked, ignored := 0, 0, 0, 0, 0
				for _, row := range a.changes {
					switch {
					case row.staged:
						staged++
					case row.change.Unmerged:
						conflicts++
					case row.change.Kind == "untracked":
						untracked++
					case row.change.Kind == "ignored":
						ignored++
					default:
						changed++
					}
				}
				if a.showStaged && staged > 0 {
					a.changeSection(c, "staged", a.t("Staged Changes"), "stage", staged, func() {
						if _, clicked := a.smallIconButton(c, "unstage", a.t("Unstage all"), false); clicked {
							var paths []string
							for _, row := range a.changes {
								if row.staged {
									paths = append(paths, row.change.Path)
								}
							}
							a.unstage(paths)
						}
					})
					if a.sectionOpen("staged") {
						var rows []int
						for i, row := range a.changes {
							if row.staged {
								rows = append(rows, i)
							}
						}
						a.changeRows(c, rows)
					}
				}
				if conflicts > 0 {
					a.changeSection(c, "conflicts", a.t("Merge Conflicts"), "warning", conflicts, func() {
						if _, clicked := a.smallIconButton(c, "merge", a.t("Resolve Conflicts"), false); clicked {
							a.dialog = dialogState{kind: dialogConflicts}
						}
					})
					if a.sectionOpen("conflicts") {
						var rows []int
						for i, row := range a.changes {
							if row.change.Unmerged {
								rows = append(rows, i)
							}
						}
						a.changeRows(c, rows)
					}
				}
				for _, cl := range a.snapshot.Changelists.Items {
					cl := cl
					var rows []int
					for i, row := range a.changes {
						if row.staged || row.change.Unmerged || row.change.Kind == "ignored" {
							continue
						}
						if len(cl.Paths) > 0 && !containsString(cl.Paths, row.change.Path) {
							continue
						}
						rows = append(rows, i)
					}
					if len(a.snapshot.Changelists.Items) == 1 && len(rows) == 0 {
						// Keep the one section for the empty state below.
					}
					title := cl.Name
					if cl.ID == a.snapshot.Changelists.Active {
						title = cl.Name + " (" + a.t("active") + ")"
					}
					key := "cl:" + cl.ID
					a.changeSection(c, key, title, map[bool]string{true: "check", false: "list"}[cl.ID == a.snapshot.Changelists.Active], len(rows), func() {
						if _, clicked := a.smallIconButton(c, "plus", a.t("New Changelist"), false); clicked {
							a.dialog = dialogState{kind: dialogPrompt, title: a.t("New Changelist"), message: a.t("Name"), action: "new-changelist"}
						}
						more, _ := a.kitIconButton(c, "more", a.t("Changelist actions"), 24, 13, false, false, false)
						more.PopoverMenuButton(func(m *ui.Menu) {
							if m.Item(a.t("Rename Changelist")).Chosen() {
								a.dialog = dialogState{kind: dialogPrompt, title: a.t("Rename Changelist"), message: a.t("Name"), action: "rename-changelist", target: cl.ID, text: cl.Name}
							}
							if m.Item(a.t("Delete Changelist")).Chosen() {
								a.dialog = dialogState{kind: dialogConfirm, title: a.t("Delete Changelist"), message: a.t("Delete the active changelist?"), action: "delete-changelist", target: cl.ID}
							}
							m.Separator()
							for _, item := range a.snapshot.Changelists.Items {
								label := item.Name
								if item.ID == a.snapshot.Changelists.Active {
									label = "✓ " + label
								}
								id := item.ID
								if m.Item(label).Chosen() {
									a.setActiveChangelist(id)
								}
							}
						})
					})
					if !a.sectionOpen(key) {
						continue
					}
					var trackedRows, untrackedRows []int
					for _, i := range rows {
						if a.changes[i].change.Kind == "untracked" {
							untrackedRows = append(untrackedRows, i)
						} else {
							trackedRows = append(trackedRows, i)
						}
					}
					if len(trackedRows) > 0 && len(untrackedRows) > 0 {
						a.changeSubgroup(c, a.t("Changed files"), changed)
					}
					a.changeRows(c, trackedRows)
					if len(untrackedRows) > 0 {
						if len(trackedRows) > 0 {
							a.changeSubgroup(c, a.t("Untracked files"), untracked)
						}
						a.changeRows(c, untrackedRows)
					}
					if len(rows) == 0 && len(a.changes) > 0 {
						ui.Text(c, a.t("No changes")).FontSize(11.5).TextColor(ui.Hex(p.muted2)).Padding(6, 10, 8, 36)
					}
				}
				if a.settings.ShowIgnored && ignored > 0 {
					a.changeSection(c, "ignored", a.t("Ignored Files"), "eye", ignored, nil)
					if a.sectionOpen("ignored") {
						var rows []int
						for i, row := range a.changes {
							if row.change.Kind == "ignored" {
								rows = append(rows, i)
							}
						}
						a.changeRows(c, rows)
					}
				}
				if len(a.changes) == 0 {
					a.kitEmptyState(c, "check", a.t("No local changes"), a.t("The working tree is clean."), ui.Hex(p.success))
				}
			})
		})
		a.stashSection(c)
		a.commitBox(c)
	})
}

type changeNode struct {
	name     string
	path     string
	dir      bool
	row      int
	children []*changeNode
}

func buildChangeTree(rows []int, changes []changeRow) []*changeNode {
	root := &changeNode{}
	dirs := map[string]*changeNode{"": root}
	for _, i := range rows {
		path := changes[i].change.Path
		parts := strings.Split(path, "/")
		parent := root
		prefix := ""
		for _, part := range parts[:len(parts)-1] {
			if prefix == "" {
				prefix = part
			} else {
				prefix += "/" + part
			}
			dir := dirs[prefix]
			if dir == nil {
				dir = &changeNode{name: part, path: prefix, dir: true}
				dirs[prefix] = dir
				parent.children = append(parent.children, dir)
			}
			parent = dir
		}
		parent.children = append(parent.children, &changeNode{name: parts[len(parts)-1], path: path, row: i})
	}
	var fold func(*changeNode) *changeNode
	fold = func(n *changeNode) *changeNode {
		if !n.dir {
			return n
		}
		children := n.children
		name := n.name
		for len(children) == 1 && children[0].dir {
			name += "/" + children[0].name
			children = children[0].children
		}
		sort.SliceStable(children, func(i, j int) bool {
			if children[i].dir != children[j].dir {
				return children[i].dir
			}
			return strings.ToLower(children[i].name) < strings.ToLower(children[j].name)
		})
		out := &changeNode{name: name, path: n.path, dir: true}
		for _, child := range children {
			out.children = append(out.children, fold(child))
		}
		return out
	}
	sort.SliceStable(root.children, func(i, j int) bool {
		if root.children[i].dir != root.children[j].dir {
			return root.children[i].dir
		}
		return strings.ToLower(root.children[i].name) < strings.ToLower(root.children[j].name)
	})
	out := make([]*changeNode, 0, len(root.children))
	for _, child := range root.children {
		out = append(out, fold(child))
	}
	return out
}

func (a *nativeApp) changeRows(c *ui.Context, rows []int) {
	if a.changeView != "tree" {
		for _, i := range rows {
			a.changeRowAt(c, i, 0)
		}
		return
	}
	a.changeTree(c, buildChangeTree(rows, a.changes), 0)
}

func (a *nativeApp) changeTree(c *ui.Context, nodes []*changeNode, depth int) {
	p := palette(c.Theme())
	for _, node := range nodes {
		node := node
		if !node.dir {
			a.changeRowAt(c, node.row, depth)
			continue
		}
		row := a.kitRow(c, 28, 6+float32(depth)*12, 10, 6, false)
		row.Radius(6)
		open := a.openDirs[node.path]
		row.Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
				if open {
					a.icon(c, "chevronDown", 12)
				} else {
					a.icon(c, "chevronRight", 12)
				}
			})
			files, additions, deletions := changeNodeTotals(node, a.changes)
			state := ui.CheckOff
			checked := 0
			for _, i := range files {
				ch := a.changes[i]
				if ch.change.Unmerged || ch.change.Kind == "ignored" {
					continue
				}
				key := ch.change.Path
				if ch.staged {
					key = "staged:" + key
				}
				if a.checked[key] {
					checked++
				}
			}
			if checked == len(files) && len(files) > 0 {
				state = ui.CheckOn
			} else if checked > 0 {
				state = ui.CheckMixed
			}
			cb := ui.CheckboxState(c, &state, "")
			if cb.Changed() {
				on := state == ui.CheckOn
				for _, i := range files {
					ch := a.changes[i]
					key := ch.change.Path
					if ch.staged {
						key = "staged:" + key
					}
					a.checked[key] = on
				}
			}
			ui.Row(c).TextColor(ui.Hex(p.accent).Alpha(0.72)).Center().Children(func() {
				a.icon(c, "folder", 14)
			})
			ui.Text(c, node.name).FontSize(12.5).FontWeight(550).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
			ui.Text(c, fmtInt(len(files))).FontSize(10.5).TextColor(ui.Hex(p.muted2))
			ui.Spacer(c).Grow(1)
			if additions > 0 {
				ui.Text(c, fmt.Sprintf("+%d", additions)).FontSize(10).Font("monospace").TextColor(ui.Hex(p.added))
			}
			if deletions > 0 {
				ui.Text(c, fmt.Sprintf("−%d", deletions)).FontSize(10).Font("monospace").TextColor(ui.Hex(p.deleted))
			}
		})
		if row.Clicked() {
			a.openDirs[node.path] = !open
		}
		if open {
			a.changeTree(c, node.children, depth+1)
		}
	}
}

func changeNodeTotals(node *changeNode, changes []changeRow) (files []int, additions, deletions int) {
	if !node.dir {
		ch := changes[node.row].change
		return []int{node.row}, ch.Additions, ch.Deletions
	}
	for _, child := range node.children {
		f, a, d := changeNodeTotals(child, changes)
		files = append(files, f...)
		additions += a
		deletions += d
	}
	return files, additions, deletions
}

func (a *nativeApp) changeSubgroup(c *ui.Context, title string, count int) {
	p := palette(c.Theme())
	ui.Row(c).Padding(7, 8, 3, 10).Gap(6).AlignItems(ui.Center).Children(func() {
		ui.Text(c, title).FontSize(11.5).FontWeight(600).TextColor(ui.Hex(p.fgSoft))
		ui.Text(c, fmt.Sprintf("%d %s", count, a.t("files"))).FontSize(10.5).TextColor(ui.Hex(p.muted2))
	})
}

func containsString(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}

func (a *nativeApp) sectionOpen(key string) bool {
	return !a.changeClosed[key]
}

func (a *nativeApp) changeSection(c *ui.Context, key, title, icon string, count int, extra func()) {
	p := palette(c.Theme())
	closed := !a.sectionOpen(key)
	header := ui.ButtonBase(c).Height(30).PaddingX(8).Radius(6).Gap(6).
		AlignItems(ui.Center).FillWidth().Justify(ui.Start)
	bg := ui.Transparent
	if header.Hovered() {
		bg = ui.Hex(p.hover)
	}
	header.Background(motionColor(header, "kit-section-bg", bg))
	header.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
			if closed {
				a.icon(c, "chevronRight", 12)
			} else {
				a.icon(c, "chevronDown", 12)
			}
		})
		ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
			a.icon(c, icon, 13)
		})
		ui.Text(c, strings.ToUpper(title)).FontSize(10.5).FontWeight(650).
			LetterSpacing(0.045).TextColor(ui.Hex(p.muted)).MaxLines(1)
		ui.Box(c).Height(18).PaddingX(5).Radius(9).Background(ui.Hex(p.hover)).Center().Children(func() {
			ui.Text(c, fmtInt(count)).FontSize(9.5).FontWeight(650).TextColor(ui.Hex(p.muted2))
		})
		ui.Spacer(c).Grow(1)
		if extra != nil {
			extra()
		}
	})
	motionPressPose(header, header.Pressed(), 0.995)
	if header.Clicked() {
		a.changeClosed[key] = !a.changeClosed[key]
	}
}

func (a *nativeApp) changeRow(c *ui.Context, i int) {
	a.changeRowAt(c, i, 0)
}

func (a *nativeApp) changeRowAt(c *ui.Context, i, depth int) {
	if i < 0 || i >= len(a.changes) {
		return
	}
	p := palette(c.Theme())
	row := a.changes[i]
	ch := row.change
	key := ch.Path
	if row.staged {
		key = "staged:" + key
	}
	selected := a.changePicked[key]
	line := a.kitRow(c, 28, 6+float32(depth)*12, 10, 6, selected)
	line.Radius(6)
	if selected {
		line.DrawOver(func(pt *ui.Painter, r ui.Rect) {
			pt.Stroke(ui.Rect{X: r.X + 0.5, Y: r.Y + 0.5, W: r.W - 1, H: r.H - 1}, ui.Hex(p.accent).Alpha(0.16), 6, 1)
		})
	}
	if line.Clicked() {
		mods := c.Modifiers()
		switch {
		case mods&ui.Shift != 0 && a.changeAnchor >= 0:
			lo, hi := a.changeAnchor, i
			if lo > hi {
				lo, hi = hi, lo
			}
			for a.changePicked = map[string]bool{}; lo <= hi; lo++ {
				r := a.changes[lo]
				k := r.change.Path
				if r.staged {
					k = "staged:" + k
				}
				a.changePicked[k] = true
			}
		case mods&ui.Cmd != 0:
			a.changePicked[key] = !a.changePicked[key]
			a.changeAnchor = i
		default:
			a.changePicked = map[string]bool{key: true}
			a.changeAnchor = i
		}
		a.changeSel = i
	}
	if line.DoubleClicked() {
		a.changeSel = i
		a.openSelectedChange()
	}
	line.Children(func() {
		ui.Spacer(c).Width(14)
		key := ch.Path
		if row.staged {
			key = "staged:" + key
		}
		if !ch.Unmerged && ch.Kind != "ignored" {
			v := a.checked[key]
			if kitCheckbox(c, &v, "").Changed() {
				a.checked[key] = v
			}
		} else {
			ui.Spacer(c).Width(14)
		}
		if row.staged {
			ui.Box(c).Size(5, 5).Radius(3).Background(ui.Hex(p.accent))
		}
		ui.Text(c, statusLetter(ch)).FontSize(10).Font("monospace").FontWeight(700).Width(13).
			TextColor(statusColor(c.Theme(), ch))
		a.kitFileBadge(c, ch.Path, 14)
		ui.Text(c, filepath.Base(ch.Path)).FontSize(12.5).FontWeight(450).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
		if dir := filepath.Dir(ch.Path); dir != "." && !row.staged {
			ui.Text(c, dir+"/").FontSize(10.5).TextColor(ui.Hex(p.muted2)).MaxLines(1)
		}
		ui.Spacer(c).Grow(1)
		if ch.Additions > 0 {
			ui.Text(c, fmt.Sprintf("+%d", ch.Additions)).FontSize(10).Font("monospace").TextColor(ui.Hex(p.added))
		}
		if ch.Deletions > 0 {
			ui.Text(c, fmt.Sprintf("−%d", ch.Deletions)).FontSize(10).Font("monospace").TextColor(ui.Hex(p.deleted))
		}
	})

	line.ContextMenu(func(m *ui.Menu) {
		if ch.Unmerged {
			if m.Item(a.t("Resolve Conflict")).Chosen() {
				a.openMergeWindow(ch.Path)
			}
			m.Separator()
			if m.Item(a.t("Accept Ours")).Chosen() {
				a.takeSide(ch.Path, "ours")
			}
			if m.Item(a.t("Accept Theirs")).Chosen() {
				a.takeSide(ch.Path, "theirs")
			}
			if m.Item(a.t("Mark Resolved")).Chosen() {
				path := ch.Path
				a.busyRun("resolve", func() error { return a.g.MarkResolved([]string{path}) })
			}
			return
		}
		if row.staged {
			if m.Item(a.t("Unstage")).Chosen() {
				a.unstage([]string{ch.Path})
			}
		} else {
			if m.Item(a.t("Stage")).Chosen() {
				a.stage([]string{ch.Path})
			}
			if ch.Kind == "untracked" && m.Item(a.t("Add Without Content")).Chosen() {
				a.stageIntent([]string{ch.Path})
			}
		}
		if m.Item(a.t("Rollback")).Chosen() {
			a.rollback([]string{ch.Path})
		}
		m.Separator()
		if m.Item(a.t("Show Diff")).Chosen() {
			a.openDiffFor(row)
		}
		if m.Item(a.t("Compare with HEAD")).Chosen() {
			a.openDiff(git.DiffOptions{Path: ch.Path, OldPath: ch.OldPath, Target: git.DiffHead, Context: a.settings.DiffContext})
		}
		if m.Item(a.t("Open Source")).Chosen() {
			a.openSource(ch.Path, "")
		}
		if m.Item(a.t("Show History")).Chosen() {
			a.showFileHistory(ch.Path)
		}
		m.Separator()
		if m.Item(a.t("Copy Path")).Chosen() {
			a.copyText(ch.Path)
		}
		if m.Item(a.t("Copy Absolute Path")).Chosen() {
			a.copyText(a.absPath(ch.Path))
		}
		if m.Item(a.t("Reveal")).Chosen() {
			_ = a.ws.Reveal(ch.Path)
		}
		if !ch.Unmerged && m.Item(a.t("Ignore")).Chosen() {
			a.ignore([]string{ch.Path})
		}
		if len(a.snapshot.Changelists.Items) > 0 {
			path := ch.Path
			m.Submenu(a.t("Move to Changelist"), func(sm *ui.Menu) {
				for _, cl := range a.snapshot.Changelists.Items {
					id := cl.ID
					if sm.Item(cl.Name).Chosen() {
						a.busyRun("changelist", func() error {
							_, err := a.g.MoveToChangelist([]string{path}, id)
							return err
						})
					}
				}
			})
		}
	})
}

func statusLetter(ch git.Change) string {
	if ch.Unmerged {
		return "!"
	}
	switch ch.Kind {
	case "added":
		return "A"
	case "untracked":
		return "?"
	case "deleted":
		return "D"
	case "renamed":
		return "R"
	case "copied":
		return "C"
	case "conflict":
		return "!"
	case "ignored":
		return "I"
	}
	return "M"
}

func statusLetterKind(kind string) string {
	switch kind {
	case "added":
		return "A"
	case "deleted":
		return "D"
	case "renamed":
		return "R"
	case "copied":
		return "C"
	case "typechange":
		return "T"
	default:
		return "M"
	}
}

func statusColor(t *ui.Theme, ch git.Change) ui.Color {
	switch statusLetter(ch) {
	case "A":
		return t.Success
	case "D":
		return t.Danger
	case "!":
		return t.Warning
	case "I":
		return t.TextMuted
	}
	return t.Accent
}

func (a *nativeApp) stashSection(c *ui.Context) {
	if len(a.snapshot.Stashes) == 0 {
		return
	}
	p := palette(c.Theme())
	ui.Row(c).Height(30).PaddingX(8).Gap(6).AlignItems(ui.Center).Children(func() {
		ui.Text(c, strings.ToUpper(a.t("Stashes"))).FontSize(10).FontWeight(650).LetterSpacing(0.05).TextColor(ui.Hex(p.muted))
		ui.Text(c, fmt.Sprintf("%d", len(a.snapshot.Stashes))).FontSize(9.5).TextColor(ui.Hex(p.muted2))
		ui.Spacer(c).Grow(1)
		if a.miniTextButton(c, a.t("Clear"), false) {
			a.busyRun("stash", func() error {
				_, err := a.g.ClearStashes()
				return err
			})
		}
	})
	ui.Scroll(c).MaxHeight(120).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			for _, st := range a.snapshot.Stashes {
				st := st
				row := a.kitButtonRow(c, 28, 8, 8, 6, false)
				row.Children(func() {
					ui.Text(c, st.Message).FontSize(11).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
					ui.Spacer(c).Grow(1)
					ui.Text(c, a.stamp(st.Time)).FontSize(9).TextColor(ui.Hex(p.muted2))
					if a.miniTextButton(c, a.t("Pop"), false) {
						index := st.Index
						a.busyRun("stash", func() error { _, err := a.g.StashApply(index, true, true); return err })
					}
					if a.miniTextButton(c, a.t("Apply"), false) {
						index := st.Index
						a.busyRun("stash", func() error { _, err := a.g.StashApply(index, false, true); return err })
					}
					if a.miniTextButton(c, a.t("Drop"), true) {
						index := st.Index
						a.busyRun("stash", func() error { _, err := a.g.StashDrop(index); return err })
					}
				})
				if row.Clicked() {
					a.showStashFiles(st)
				}
				row.ContextMenu(func(m *ui.Menu) {
					if m.Item(a.t("Apply")).Chosen() {
						index := st.Index
						a.busyRun("stash", func() error {
							_, err := a.g.StashApply(index, false, true)
							return err
						})
					}
					if m.Item(a.t("Pop")).Chosen() {
						index := st.Index
						a.busyRun("stash", func() error {
							_, err := a.g.StashApply(index, true, true)
							return err
						})
					}
					if m.Item(a.t("Show Files")).Chosen() {
						a.showStashFiles(st)
					}
					if m.Item(a.t("Stash to Branch")).Chosen() {
						index := st.Index
						a.dialog = dialogState{kind: dialogPrompt, title: a.t("Stash to Branch"), message: a.t("Branch name"), action: "stash-branch", target: fmt.Sprint(index)}
					}
					m.Separator()
					if m.Item(a.t("Drop")).Chosen() {
						index := st.Index
						a.busyRun("stash", func() error {
							_, err := a.g.StashDrop(index)
							return err
						})
					}
				})
			}
		})
	})
}

func (a *nativeApp) commitBox(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Padding(8).Children(func() {
		card := ui.Column(c).Padding(12).Gap(9).Radius(14).Border(1, ui.Hex(p.border)).
			Background(ui.Hex(p.panel)).Shadow(0, 1, 2, 0, ui.RGBA(16, 24, 40, 0.05))
		card.Children(func() {
			ui.Box(c).Children(func() {
				msg := ui.TextArea(c, &a.commitForm.Message).Height(88).FontSize(12.5).
					Radius(10).Border(1, ui.Hex(p.border)).Padding(10, 30, 10, 11).
					Placeholder(a.t("Commit message"))
				if a.focusCommit > 0 {
					msg.AutoFocus()
					a.focusCommit = 0
				}
				if len(a.commitComp) > 0 {
					ui.Column(c).Margin(4, 0, 0, 0).Gap(1).Radius(8).Background(ui.Hex(p.raised)).
						Border(1, ui.Hex(p.border)).Shadow(0, 8, 24, 0, ui.RGBA(16, 20, 40, 0.14)).Children(func() {
						for _, path := range a.commitComp {
							path := path
							row := ui.ButtonBase(c).Height(26).PaddingX(8).Radius(5).FillWidth().AlignItems(ui.Center)
							if row.Hovered() {
								row.Background(ui.Hex(p.selection))
							}
							row.Children(func() {
								a.kitFileBadge(c, path, 14)
								ui.Text(c, path).FontSize(11.5).Font("monospace").TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
							})
							if row.Clicked() {
								a.applyCommitCompletion(path)
							}
						}
					})
				}
				ui.Row(c).Absolute().Top(8).Right(8).Gap(1).Children(func() {
					history, _ := a.kitIconButton(c, "clock", a.t("Recent messages"), 24, 13, false, false, false)
					history.PopoverMenuButton(func(m *ui.Menu) {
						if m.Item(a.t("Last Commit Message")).Chosen() {
							if body := a.lastCommitMessage(); body != "" {
								a.commitForm.Message = body
							}
						}
						m.Separator()
						for _, body := range a.g.MessageHistory() {
							body := body
							label := strings.SplitN(body, "\n", 2)[0]
							if m.Item(label).Chosen() {
								a.commitForm.Message = body
							}
						}
					})
					_, clicked := a.kitIconButton(c, "rows", a.t("Reformat to 72 columns"), 24, 13, false, false, false)
					if clicked {
						a.commitForm.Message = wrapCommitMessage(a.commitForm.Message, 72)
					}
				})
			})
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				kitCheckbox(c, &a.commitForm.Amend, a.t("Amend"))
				ui.Spacer(c).Grow(1)
				opts := ui.ButtonBase(c).Height(22).PaddingX(6).Radius(4).Gap(4).AlignItems(ui.Center)
				if a.showCommitOptions {
					opts.Background(ui.Hex(p.hover))
				}
				opts.Children(func() {
					ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
						a.icon(c, "settings", 13)
					})
					ui.Text(c, a.t("Options")).FontSize(11.5).TextColor(ui.Hex(p.muted))
					if a.commitForm.SignOff || a.commitForm.NoVerify || a.commitForm.AllowEmpty || a.commitForm.Sign || a.commitForm.AuthorName != "" {
						ui.Box(c).Size(5, 5).Radius(3).Background(ui.Hex(p.accent))
					}
				})
				if opts.Clicked() {
					a.showCommitOptions = !a.showCommitOptions
				}
			})
			if a.showCommitOptions {
				ui.Column(c).Padding(8, 8).Radius(6).Gap(6).Background(ui.Hex(p.raised)).
					Border(1, ui.Hex(p.border)).Children(func() {
					kitCheckbox(c, &a.commitForm.SignOff, a.t("Sign-off commit"))
					kitCheckbox(c, &a.commitForm.NoVerify, a.t("Skip hooks (--no-verify)"))
					kitCheckbox(c, &a.commitForm.AllowEmpty, a.t("Allow an empty commit"))
					kitCheckbox(c, &a.commitForm.Sign, a.t("Sign the commit (GPG)"))
					ui.Row(c).Gap(6).Children(func() {
						ui.Text(c, a.t("Author")).FontSize(10.5).TextColor(ui.Hex(p.muted)).Width(38)
						ui.TextInput(c, &a.commitForm.AuthorName).Placeholder(a.t("Name (optional)")).Grow(1)
					})
					ui.Row(c).Gap(6).Children(func() {
						ui.Text(c, a.t("Email")).FontSize(10.5).TextColor(ui.Hex(p.muted)).Width(38)
						ui.TextInput(c, &a.commitForm.AuthorEmail).Placeholder("email@example.com").Grow(1)
					})
				})
			}
			// Commit and its split arrow.
			count := 0
			for _, on := range a.checked {
				if on {
					count++
				}
			}
			canCommit := count > 0 || strings.TrimSpace(a.commitForm.Message) != "" || a.commitForm.Amend
			disabled := a.busy > 0 || !canCommit
			label := a.t("Commit")
			if count > 0 {
				label = fmt.Sprintf("%s (%d)", a.t("Commit"), count)
			}
			ui.Row(c).Gap(0).Children(func() {
				if a.kitPrimaryAction(c, "commit", label, disabled, true, 7, 0, 0, 7) {
					a.commitForm.PushAfter = false
					a.commitForm.RebaseAfter = false
					a.commitForm.SelectedOnly = false
					a.requestCommit()
				}
				arrow := a.kitAccentArrow(c, disabled)
				arrow.PopoverMenuButton(func(m *ui.Menu) {
					if m.Item(a.t("Commit and Push")).Chosen() {
						a.commitForm.PushAfter = true
						a.commitForm.RebaseAfter = false
						a.commitForm.SelectedOnly = false
						a.requestCommit()
					}
					if m.Item(a.t("Commit and Rebase")).Chosen() {
						a.commitForm.RebaseAfter = true
						a.commitForm.PushAfter = false
						a.commitForm.SelectedOnly = false
						a.requestCommit()
					}
					m.Separator()
					if m.Item(a.t("Commit Selected Changes Only")).Chosen() {
						a.commitForm.SelectedOnly = true
						a.commitForm.PushAfter = false
						a.commitForm.RebaseAfter = false
						a.requestCommit()
					}
					if m.Item(a.t("Undo Commit")).Chosen() {
						a.undoCommit()
					}
				})
			})
		})
	})
}

func (a *nativeApp) editorArea(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).FillHeight().Background(ui.Hex(p.editor)).Children(func() {
		a.tabStrip(c)
		if !a.repoOpen {
			ui.Box(c).Grow(1).MinHeight(0).Children(func() {
				a.welcomeBody(c)
			})
			return
		}
		if a.logFold {
			ui.Box(c).Grow(1).MinHeight(0).Children(func() {
				if len(a.tabs) == 0 || a.activeTab < 0 || a.activeTab >= len(a.tabs) {
					a.emptyEditor(c)
					return
				}
				a.tabView(c, a.tabs[a.activeTab])
			})
			a.logHeader(c)
			return
		}
		ui.SplitVertical(c, &a.editorSplit, func() {
			ui.Box(c).Fill().MinHeight(0).Background(ui.Hex(p.editor)).Children(func() {
				if len(a.tabs) == 0 || a.activeTab < 0 || a.activeTab >= len(a.tabs) {
					a.emptyEditor(c)
					return
				}
				a.tabView(c, a.tabs[a.activeTab])
			})
		}, func() {
			a.logDock(c)
		}).Grow(1).MinHeight(0)
	})
}

func (a *nativeApp) logDock(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).FillHeight().Background(ui.Hex(p.panel)).BorderWidth(1, 0, 0, 0).
		BorderColor(ui.Hex(p.border)).Children(func() {
		a.logHeader(c)
		ui.Split(c, &a.logSplit, func() {
			a.logListView(c)
		}, func() {
			a.logDetails(c)
		}).Grow(1).MinHeight(0)
	})
}

func (a *nativeApp) logHeader(c *ui.Context) {
	p := palette(c.Theme())
	headHeight := float32(40)
	if a.logFold {
		headHeight = 30
	}
	ui.Row(c).Height(headHeight).Padding(4, 10).Gap(3).AlignItems(ui.Center).
		Background(ui.Hex(p.panel)).BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
		open := !a.logFold
		if _, clicked := a.smallIconButton(c, map[bool]string{true: "chevronDown", false: "chevronRight"}[open], a.t("Log"), false); clicked {
			a.logFold = !a.logFold
		}
		ui.Text(c, a.t("History")).FontSize(12).FontWeight(600).TextColor(ui.Hex(p.fg)).PaddingX(3)
		ui.Text(c, fmtInt(len(a.log.Commits))).FontSize(10.5).TextColor(ui.Hex(p.muted2))
		if _, clicked := a.smallIconButton(c, "refresh", a.t("Refresh"), false); clicked {
			a.logDirty = true
			a.refresh()
		}
		if _, clicked := a.smallIconButton(c, "fetch", a.t("Fetch"), !a.repoOpen); clicked {
			a.fetchWith(git.FetchOptions{All: true, Prune: true})
		}
		if a.logFold {
			ui.Spacer(c).Grow(1)
			if a.logOpts.Path != "" {
				ui.Text(c, a.logOpts.Path).FontSize(10).TextColor(ui.Hex(p.accent)).MaxLines(1)
			}
			return
		}
		if _, submitted, changed := a.searchBox(c, &a.logSearch, a.t("Search commits"), 235); submitted {
			a.logOpts.Search = strings.TrimSpace(a.logSearch)
			a.logDirty = true
			a.refresh()
		} else if changed {
			a.scheduleLogFilter()
		}
		if a.toggleTextButton(c, ".*", a.logOpts.Regex) {
			a.logRegex = !a.logRegex
			a.logOpts.Regex = a.logRegex
			a.logDirty = true
			a.refresh()
		}
		if a.toggleTextButton(c, "Aa", a.logOpts.CaseSensitive) {
			a.logCase = !a.logCase
			a.logOpts.CaseSensitive = a.logCase
			a.logDirty = true
			a.refresh()
		}
		if _, submitted, changed := a.searchBox(c, &a.logAuthor, a.t("Author"), 96); submitted {
			a.logOpts.Author = strings.TrimSpace(a.logAuthor)
			a.logDirty = true
			a.refresh()
		} else if changed {
			a.scheduleLogFilter()
		}
		ui.Spacer(c).Grow(1)
		if a.logOpts.Path != "" || a.logOpts.Line > 0 {
			label := a.logOpts.Path
			if a.logOpts.Line > 0 {
				label += ":" + fmtInt(a.logOpts.Line)
			}
			ui.Text(c, label).FontSize(10).TextColor(ui.Hex(p.accent)).MaxLines(1)
			if _, clicked := a.smallIconButton(c, "close", a.t("Clear"), false); clicked {
				a.logOpts.Path = ""
				a.logOpts.Line = 0
				a.logDirty = true
				a.refresh()
			}
		}
		if n := a.logPick.Len(); n > 0 {
			ui.Text(c, fmt.Sprintf("%d %s", n, a.t("selected"))).FontSize(10).TextColor(ui.Hex(p.accent))
			sel, _ := a.kitIconButton(c, "more", a.t("Selected commits"), 22, 13, false, false, false)
			sel.PopoverMenuButton(func(m *ui.Menu) {
				a.logSelectionMenu(m)
			})
			if a.miniTextButton(c, a.t("Clear"), false) {
				a.logPick.Clear()
			}
		}
		filter, _ := a.smallIconButton(c, "list", a.t("Filter"), false)
		filter.PopoverMenuButton(func(m *ui.Menu) {
			if m.Item(a.t("All branches")).Checked(a.logAll).Chosen() {
				a.logAll = !a.logAll
				a.logDirty = true
				a.refresh()
			}
			if m.Item(a.t("Today")).Chosen() {
				now := time.Now()
				start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
				a.logOpts.Since, a.logOpts.Until = start.Unix(), 0
				a.logDirty = true
				a.refresh()
			}
			if m.Item(a.t("Last 7 days")).Chosen() {
				now := time.Now()
				start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -6)
				a.logOpts.Since, a.logOpts.Until = start.Unix(), 0
				a.logDirty = true
				a.refresh()
			}
			if m.Item(a.t("Clear dates")).Chosen() {
				a.logOpts.Since, a.logOpts.Until = 0, 0
				a.logDirty = true
				a.refresh()
			}
			if m.Item(a.t("Clear filters")).Chosen() {
				a.logOpts.Search, a.logOpts.Author, a.logOpts.Regex, a.logOpts.CaseSensitive = "", "", false, false
				a.logSearch, a.logAuthor, a.logRegex, a.logCase = "", "", false, false
				a.logDirty = true
				a.refresh()
			}
		})
		if _, clicked := a.smallIconButton(c, "rows", a.t("Mark equivalents"), false); clicked {
			a.markEquivalents()
		}
	})
}

func (a *nativeApp) logListView(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).FillHeight().Background(ui.Hex(p.panel)).Children(func() {
		a.logList.Key = func(i int) any {
			if i < 0 || i >= len(a.log.Commits) {
				return ""
			}
			return a.log.Commits[i].Hash
		}
		a.logList.Selection = &a.logPick
		a.logList.Selected = &a.logSel
		a.logList.Label = func(i int) string {
			if i < 0 || i >= len(a.log.Commits) {
				return ""
			}
			return a.log.Commits[i].Subject
		}
		ui.Row(c).Height(9).PaddingX(9).Gap(8).AlignItems(ui.Center).Children(func() {
			a.graphHeaderSpacer(c)
			a.logGrip(c, "hash", &a.logHashW, 40, 180)
			ui.Spacer(c).Grow(1)
			a.logGrip(c, "author", &a.logAuthorW, 50, 220)
			a.logGrip(c, "time", &a.logTimeW, 32, 100)
		})
		list := ui.List(c, &a.logList, len(a.log.Commits), func(i int) {
			if i < 0 || i >= len(a.log.Commits) {
				return
			}
			cm := a.log.Commits[i]
			row := ui.Row(c).Height(26).PaddingX(9).Gap(8).AlignItems(ui.Center).Radius(7).Margin(1, 0).ClipX()
			bg := ui.Transparent
			if i == a.logSel {
				bg = ui.Hex(p.selection)
			} else if row.Hovered() {
				bg = ui.Hex(p.hover)
			}
			row.Background(motionColor(row, "kit-log-row", bg))
			row.Children(func() {
				a.graphCellSized(c, i, 26)
				ui.Text(c, cm.Short).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.muted2)).Width(a.logHashW)
				ui.Text(c, cm.Subject).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1).Grow(1)
				for j, ref := range cm.Refs {
					if j >= 2 {
						break
					}
					a.refBadge(c, ref)
				}
				ui.Text(c, cm.Author).FontSize(10.5).TextColor(ui.Hex(p.muted)).MaxLines(1).Width(a.logAuthorW)
				ui.Text(c, a.stamp(cm.AuthorTime)).FontSize(10.5).TextColor(ui.Hex(p.muted2)).Width(a.logTimeW)
			})
			if row.RowDoubleClicked() {
				a.openCommitTab(cm.Hash)
			}
			row.ContextMenu(func(m *ui.Menu) {
				a.logCommitMenu(m, cm)
			})
		}).Grow(1).Padding(5, 6, 10, 6)
		if a.log.HasMore {
			more := ui.ButtonBase(c).Height(28).PaddingX(8).Radius(6).AlignItems(ui.Center).FillWidth().Justify(ui.Center)
			if more.Hovered() {
				more.Background(ui.Hex(p.hover))
			}
			more.Children(func() {
				ui.Text(c, a.t("Load more")).FontSize(11.5).TextColor(ui.Hex(p.accent))
			})
			if more.Clicked() {
				a.loadMoreLog()
			}
		}
		if list.Changed() {
			if a.logSel >= 0 && a.logSel < len(a.log.Commits) {
				a.loadLogDetail(a.log.Commits[a.logSel].Hash)
			}
		}
		if list.Submitted() {
			if a.logSel >= 0 && a.logSel < len(a.log.Commits) {
				a.openCommitTab(a.log.Commits[a.logSel].Hash)
			}
		}
		if len(a.log.Commits) == 0 {
			a.kitEmptyState(c, "commit", a.t("No commits"), "", ui.Hex(p.muted2))
		}
	})
}

func (a *nativeApp) loadLogDetail(hash string) {
	if hash == "" || hash == a.logDetailHash {
		return
	}
	a.logDetailHash = hash
	a.logDetailLoading = true
	go func() {
		d, err := a.g.ShowCommit(hash)
		mygo.RunOnMain(func() {
			if a.logDetailHash != hash {
				return
			}
			a.logDetailLoading = false
			if err != nil {
				a.fail(err)
				return
			}
			a.logDetail = &d
			a.redraw()
		})
	}()
}

func (a *nativeApp) logDetails(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).FillHeight().Background(ui.Hex(p.editor)).BorderWidth(0, 0, 0, 1).BorderColor(ui.Hex(p.border)).Children(func() {
		if a.logDetail == nil {
			a.kitEmptyState(c, "log", a.t("Select a commit to see its details"), "", ui.Hex(p.muted2))
			return
		}
		d := a.logDetail
		ui.Column(c).Padding(10, 12).Gap(5).BorderWidth(0, 0, 1, 0).
			BorderColor(ui.Hex(p.border)).Children(func() {
			ui.Text(c, d.Subject).FontSize(13).FontWeight(600).TextColor(ui.Hex(p.fg)).MaxLines(2)
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				for _, r := range d.Refs {
					a.refBadge(c, r)
				}
				ui.Text(c, d.Author).FontSize(10.5).TextColor(ui.Hex(p.muted))
				ui.Text(c, a.stamp(d.AuthorTime)).FontSize(10).TextColor(ui.Hex(p.muted2))
				ui.Spacer(c).Grow(1)
				hash := ui.ButtonBase(c).Height(18).PaddingX(5).Radius(5).Background(ui.Hex(p.hover)).
					AlignItems(ui.Center).Tooltip(a.t("Copy Revision Number"))
				hash.Children(func() {
					ui.Text(c, d.Short).FontSize(9.5).Font("monospace").TextColor(ui.Hex(p.muted2))
				})
				if hash.Clicked() {
					a.copyText(d.Hash)
				}
				if _, clicked := a.smallIconButton(c, "chevronUp", a.t("Previous commit"), false); clicked {
					a.stepLogDetail(-1)
				}
				if _, clicked := a.smallIconButton(c, "chevronDown", a.t("Next commit"), false); clicked {
					a.stepLogDetail(1)
				}
			})
			ui.Row(c).Gap(10).Children(func() {
				ui.Text(c, fmt.Sprintf("%d %s", d.Stats.Files, a.t("files"))).FontSize(10).TextColor(ui.Hex(p.muted))
				ui.Text(c, fmt.Sprintf("+%d", d.Stats.Additions)).FontSize(10).TextColor(ui.Hex(p.success))
				ui.Text(c, fmt.Sprintf("−%d", d.Stats.Deletions)).FontSize(10).TextColor(ui.Hex(p.danger))
			})
		})
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Padding(8, 10, 12, 10).Gap(6).Children(func() {
				ui.Row(c).Height(22).Gap(5).AlignItems(ui.Center).Children(func() {
					ui.Text(c, strings.ToUpper(a.t("Files"))).FontSize(10).FontWeight(650).
						LetterSpacing(0.06).TextColor(ui.Hex(p.muted))
					ui.Text(c, fmtInt(len(d.Files))).FontSize(10).TextColor(ui.Hex(p.muted2))
					ui.Spacer(c).Grow(1)
				})
				ui.Column(c).Gap(1).Children(func() {
					for _, f := range d.Files {
						f := f
						row := a.kitButtonRow(c, 30, 5, 6, 7, false)
						row.Children(func() {
							ui.Text(c, statusLetterKind(f.Status)).FontSize(10).Font("monospace").FontWeight(700).
								Width(12).TextColor(statusKindColor(p, f.Status))
							a.kitFileBadge(c, f.Path, 14)
							dir := filepath.Dir(f.Path)
							name := filepath.Base(f.Path)
							ui.Text(c, name).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
							if dir != "." {
								ui.Text(c, dir+"/").FontSize(10).TextColor(ui.Hex(p.muted2)).MaxLines(1)
							}
							ui.Spacer(c).Grow(1)
							if f.Additions > 0 {
								ui.Text(c, fmt.Sprintf("+%d", f.Additions)).FontSize(10).Font("monospace").TextColor(ui.Hex(p.success))
							}
							if f.Deletions > 0 {
								ui.Text(c, fmt.Sprintf("−%d", f.Deletions)).FontSize(10).Font("monospace").TextColor(ui.Hex(p.danger))
							}
						})
						if row.Clicked() {
							a.openDiff(git.DiffOptions{Path: f.Path, OldPath: f.OldPath, Target: git.DiffCommit, Revision: d.Hash, Context: a.settings.DiffContext})
						}
						row.ContextMenu(func(m *ui.Menu) {
							if m.Item(a.t("Open Source")).Chosen() {
								a.openSource(f.Path, d.Hash)
							}
							if m.Item(a.t("Show History")).Chosen() {
								a.showFileHistory(f.Path)
							}
							if m.Item(a.t("Copy Path")).Chosen() {
								a.copyText(f.Path)
							}
						})
					}
				})
				if d.Body != "" {
					ui.Box(c).Padding(8, 10).Radius(8).Background(ui.Hex(p.code)).
						Border(1, ui.Hex(p.border)).Children(func() {
						ui.Text(c, strings.TrimSpace(d.Body)).FontSize(11).TextColor(ui.Hex(p.fgSoft)).Wrap()
					})
				}
				ui.Row(c).Gap(6).PaddingY(4).Children(func() {
					if a.miniTextButton(c, a.t("Browse Revision"), false) {
						a.openRevisionTree(d.Hash)
					}
					if a.miniTextButton(c, a.t("Open Commit"), false) {
						a.openCommitTab(d.Hash)
					}
				})
			})
		})
	})
}

func (a *nativeApp) stepLogDetail(delta int) {
	if len(a.log.Commits) == 0 {
		return
	}
	i := a.logSel
	if i < 0 {
		i = 0
	}
	i = max(0, min(len(a.log.Commits)-1, i+delta))
	a.logSel = i
	a.loadLogDetail(a.log.Commits[i].Hash)
}

func statusKindColor(p appColors, kind string) ui.Color {
	switch kind {
	case "added":
		return ui.Hex(p.added)
	case "deleted":
		return ui.Hex(p.deleted)
	case "renamed", "copied":
		return ui.Hex(p.renamed)
	default:
		return ui.Hex(p.modified)
	}
}

func (a *nativeApp) tabStrip(c *ui.Context) {
	p := palette(c.Theme())
	ui.Row(c).Height(44).Gap(4).Padding(7, 10).AlignItems(ui.End).
		Background(ui.Hex(p.editor)).BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
		for i, tab := range a.tabs {
			i, tab := i, tab
			active := i == a.activeTab
			b, clicked, closeClicked := a.kitDocTab(c, tab.kind, tab.title, tab.path, active, tab.dirty())
			if closeClicked {
				a.closeTab(i)
			}
			if clicked && !closeClicked {
				a.activeTab = i
			}
			b.ContextMenu(func(m *ui.Menu) {
				if m.Item(a.t("Close")).Chosen() {
					a.closeTab(i)
				}
				if m.Item(a.t("Close Others")).Chosen() {
					a.closeOtherTabs(i)
				}
				if m.Item(a.t("Close All")).Chosen() {
					a.tabs = nil
					a.activeTab = 0
				}
				if m.Item(a.t("Close Unmodified")).Chosen() {
					var keep []*docTab
					for _, t := range a.tabs {
						if t.dirty() {
							keep = append(keep, t)
						}
					}
					a.tabs = keep
					if a.activeTab >= len(a.tabs) {
						a.activeTab = len(a.tabs) - 1
					}
				}
				if m.Item(a.t("Close to the Left")).Chosen() {
					a.tabs = append([]*docTab(nil), a.tabs[i:]...)
					a.activeTab = 0
				}
				if m.Item(a.t("Close to the Right")).Chosen() {
					a.tabs = append([]*docTab(nil), a.tabs[:i+1]...)
					a.activeTab = i
				}
			})
		}
	})
}

func (a *nativeApp) emptyEditor(c *ui.Context) {
	a.welcomeBody(c)
}

// welcomeBody is the right pane with nothing open: one gradient mark, the
// tagline, the way in, and the repositories last opened.
func (a *nativeApp) welcomeBody(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Fill().Background(ui.Hex(p.editor)).AlignItems(ui.Center).
		Justify(ui.Center).Padding(40, 32).Children(func() {
		ui.Box(c).Absolute().Fill().IgnoreInput(true).RadialGradient(ui.RadialGradient{
			Center: ui.Point{X: 0.5, Y: 0.05},
			Radius: 560,
			Stops: []ui.GradientStop{
				{Color: ui.RGBA(91, 102, 153, 0.10), At: 0},
				{Color: ui.RGBA(91, 102, 153, 0), At: 1},
			},
		})
		ui.Box(c).Size(76, 76).Radius(22).Center().
			Gradient(ui.Hex("#6f7bab"), ui.Hex("#3a4568"), 135).
			Shadow(0, 18, 44, 0, ui.RGBA(52, 62, 94, 0.24)).
			Children(func() {
				ui.Row(c).TextColor(ui.Hex("#ffffff")).Center().Children(func() {
					a.icon(c, "git", 36)
				})
			})
		ui.Text(c, a.t("No file open")).FontSize(32).FontWeight(700).LetterSpacing(-0.6).
			TextColor(ui.Hex(p.fg)).PaddingY(12)
		ui.Text(c, a.t("Choose a file, commit or conflict to see it here")).FontSize(14).
			TextColor(ui.Hex(p.muted)).MaxWidth(540)
		ui.Row(c).Gap(8).PaddingY(24).Children(func() {
			b := ui.ButtonBase(c).Height(36).PaddingX(20).Radius(18).Gap(7).AlignItems(ui.Center).
				Background(ui.Hex(p.accent)).Border(1, ui.Hex(p.accent)).
				Shadow(0, 6, 18, 0, ui.RGBA(91, 102, 153, 0.20))
			if b.Hovered() {
				b.Background(ui.Hex(p.accentHover))
			}
			b.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.accentText)).Center().Children(func() {
					a.icon(c, "open", 15)
				})
				ui.Text(c, a.t("Open Repository")).FontSize(13).FontWeight(600).TextColor(ui.Hex(p.accentText))
			})
			if b.Clicked() {
				a.chooseAndOpen()
			}
		})
		if a.loading {
			ui.Spinner(c)
			return
		}
		if len(a.recent) > 0 {
			ui.Column(c).Width(680).MaxWidthPercent(100).Gap(6).Children(func() {
				ui.Text(c, a.t("Recent repositories")).FontSize(11).TextColor(ui.Hex(p.muted2)).
					Padding(0, 2, 4, 2)
				for i, r := range a.recent {
					if i >= 5 {
						break
					}
					r := r
					row := ui.ButtonBase(c).Height(52).Padding(8, 12).Radius(8).
						AlignItems(ui.Center).Gap(10).Background(ui.Hex(p.raised)).
						Border(1, ui.Hex(p.border))
					if row.Hovered() {
						row.Background(ui.Hex(p.hover))
					}
					row.Children(func() {
						ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
							a.icon(c, "folder", 20)
						})
						ui.Column(c).Grow(1).Gap(1).Children(func() {
							ui.Text(c, r.Name).FontSize(13).FontWeight(550).TextColor(ui.Hex(p.fg))
							ui.Text(c, r.Path).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.muted2)).MaxLines(1)
						})
					})
					if row.Clicked() {
						a.openPath(r.Path)
					}
					row.ContextMenu(func(m *ui.Menu) {
						if m.Item(a.t("Forget")).Chosen() {
							_ = a.ws.RemoveRecent(r.Path)
							a.loadRecent()
						}
					})
				}
			})
		}
		if a.errText != "" {
			ui.Text(c, a.errText).FontSize(11).TextColor(ui.Hex(p.danger)).PaddingY(8)
		}
		ui.Row(c).Wrap().Gap(14).PaddingY(26).Children(func() {
			for _, h := range []struct{ key, label string }{
				{"⌘/Ctrl O", a.t("Open")},
				{"⌘/Ctrl P", a.t("Quick Open")},
				{"⌘/Ctrl K", a.t("Commit")},
				{"⌘/Ctrl Shift K", a.t("Push")},
				{"⌘/Ctrl T", a.t("Pull")},
			} {
				ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
					a.kbd(c, h.key)
					ui.Text(c, h.label).FontSize(10.5).TextColor(ui.Hex(p.muted2))
				})
			}
		})
	})
}

func (a *nativeApp) statusBar(c *ui.Context) {
	p := palette(c.Theme())
	st := a.snapshot.State
	ui.Row(c).Height(28).PaddingX(10).Gap(10).AlignItems(ui.Center).
		BorderWidth(1, 0, 0, 0).BorderColor(ui.Hex(p.border)).
		Background(ui.Hex(p.panel).Alpha(0.86)).Children(func() {
		branch := ui.ButtonBase(c).Height(22).PaddingX(7).Radius(6).Gap(5).AlignItems(ui.Center)
		if branch.Hovered() {
			branch.Background(ui.Hex(p.hover))
		}
		branch.Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.accent)).Center().Children(func() {
				a.icon(c, "branch", 13)
			})
			name := a.t("No repository")
			if a.repoOpen {
				switch {
				case st.Detached:
					name = a.t("detached")
				case st.Unborn:
					name = a.t("no commits yet")
				default:
					name = st.Branch
				}
			}
			ui.Text(c, name).FontSize(11).FontWeight(500).TextColor(ui.Hex(p.fgSoft))
			if st.Upstream != "" {
				ui.Text(c, st.Upstream).FontSize(10).TextColor(ui.Hex(p.muted2)).MaxLines(1)
			}
		})
		if branch.Clicked() {
			a.sideTab = 1
		}
		if a.repoOpen && (st.Ahead > 0 || st.Behind > 0) {
			if st.Ahead > 0 {
				if a.statusCount(c, "↑ "+fmtInt(st.Ahead), p.success, a.t("Push")) {
					a.openPushDialog()
				}
			}
			if st.Behind > 0 {
				if a.statusCount(c, "↓ "+fmtInt(st.Behind), p.deleted, a.t("Pull")) {
					a.openPullDialog()
				}
			}
		}
		if st.Operation != "" {
			ui.Row(c).Height(21).PaddingX(8).Radius(6).Gap(6).AlignItems(ui.Center).
				Background(ui.RGBA(168, 102, 28, 0.12)).Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.warning)).Center().Children(func() {
					a.icon(c, "warning", 12)
				})
				ui.Text(c, operationName(st.Operation)).FontSize(10.5).FontWeight(600).TextColor(ui.Hex(p.warning))
				if st.OpProgress != "" {
					ui.Text(c, st.OpProgress).FontSize(10).TextColor(ui.Hex(p.muted))
				}
				if st.Operation == "merge" && st.OpTheirs != "" {
					ui.Text(c, st.OpTheirs).FontSize(10).TextColor(ui.Hex(p.muted)).MaxLines(1)
				}
				if a.miniTextButton(c, a.t("Continue"), false) {
					a.continueOperation()
				}
				switch st.Operation {
				case "rebase", "rebase-interactive", "am", "cherry-pick", "revert":
					if a.miniTextButton(c, a.t("Skip"), false) {
						a.skipOperation()
					}
				}
				if a.miniTextButton(c, a.t("Abort"), true) {
					a.abortOperation()
				}
			})
		}
		if st.Conflicts > 0 {
			if a.statusCount(c, fmt.Sprintf("%s %d", a.t("conflicts"), st.Conflicts), p.danger, a.t("Resolve")) {
				a.openConflictSummary()
			}
		}
		ui.Spacer(c).Grow(1)
		if a.repoOpen {
			ui.Text(c, fmt.Sprintf("%d %s", st.Changed, a.t("changed"))).FontSize(10.5).TextColor(ui.Hex(p.muted))
			if st.Staged > 0 {
				ui.Text(c, fmt.Sprintf("%d %s", st.Staged, a.t("staged"))).FontSize(10.5).TextColor(ui.Hex(p.muted))
			}
			if st.Untracked > 0 {
				ui.Text(c, fmt.Sprintf("%d %s", st.Untracked, a.t("untracked"))).FontSize(10.5).TextColor(ui.Hex(p.muted))
			}
			ui.Text(c, a.repoRoot()).FontSize(10).TextColor(ui.Hex(p.muted)).MaxWidthPercent(38).MaxLines(1)
		}
		version := st.GitVersion
		if version == "" {
			version = "git"
		} else {
			version = "git " + version
		}
		ui.Text(c, version).FontSize(10).TextColor(ui.Hex(p.muted2))
	})
}

func (a *nativeApp) statusCount(c *ui.Context, label string, color string, tip string) bool {
	p := palette(c.Theme())
	b := ui.ButtonBase(c).Height(20).PaddingX(4).Radius(3).Tooltip(tip)
	if b.Hovered() {
		b.Background(ui.Hex(p.hover))
	}
	b.Children(func() {
		ui.Text(c, label).FontSize(10.5).TextColor(ui.Hex(color))
	})
	return b.Clicked()
}

func operationName(op string) string {
	switch op {
	case "rebase-interactive":
		return "Rebase"
	case "cherry-pick":
		return "Cherry-pick"
	}
	if op == "" {
		return ""
	}
	return strings.ToUpper(op[:1]) + op[1:]
}

func (a *nativeApp) sidebarSection(c *ui.Context, title string, n int, fn func()) {
	t := c.Theme()
	ui.Row(c).Padding(8, 8).Gap(6).AlignItems(ui.Center).Children(func() {
		ui.Text(c, title).FontSize(11).FontWeight(700).TextColor(t.TextMuted)
		if n >= 0 {
			ui.Text(c, fmt.Sprintf("%d", n)).FontSize(10).TextColor(t.TextMuted)
		}
	})
	fn()
}

// ----- files pane -------------------------------------------------------

func (a *nativeApp) filesPane(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Grow(1).MinHeight(0).Background(ui.Hex(p.panel)).Children(func() {
		ui.Row(c).Height(40).Padding(4, 10).Gap(3).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			if _, _, changed := a.searchBox(c, &a.fileFilter, a.t("Filter files"), 220); changed {
				a.rebuildFileTree()
			}
			ui.Spacer(c).Grow(1)
			if _, clicked := a.smallIconButton(c, "plus", a.t("New File"), false); clicked {
				a.promptNewFile("", false)
			}
			if _, clicked := a.smallIconButton(c, "folder", a.t("New Folder"), false); clicked {
				a.promptNewFolder("", true)
			}
		})
		if len(a.fileTree) == 0 {
			a.kitEmptyState(c, "files", a.t("No files"), "", ui.Hex(p.muted2))
		}
		a.fileList.Selected = &a.fileSel
		a.fileList.Label = func(i int) string {
			if i < 0 || i >= len(a.fileTree) {
				return ""
			}
			return a.fileTree[i].path
		}
		list := ui.List(c, &a.fileList, len(a.fileTree), func(i int) {
			if i < 0 || i >= len(a.fileTree) {
				return
			}
			f := a.fileTree[i]
			row := a.kitRow(c, 28, 6+float32(f.depth)*12, 10, 6, i == a.fileSel)
			if f.dir {
				if f.open {
					ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
						a.icon(c, "chevronDown", 11)
					})
				} else {
					ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
						a.icon(c, "chevronRight", 11)
					})
				}
			} else {
				ui.Spacer(c).Width(11)
			}
			row.Children(func() {
				icon := "file"
				if f.dir {
					if f.open {
						icon = "folderOpen"
					} else {
						icon = "folder"
					}
				}
				if f.dir {
					ui.Row(c).TextColor(ui.Hex(p.accent)).Center().Children(func() {
						a.icon(c, icon, 14)
					})
				} else {
					a.kitFileBadge(c, f.path, 14)
				}
				name := f.name
				if f.dir {
					name += "/"
				}
				ui.Text(c, name).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
				if kind, ok := a.changedKind(f.path); ok {
					ui.Spacer(c).Grow(1)
					ui.Text(c, kind).FontSize(10).Font("monospace").FontWeight(700).
						TextColor(statusKindColor(p, kind))
				}
			})
			if row.RowDoubleClicked() {
				if f.dir {
					a.toggleDir(f.path)
				} else {
					a.openSource(f.path, "")
				}
			}
			row.ContextMenu(func(m *ui.Menu) {
				if m.Item(a.t("Open")).Chosen() {
					if f.dir {
						a.toggleDir(f.path)
					} else {
						a.openSource(f.path, "")
					}
				}
				m.Separator()
				if m.Item(a.t("New File")).Chosen() {
					a.promptNewFile(f.path, f.dir)
				}
				if m.Item(a.t("New Folder")).Chosen() {
					a.promptNewFolder(f.path, f.dir)
				}
				if m.Item(a.t("Rename")).Chosen() {
					a.promptRename(f.path)
				}
				if m.Item(a.t("Delete")).Chosen() {
					a.confirmDelete(f.path)
				}
				m.Separator()
				if m.Item(a.t("Reveal")).Chosen() {
					_ = a.ws.Reveal(f.path)
				}
				if !f.dir && m.Item(a.t("Ignore")).Chosen() {
					a.ignore([]string{f.path})
				}
				if m.Item(a.t("Edit .gitignore")).Chosen() {
					a.editGitignore()
				}
				a.pathMenu(m, f.path, 0)
			})
		}).Grow(1)
		if list.Changed() {
			if a.fileSel >= 0 && a.fileSel < len(a.fileTree) && a.fileTree[a.fileSel].dir {
				a.toggleDir(a.fileTree[a.fileSel].path)
			}
		}
		if list.Submitted() {
			if a.fileSel >= 0 && a.fileSel < len(a.fileTree) {
				f := a.fileTree[a.fileSel]
				if f.dir {
					a.toggleDir(f.path)
				} else {
					a.openSource(f.path, "")
				}
			}
		}
	})
}

func (a *nativeApp) changedKind(path string) (string, bool) {
	for _, row := range a.changes {
		if row.change.Path == path {
			return statusLetterKind(row.change.Kind), true
		}
		for _, ch := range a.snapshot.Changes {
			if ch.Path == path {
				return statusLetterKind(ch.Kind), true
			}
		}
	}
	return "", false
}

func (a *nativeApp) rebuildFileTree() {
	q := strings.ToLower(strings.TrimSpace(a.fileFilter))
	if q == "" {
		a.fileTree = flattenFiles(a.files, a.openDirs)
		return
	}
	var matched []git.RepoFile
	for _, f := range a.files {
		if strings.Contains(strings.ToLower(f.Path), q) {
			matched = append(matched, f)
		}
	}
	sort.Slice(matched, func(i, j int) bool { return matched[i].Path < matched[j].Path })
	a.fileTree = a.fileTree[:0]
	for _, f := range matched {
		a.fileTree = append(a.fileTree, fileRow{path: f.Path, name: f.Path})
	}
}

func (a *nativeApp) toggleDir(path string) {
	a.openDirs[path] = !a.openDirs[path]
	a.rebuildFileTree()
}

func (a *nativeApp) changedPath(path string) bool {
	for _, row := range a.changes {
		if row.change.Path == path || strings.HasPrefix(path, row.change.Path+"/") {
			return true
		}
	}
	return false
}

// ----- branches pane ----------------------------------------------------

func (a *nativeApp) branchesPane(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Grow(1).MinHeight(0).Background(ui.Hex(p.panel)).Children(func() {
		ui.Row(c).Height(40).Padding(4, 10).Gap(3).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			if _, clicked := a.smallIconButton(c, "plus", a.t("New Branch"), false); clicked {
				a.openCreateBranchDialog(a.snapshot.State.Branch)
			}
			if _, clicked := a.smallIconButton(c, "fetch", a.t("Fetch"), false); clicked {
				a.fetch()
			}
			if _, clicked := a.smallIconButton(c, "trash", a.t("Cleanup"), false); clicked {
				a.openCleanupDialog()
			}
			ui.Spacer(c).Grow(1)
			if _, clicked := a.smallIconButton(c, "expand", a.t("Expand all"), false); clicked {
				a.branchClosed = map[string]bool{}
			}
			if _, clicked := a.smallIconButton(c, "collapse", a.t("Collapse all"), false); clicked {
				a.branchClosed = map[string]bool{"local": true, "remote": true, "tags": true}
			}
		})
		ui.Row(c).Padding(6, 6).Children(func() {
			if _, _, changed := a.searchBox(c, &a.branchSearch, a.t("Search branches"), 308); changed {
				a.redraw()
			}
		})
		if a.branchSearch == "" && len(a.recentBr) > 0 {
			ui.Row(c).Padding(0, 8, 6, 8).Gap(4).Wrap().Children(func() {
				ui.Text(c, a.t("Recent")).FontSize(9.5).TextColor(ui.Hex(p.muted2)).PaddingY(3)
				for _, name := range a.recentBr {
					if name == "" {
						continue
					}
					chip := ui.ButtonBase(c).Height(19).PaddingX(7).Radius(9).
						Border(1, ui.Hex(p.border)).Background(ui.Hex(p.raised))
					if chip.Hovered() {
						chip.Background(ui.Hex(p.hover))
					}
					chip.Children(func() {
						ui.Text(c, name).FontSize(10).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
					})
					if chip.Clicked() {
						a.loadBranchLog(name)
					}
				}
			})
		}
		ui.Scroll(c).Grow(1).MinHeight(0).Children(func() {
			ui.Column(c).Gap(1).Padding(2, 0, 8, 0).Children(func() {
				a.branchSection(c, a.t("Local branches"), a.branches, "local")
				a.branchSection(c, a.t("Remote branches"), a.branches, "remote")
				a.tagSection(c)
			})
		})
	})
}

func (a *nativeApp) branchSection(c *ui.Context, title string, rows []repoRefRow, group string) {
	p := palette(c.Theme())
	n := 0
	for _, row := range rows {
		if row.group == group && strings.Contains(strings.ToLower(row.ref.Name), strings.ToLower(a.branchSearch)) {
			n++
		}
	}
	closed := a.branchClosed[group]
	header := ui.ButtonBase(c).Height(28).PaddingX(8).Gap(5).AlignItems(ui.Center).FillWidth().Justify(ui.Start)
	if header.Hovered() {
		header.Background(ui.Hex(p.hover))
	}
	header.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			if closed {
				a.icon(c, "chevronRight", 11)
			} else {
				a.icon(c, "chevronDown", 11)
			}
		})
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			if group == "remote" {
				a.icon(c, "fetch", 12)
			} else {
				a.icon(c, "branch", 12)
			}
		})
		ui.Text(c, strings.ToUpper(title)).FontSize(10).FontWeight(650).LetterSpacing(0.07).TextColor(ui.Hex(p.muted))
		ui.Text(c, fmtInt(n)).FontSize(10).TextColor(ui.Hex(p.muted2))
	})
	if header.Clicked() {
		a.branchClosed[group] = !closed
	}
	if closed {
		return
	}
	var pinned []repoRefRow
	for i := range rows {
		ref := rows[i].ref
		if rows[i].group == group && containsString(a.c.meta.Favorites, ref.Name) &&
			(a.branchSearch == "" || strings.Contains(strings.ToLower(ref.Name), strings.ToLower(a.branchSearch))) {
			pinned = append(pinned, rows[i])
		}
	}
	for _, row := range pinned {
		a.branchLeaf(c, row.ref, group, true)
	}
	var order []string
	grouped := map[string][]repoRefRow{}
	for i := range rows {
		ref := rows[i].ref
		if rows[i].group != group || (a.branchSearch != "" && !strings.Contains(strings.ToLower(ref.Name), strings.ToLower(a.branchSearch))) {
			continue
		}
		if containsString(a.c.meta.Favorites, ref.Name) {
			continue
		}
		name := ref.Name
		if group == "remote" {
			if i := strings.IndexByte(name, '/'); i > 0 {
				name = name[:i]
			}
		} else if i := strings.IndexByte(name, '/'); i > 0 {
			name = name[:i]
		} else {
			name = a.t("main")
		}
		if _, ok := grouped[name]; !ok {
			order = append(order, name)
		}
		grouped[name] = append(grouped[name], rows[i])
	}
	for _, name := range order {
		key := group + ":" + name
		closed := a.branchClosed[key]
		head := a.kitButtonRow(c, 22, 19, 8, 5, false)
		head.Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
				if closed {
					a.icon(c, "chevronRight", 10)
				} else {
					a.icon(c, "chevronDown", 10)
				}
			})
			ui.Box(c).Size(6, 6).Radius(3).Background(branchToneColor(p, name))
			ui.Text(c, name).FontSize(11).FontWeight(500).TextColor(ui.Hex(p.fgSoft))
			ui.Text(c, fmtInt(len(grouped[name]))).FontSize(9.5).TextColor(ui.Hex(p.muted2))
		})
		if head.Clicked() {
			a.branchClosed[key] = !closed
		}
		if closed {
			continue
		}
		for _, row := range grouped[name] {
			a.branchLeaf(c, row.ref, group, false)
		}
	}
}

func (a *nativeApp) branchLeaf(c *ui.Context, ref git.RepoRef, group string, full bool) {
	p := palette(c.Theme())
	selected := len(a.logOpts.Refs) == 1 && a.logOpts.Refs[0] == ref.Name
	pad := float32(30)
	name := ref.Name
	if full {
		pad = 19
	} else if i := strings.IndexByte(name, '/'); i > 0 {
		name = name[i+1:]
	}
	btn := a.kitButtonRow(c, 25, pad, 8, 6, selected)
	btn.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.accent)).Center().Children(func() {
			a.icon(c, "branch", 12)
		})
		ui.Text(c, name).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
		if ref.Head {
			ui.Row(c).TextColor(ui.Hex(p.accent)).Center().Children(func() {
				a.icon(c, "check", 11)
			})
		}
		ui.Spacer(c).Grow(1)
		if ref.Ahead > 0 {
			ui.Text(c, "↑"+fmtInt(ref.Ahead)).FontSize(9.5).TextColor(ui.Hex(p.success))
		}
		if ref.Behind > 0 {
			ui.Text(c, "↓"+fmtInt(ref.Behind)).FontSize(9.5).TextColor(ui.Hex(p.danger))
		}
		if containsString(a.c.meta.Favorites, ref.Name) {
			ui.Row(c).TextColor(ui.Hex(p.warning)).Center().Children(func() {
				a.icon(c, "star", 11)
			})
		}
	})
	if btn.DoubleClicked() {
		a.loadBranchLog(ref.Name)
	}
	btn.ContextMenu(func(m *ui.Menu) { a.branchContextMenu(m, ref, group) })
}

func (a *nativeApp) branchContextMenu(m *ui.Menu, ref git.RepoRef, group string) {
	if !ref.Head && m.Item(a.t("Checkout")).Chosen() {
		a.checkout(ref.Name)
	}
	if m.Item(a.t("Checkout and Update")).Chosen() {
		a.checkoutUpdate(ref.Name)
	}
	if m.Item(a.t("Show Log")).Chosen() {
		a.openRefLog(ref)
	}
	if m.Item(a.t("Compare with Current")).Chosen() {
		a.openCompare(ref.Name, a.snapshot.State.Branch)
	}
	if !ref.Head && m.Item(a.t("Merge into Current")).Chosen() {
		a.openMergeDialog(ref.Name)
	}
	if !ref.Head && m.Item(a.t("Rebase Current onto This")).Chosen() {
		a.openRebaseDialog(ref.Name)
	}
	m.Separator()
	if m.Item(a.t("New Branch Here")).Chosen() {
		a.openCreateBranchDialog(ref.Name)
	}
	if m.Item(a.t("Copy Name")).Chosen() {
		a.copyText(ref.Name)
	}
	if m.Item(a.t("Copy Revision Number")).Chosen() {
		a.copyText(ref.Hash)
	}
	if containsString(a.c.meta.Favorites, ref.Name) {
		if m.Item(a.t("Remove from Favorites")).Chosen() {
			a.toggleFavoriteBranch(ref.Name)
		}
	} else if m.Item(a.t("Add to Favorites")).Chosen() {
		a.toggleFavoriteBranch(ref.Name)
	}
	m.Separator()
	if m.Item(a.t("Push Branch…")).Chosen() {
		a.openPushDialogForBranch(ref.Name)
	}
	if ref.Head && m.Item(a.t("Pull Branch…")).Chosen() {
		a.openPullDialogForBranch(ref.Name)
	}
	if group == "local" && !ref.Head {
		m.Separator()
		if m.Item(a.t("Rename")).Chosen() {
			a.promptRenameBranch(ref.Name)
		}
		if m.Item(a.t("Delete")).Chosen() {
			a.deleteBranch(ref.Name)
		}
		if m.Item(a.t("Set Upstream")).Chosen() {
			a.openUpstreamDialog(ref.Name)
		}
		if m.Item(a.t("Reset to Remote")).Chosen() {
			name := ref.Name
			a.busyRun("reset", func() error {
				_, err := a.g.ResetToRemote(name)
				return err
			})
		}
		if m.Item(a.t("Update Selected")).Chosen() {
			name := ref.Name
			a.busyRun("update", func() error {
				_, err := a.g.UpdateSelected(name)
				return err
			})
		}
	}
}

func branchToneColor(p appColors, name string) ui.Color {
	switch len(name) % 4 {
	case 0:
		return ui.Hex(p.lane0)
	case 1:
		return ui.Hex(p.lane1)
	case 2:
		return ui.Hex(p.lane2)
	default:
		return ui.Hex(p.lane3)
	}
}

func (a *nativeApp) loadBranchLog(name string) {
	for _, row := range a.branches {
		if row.ref.Name == name {
			a.openRefLog(row.ref)
			return
		}
	}
	a.logOpts.Refs = []string{name}
	a.logDirty = true
	a.refresh()
}

func (a *nativeApp) tagSection(c *ui.Context) {
	p := palette(c.Theme())
	closed := a.branchClosed["tags"]
	header := ui.ButtonBase(c).Height(28).PaddingX(8).Gap(5).AlignItems(ui.Center).FillWidth().Justify(ui.Start)
	if header.Hovered() {
		header.Background(ui.Hex(p.hover))
	}
	header.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			if closed {
				a.icon(c, "chevronRight", 11)
			} else {
				a.icon(c, "chevronDown", 11)
			}
		})
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			a.icon(c, "tag", 12)
		})
		ui.Text(c, strings.ToUpper(a.t("Tags"))).FontSize(10).FontWeight(650).LetterSpacing(0.07).TextColor(ui.Hex(p.muted))
		ui.Text(c, fmtInt(len(a.tags))).FontSize(10).TextColor(ui.Hex(p.muted2))
		ui.Spacer(c).Grow(1)
		if _, clicked := a.smallIconButton(c, "plus", a.t("New Tag"), false); clicked {
			a.openCreateTagDialog(a.snapshot.State.Head)
		}
	})
	if header.Clicked() {
		a.branchClosed["tags"] = !closed
	}
	if closed {
		return
	}
	for _, row := range a.tags {
		ref := row.ref
		if a.branchSearch != "" && !strings.Contains(strings.ToLower(ref.Name), strings.ToLower(a.branchSearch)) {
			continue
		}
		line := a.kitButtonRow(c, 38, 19, 8, 6, false)
		line.Children(func() {
			ui.Column(c).Gap(1).Grow(1).Children(func() {
				ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
					ui.Row(c).TextColor(ui.Hex(p.accentAlt)).Center().Children(func() {
						a.icon(c, "tag", 12)
					})
					ui.Text(c, ref.Name).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
					ui.Spacer(c).Grow(1)
					ui.Text(c, a.stamp(ref.Time)).FontSize(9.5).TextColor(ui.Hex(p.muted2))
				})
				ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
					ui.Text(c, ref.Short).FontSize(9.5).Font("monospace").TextColor(ui.Hex(p.muted2))
					ui.Text(c, ref.Subject).FontSize(10.5).TextColor(ui.Hex(p.muted)).MaxLines(1)
				})
			})
		})
		if line.Clicked() {
			a.openRefLog(ref)
		}
		line.ContextMenu(func(m *ui.Menu) {
			if m.Item(a.t("Checkout")).Chosen() {
				a.checkout(ref.Name)
			}
			if m.Item(a.t("New Branch Here")).Chosen() {
				a.openCreateBranchDialog(ref.Name)
			}
			if m.Item(a.t("Compare with Current")).Chosen() {
				a.openCompare(ref.Name, a.snapshot.State.Branch)
			}
			if m.Item(a.t("Copy Name")).Chosen() {
				a.copyText(ref.Name)
			}
			if m.Item(a.t("Push Tag")).Chosen() {
				tag := ref.Name
				remote := ""
				if len(a.remotes) > 0 {
					remote = a.remotes[0].Name
				}
				a.busyRun("push-tag", func() error {
					_, err := a.g.PushTag(remote, tag)
					return err
				})
			}
			if m.Item(a.t("Delete Tag")).Chosen() {
				a.deleteTag(ref.Name)
			}
		})
	}
}

func (a *nativeApp) graphHeaderSpacer(c *ui.Context) {
	w := graphWidth(a.graph)
	if w < 32 {
		w = 32
	}
	ui.Spacer(c).Width(w)
}

func (a *nativeApp) logGrip(c *ui.Context, key string, width *float32, lo, hi float32) {
	p := palette(c.Theme())
	g := ui.Box(c).Width(5).Height(9).Cursor(ui.CursorResizeColumn)
	g.Draw(func(pt *ui.Painter, r ui.Rect) {
		col := ui.Hex(p.border)
		if g.Hovered() || a.logGripKey == key {
			col = ui.Hex(p.accent)
		}
		pt.Fill(ui.Rect{X: r.X + r.W/2 - 0.5, Y: r.Y, W: 1, H: r.H}, col, 0)
	})
	if dx, _, dragging := g.Dragged(); dragging {
		if a.logGripKey != key {
			a.logGripKey = key
			a.logGripStart = *width
		}
		v := a.logGripStart + dx
		if v < lo {
			v = lo
		}
		if v > hi {
			v = hi
		}
		*width = v
	} else if a.logGripKey == key {
		a.logGripKey = ""
	}
}

func (a *nativeApp) graphCell(c *ui.Context, row int) {
	a.graphCellSized(c, row, 30)
}

func (a *nativeApp) graphCellSized(c *ui.Context, row int, height float32) {
	if row < 0 || row >= len(a.graph) {
		ui.Spacer(c).Width(32)
		return
	}
	g := a.graph[row]
	width := graphWidth(a.graph)
	if width < 32 {
		width = 32
	}
	box := ui.Box(c).Width(width).Height(height)
	colors := graphColors(c.Theme())
	bg := ui.Hex(palette(c.Theme()).editor)
	box.Draw(func(p *ui.Painter, r ui.Rect) {
		mid := r.Y + r.H/2
		x := func(lane int) float32 { return r.X + 7 + float32(lane)*graphLaneWidth }
		for lane, hash := range g.before {
			if hash == "" {
				continue
			}
			c := colors[lane%len(colors)]
			if lane < len(g.faint) && g.faint[lane] {
				c = c.Alpha(0.3)
			}
			p.Line(x(lane), r.Y, x(lane), mid, 1.6, c)
		}
		for lane, hash := range g.after {
			if hash == "" {
				continue
			}
			p.Line(x(lane), mid, x(lane), r.Y+r.H, 1.6, colors[lane%len(colors)])
		}
		for _, target := range g.edges {
			p.Line(x(g.lane), mid, x(target), r.Y+r.H, 1.6, colors[g.lane%len(colors)])
		}
		c := colors[g.lane%len(colors)]
		cx := x(g.lane)
		p.Fill(ui.Rect{X: cx - 4.6, Y: mid - 4.6, W: 9.2, H: 9.2}, bg, 4.6)
		p.Stroke(ui.Rect{X: cx - 4.6, Y: mid - 4.6, W: 9.2, H: 9.2}, c, 4.6, 1.6)
	})
}

func graphColors(t *ui.Theme) []ui.Color {
	p := palette(t)
	return []ui.Color{
		ui.Hex(p.lane0),
		ui.Hex(p.lane1),
		ui.Hex(p.lane2),
		ui.Hex(p.lane3),
		ui.Hex(p.lane4),
		ui.Hex(p.lane5),
	}
}

// ----- console ----------------------------------------------------------

func (a *nativeApp) consolePane(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Grow(1).MinHeight(0).Background(ui.Hex(p.panel)).Children(func() {
		ui.Row(c).Height(40).Padding(4, 10).Gap(3).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			if next := a.kitSegmented(c, []string{a.t("Command"), a.t("Operations")}, a.consoleTab); next != a.consoleTab {
				a.consoleTab = next
			}
			ui.Spacer(c).Grow(1)
			if _, clicked := a.smallIconButton(c, "copy", a.t("Copy Output"), false); clicked {
				a.copyText(strings.Join(a.consoleLog, "\n"))
			}
			if _, clicked := a.smallIconButton(c, "trash", a.t("Clear"), false); clicked {
				a.consoleLog = nil
			}
			if _, clicked := a.smallIconButton(c, "external", a.t("Log File"), false); clicked {
				if path, err := a.g.JournalFile(); err == nil {
					_ = a.ws.Reveal(path)
				}
			}
		})
		ui.Scroll(c).Grow(1).Background(ui.Hex(p.code)).Children(func() {
			ui.Column(c).Padding(6, 8).Gap(1).Children(func() {
				if a.consoleTab == 0 {
					if len(a.consoleLog) == 0 {
						ui.Text(c, a.t("No commands yet")).FontSize(10.5).TextColor(ui.Hex(p.muted2))
					}
					for _, line := range a.consoleLog {
						col := p.fgSoft
						if strings.HasPrefix(strings.TrimSpace(line), "$") {
							col = p.accent
						}
						ui.Text(c, line).FontSize(11).Font("monospace").TextColor(ui.Hex(col))
					}
					return
				}
				for i := len(a.journal) - 1; i >= 0; i-- {
					e := a.journal[i]
					ui.Text(c, a.stamp(e.At/1000)+"  "+e.Action).FontSize(10).FontWeight(600).TextColor(ui.Hex(p.fg))
					for _, cmd := range e.Commands {
						ui.Text(c, "$ "+cmd).FontSize(10).Font("monospace").TextColor(ui.Hex(p.accent))
					}
					if e.Output != "" {
						ui.Text(c, strings.TrimRight(e.Output, "\n")).FontSize(10).Font("monospace").TextColor(ui.Hex(p.fgSoft))
					}
					if e.Error != "" {
						ui.Text(c, e.Error).FontSize(10).TextColor(ui.Hex(p.danger))
					}
					ui.Spacer(c).Height(6)
				}
				if len(a.journal) == 0 {
					ui.Text(c, a.t("No operations yet")).FontSize(10.5).TextColor(ui.Hex(p.muted2))
				}
			})
		})
		if len(a.consoleComp) > 0 {
			ui.Column(c).MaxHeight(120).Background(ui.Hex(p.raised)).BorderWidth(1, 0, 0, 0).
				BorderColor(ui.Hex(p.border)).Children(func() {
				for _, comp := range a.consoleComp {
					comp := comp
					row := ui.ButtonBase(c).Height(22).PaddingX(8).AlignItems(ui.Center)
					if row.Hovered() {
						row.Background(ui.Hex(p.selection))
					}
					row.Children(func() {
						ui.Text(c, comp.Text).FontSize(11).Font("monospace").TextColor(ui.Hex(p.fgSoft))
					})
					if row.Clicked() {
						if a.consoleIn != "" && !strings.HasSuffix(a.consoleIn, " ") {
							a.consoleIn += " "
						}
						a.consoleIn += comp.Text
						a.consoleComp = nil
					}
				}
			})
		}
		ui.Row(c).Height(32).Padding(6, 8).Gap(6).AlignItems(ui.Center).
			BorderWidth(1, 0, 0, 0).BorderColor(ui.Hex(p.border)).Background(ui.Hex(p.panel)).Children(func() {
			history, _ := a.kitIconButton(c, "clock", a.t("History"), 24, 13, false, false, false)
			history.PopoverMenuButton(func(m *ui.Menu) {
				for i, line := range a.consoleHis {
					if i > 20 {
						break
					}
					line := line
					if m.Item(line).Chosen() {
						a.consoleIn = line
					}
				}
			})
			if strings.HasPrefix(strings.TrimSpace(a.consoleIn), "!") {
				ui.Box(c).Height(20).PaddingX(6).Radius(5).Background(ui.Hex(p.hoverStrong)).Center().Children(func() {
					ui.Text(c, "$").FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.muted))
				})
			} else {
				program := ui.ButtonBase(c).Height(20).PaddingX(6).Radius(5).Background(ui.Hex(p.accentSoft)).
					AlignItems(ui.Center).Tooltip(a.t("Program"))
				program.Children(func() {
					ui.Text(c, a.consoleProgram).FontSize(10.5).FontWeight(600).TextColor(ui.Hex(p.accent))
				})
				program.PopoverMenuButton(func(m *ui.Menu) {
					for _, name := range []string{"git", "npm", "pnpm", "bun", "go", "mvn", "gradle", "make"} {
						name := name
						if m.Item(name).Checked(name == a.consoleProgram).Chosen() {
							a.consoleProgram = name
						}
					}
					m.Separator()
					if m.Item(a.t("Shell command (!)")).Chosen() {
						a.consoleIn = "! " + a.consoleIn
					}
				})
			}
			in := ui.TextInputBase(c, &a.consoleIn).FontSize(11.5).Font("monospace").
				Placeholder(a.t("git status")).Grow(1).PaddingX(4)
			if in.Submitted() {
				a.runConsole()
			}
			in.OnShortcut(0, ui.KeyTab, a.completeConsole)
		})
	})
}

// ----- shared helpers ---------------------------------------------------

func (a *nativeApp) pickedChangeRows() []changeRow {
	var out []changeRow
	for _, row := range a.changes {
		key := row.change.Path
		if row.staged {
			key = "staged:" + key
		}
		if a.changePicked[key] {
			out = append(out, row)
		}
	}
	return out
}

func (a *nativeApp) pickedChangePaths(staged bool) []string {
	var out []string
	for _, row := range a.pickedChangeRows() {
		if row.staged == staged {
			out = append(out, row.change.Path)
		}
	}
	return out
}

func (a *nativeApp) openSelectedChange() {
	if a.changeSel < 0 || a.changeSel >= len(a.changes) {
		return
	}
	a.openDiffFor(a.changes[a.changeSel])
}

func (a *nativeApp) openDiffFor(row changeRow) {
	ch := row.change
	if ch.Unmerged {
		a.openMergeWindow(ch.Path)
		return
	}
	target := git.DiffWorkingTree
	if row.staged {
		target = git.DiffStaged
	}
	a.openDiff(git.DiffOptions{
		Path:    ch.Path,
		OldPath: ch.OldPath,
		Target:  target,
		Context: a.settings.DiffContext,
	})
}

func (a *nativeApp) openCommitTab(hash string) {
	if hash == "" {
		return
	}
	id := "commit:" + hash
	if i := a.findTab(id); i >= 0 {
		a.activeTab = i
		a.redraw()
		return
	}
	a.busy++
	go func() {
		detail, err := a.g.ShowCommit(hash)
		mygoMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			tab := &docTab{kind: tabCommit, id: id, title: detail.Short, revision: hash, commit: detail}
			if i := a.findTab(id); i >= 0 {
				a.tabs[i] = tab
				a.activeTab = i
			} else {
				a.tabs = append(a.tabs, tab)
				a.activeTab = len(a.tabs) - 1
			}
			a.redraw()
		})
	}()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// mygoMain posts fn to the UI thread, and does nothing before the window
// exists.
func mygoMain(fn func()) { mygo.RunOnMain(fn) }

// sortRepoRefs orders branches the way the branch list shows them.
func sortRepoRefs(refs []git.RepoRef) {
	sort.SliceStable(refs, func(i, j int) bool { return refs[i].Name < refs[j].Name })
}

var _ = editor.NewBuffer

// logCommitMenu is the history row's menu: the page's commit operations,
// including the ones that were implemented but unreachable before.
func (a *nativeApp) logCommitMenu(m *ui.Menu, cm git.Commit) {
	if m.Item(a.t("Open Commit")).Chosen() {
		a.openCommitTab(cm.Hash)
	}
	if m.Item(a.t("Edit History…")).Chosen() {
		a.openRewrite(cm.Hash)
	}
	m.Separator()
	if m.Item(a.t("Checkout")).Chosen() {
		a.checkout(cm.Hash)
	}
	m.Submenu(a.t("Reset"), func(sm *ui.Menu) {
		if sm.Item(a.t("Soft")).Chosen() {
			a.busyRun("reset", func() error { _, err := a.g.Reset(cm.Hash, "soft"); return err })
		}
		if sm.Item(a.t("Mixed")).Chosen() {
			a.busyRun("reset", func() error { _, err := a.g.Reset(cm.Hash, "mixed"); return err })
		}
		if sm.Item(a.t("Hard")).Chosen() {
			a.dialog = dialogState{kind: dialogConfirm, title: a.t("Reset"), message: fmt.Sprintf(a.t("Hard reset to %s?"), cm.Short), action: "hard-reset", target: cm.Hash}
		}
	})
	if m.Item(a.t("Cherry-Pick")).Chosen() {
		a.busyRun("cherry-pick", func() error { _, err := a.g.CherryPick([]string{cm.Hash}, false); return err })
	}
	if m.Item(a.t("Revert")).Chosen() {
		a.busyRun("revert", func() error { _, err := a.g.Revert([]string{cm.Hash}); return err })
	}
	m.Submenu(a.t("Commit Fixup"), func(sm *ui.Menu) {
		if sm.Item(a.t("Fixup")).Chosen() {
			a.busyRun("fixup", func() error { _, err := a.g.CommitFixup(cm.Hash, false); return err })
		}
		if sm.Item(a.t("Squash")).Chosen() {
			a.busyRun("fixup", func() error { _, err := a.g.CommitFixup(cm.Hash, true); return err })
		}
	})
	m.Separator()
	if m.Item(a.t("Copy Revision Number")).Chosen() {
		a.copyText(cm.Hash)
	}
	if m.Item(a.t("Copy Commit Message")).Chosen() {
		a.copyText(cm.Message)
	}
	if m.Item(a.t("Create Branch")).Chosen() {
		a.openCreateBranchDialog(cm.Hash)
	}
	if m.Item(a.t("Create Tag")).Chosen() {
		a.openCreateTagDialog(cm.Hash)
	}
	if len(a.remotes) > 0 && m.Item(a.t("Push Commits up to Here…")).Chosen() {
		a.openPushDialogForHash(cm.Hash)
	}
}

func (a *nativeApp) logSelectionMenu(m *ui.Menu) {
	hashes := a.pickedHashes()
	if len(hashes) == 0 {
		return
	}
	if m.Item(a.t("Cherry-Pick Selected")).Chosen() {
		a.busyRun("cherry-pick", func() error { _, err := a.g.CherryPick(hashes, false); return err })
	}
	if m.Item(a.t("Revert Selected")).Chosen() {
		a.busyRun("revert", func() error { _, err := a.g.Revert(hashes); return err })
	}
	if m.Item(a.t("Edit History…")).Chosen() {
		a.openRewrite(hashes[len(hashes)-1])
	}
	if len(a.remotes) > 0 && m.Item(a.t("Push Commits up to Here…")).Chosen() {
		a.openPushDialogForHash(hashes[len(hashes)-1])
	}
	m.Separator()
	if m.Item(a.t("Clear")).Chosen() {
		a.logPick.Clear()
	}
}
