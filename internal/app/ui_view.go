package app

import (
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

// mainView is the repository window: title bar, tool window, editor area
// and status bar.
func (a *nativeApp) mainView(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Background(t.Background).Children(func() {
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
	title := ui.Row(c).Height(44).PaddingStart(12).PaddingEnd(10).AlignItems(ui.Center).Gap(2).
		BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).DragWindow().
		Gradient(ui.Hex(p.panel2), ui.Hex(p.panel), 90)
	if runtime.GOOS == "darwin" {
		title.PaddingStart(84)
	}
	title.Children(func() {
		ui.Row(c).Gap(7).PaddingEnd(8).AlignItems(ui.Center).Children(func() {
			ui.Box(c).Size(24, 24).Radius(7).Center().
				Gradient(ui.Hex("#6f7bab"), ui.Hex("#3a4568"), 135).
				Shadow(0, 2, 8, 0, ui.RGBA(58, 69, 104, 0.20)).
				Children(func() {
					ui.Row(c).TextColor(ui.Hex("#ffffff")).Center().Children(func() {
						a.icon(c, "git", 17)
					})
				})
			ui.Text(c, "GitJet").FontSize(13).FontWeight(650)
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
			if _, clicked := a.titleIconButton(c, "open", a.t("Open Repository"), false, false); clicked {
				a.chooseAndOpen()
			}
			toolbarRule(c)
			if _, clicked := a.titleIconButton(c, "refresh", a.t("Refresh"), a.busy > 0, false); clicked {
				a.refresh()
			}
			fetch, clicked := a.titleIconButton(c, "fetch", a.t("Fetch"), !a.repoOpen, a.snapshot.State.Behind > 0)
			fetch.ContextMenu(func(m *ui.Menu) {
				if m.Item(a.t("All remotes")).Chosen() {
					a.fetchWith(git.FetchOptions{All: true, Prune: true})
				}
				if m.Item("origin").Chosen() {
					a.fetchWith(git.FetchOptions{Remote: "origin", Prune: true})
				}
				if m.Item(a.t("Prune")).Chosen() {
					a.fetchWith(git.FetchOptions{All: true, Prune: true})
				}
				if m.Item(a.t("Tags")).Chosen() {
					a.fetchWith(git.FetchOptions{All: true, Prune: true, Tags: true})
				}
			})
			if clicked {
				a.fetchWith(git.FetchOptions{All: true, Prune: true})
			}
			if _, clicked := a.titleIconButton(c, "pull", a.t("Pull"), !a.repoOpen || a.busy > 0, a.snapshot.State.Behind > 0); clicked {
				a.openPullDialog()
			}
			_, clicked = a.titleIconButton(c, "push", a.t("Push"), !a.repoOpen || a.busy > 0, a.snapshot.State.Ahead > 0)
			if clicked {
				a.openPushDialog()
			}
			ui.Spacer(c).Grow(1)
			ui.Spacer(c).Grow(1)
			if _, clicked := a.titleIconButton(c, "settings", a.t("Settings"), false, false); clicked {
				a.openSettingsDialog()
			}
		})
		a.quickTrigger(c)
	})
}

// quickTrigger is the centered search affordance of the title bar.
func (a *nativeApp) quickTrigger(c *ui.Context) {
	p := palette(c.Theme())
	quick := ui.ButtonBase(c).Absolute().LeftPercent(50).TranslatePercent(-50, 0).
		Height(30).Width(240).Radius(9).PaddingX(10).Gap(8).AlignItems(ui.Center).
		Background(ui.Hex(p.raised)).Border(1, ui.Hex(p.border)).Tooltip(a.t("Quick Open")).
		Disabled(!a.repoOpen)
	if quick.Hovered() {
		quick.Background(ui.Hex(p.raised)).BorderColor(ui.Hex(p.borderStrong))
	}
	quick.Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			a.icon(c, "search", 14)
		})
		ui.Text(c, a.t("Search files")).FontSize(12).TextColor(ui.Hex(p.muted)).Grow(1)
		ui.Box(c).Height(18).PaddingX(5).Radius(5).Background(ui.Hex(p.hover)).Center().Children(func() {
			ui.Text(c, "⌘P").FontSize(9).TextColor(ui.Hex(p.muted2))
		})
	})
	if quick.Clicked() {
		a.openQuickOpen()
	}
}

func (a *nativeApp) toolWindow(c *ui.Context) {
	t := c.Theme()
	p := palette(t)
	ui.Column(c).FillHeight().Background(ui.Hex(p.panel)).BorderWidth(0, 1, 0, 0).
		BorderColor(ui.Hex(p.border)).Children(func() {
		// The page ordered its tools Files, Commit, Branch, Console; the
		// history lived in the dock below the editor, not here.
		tabs := []struct {
			index int
			label string
		}{
			{2, a.t("Files")},
			{0, a.t("Commit")},
			{1, a.t("Branches")},
			{4, a.t("Console")},
		}
		ui.Row(c).Height(36).PaddingX(6).Gap(2).AlignItems(ui.Center).
			Background(ui.Hex(p.panel2)).BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			for _, tab := range tabs {
				tab := tab
				active := a.sideTab == tab.index
				b := ui.ButtonBase(c).Height(27).PaddingX(9).Radius(4).Gap(6).AlignItems(ui.Center)
				if active {
					b.Background(ui.Hex(p.raised))
				} else if b.Hovered() {
					b.Background(ui.Hex(p.hover))
				}
				b.Children(func() {
					col := p.muted
					if active {
						col = p.fg
					}
					ui.Row(c).TextColor(ui.Hex(col)).Center().Children(func() {
						a.icon(c, iconNameForTab(tab.index), 14)
					})
					ui.Text(c, tab.label).FontSize(12).TextColor(ui.Hex(col))
					if tab.index == 0 {
						countBadge(c, a.snapshot.State.Changed+a.snapshot.State.Untracked+a.snapshot.State.Conflicts)
					}
				})
				if b.Clicked() {
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
		ui.Row(c).Height(33).PaddingX(6).Gap(2).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			if _, clicked := a.iconButton(c, "refresh", a.t("Refresh"), false); clicked {
				a.refresh()
			}
			toolbarRule(c)
			if _, clicked := a.iconButton(c, "expand", a.t("Expand all"), false); clicked {
				a.showStaged = true
				a.rebuildRows()
			}
			if _, clicked := a.iconButton(c, "collapse", a.t("Collapse all"), false); clicked {
				a.showStaged = false
				a.rebuildRows()
			}
			ui.Spacer(c).Grow(1)
			if _, clicked := a.iconButton(c, "files", a.t("Show files"), false); clicked {
				a.sideTab = 2
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
		// The changelist row.
		changelist := a.activeChangelistName()
		ui.Row(c).Height(27).Padding(0, 8, 0, 6).Gap(5).AlignItems(ui.Center).Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
				a.icon(c, "check", 13)
			})
			ui.Text(c, strings.ToUpper(changelist)).FontSize(11).FontWeight(650).
				TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
			ui.Text(c, "("+a.t("active")+")").FontSize(10).TextColor(ui.Hex(p.muted2))
			ui.Text(c, fmtInt(len(a.changes))).FontSize(10.5).TextColor(ui.Hex(p.muted2))
			ui.Spacer(c).Grow(1)
			if _, clicked := a.smallIconButton(c, "plus", a.t("New Changelist"), false); clicked {
				a.dialog = dialogState{kind: dialogPrompt, title: a.t("New Changelist"), message: a.t("Name"), action: "new-changelist"}
			}
			more := ui.ButtonBase(c).Size(22, 22).Radius(4).Center().Tooltip(a.t("Changelist actions"))
			if more.Hovered() {
				more.Background(ui.Hex(p.hover))
			}
			more.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
					a.icon(c, "more", 13)
				})
			})
			more.PopoverMenuButton(func(m *ui.Menu) {
				if m.Item(a.t("Rename Changelist")).Chosen() {
					a.dialog = dialogState{kind: dialogPrompt, title: a.t("Rename Changelist"), message: a.t("Name"), action: "rename-changelist", target: a.snapshot.Changelists.Active, text: a.activeChangelistName()}
				}
				if m.Item(a.t("Delete Changelist")).Chosen() {
					id := a.snapshot.Changelists.Active
					a.dialog = dialogState{kind: dialogConfirm, title: a.t("Delete Changelist"), message: a.t("Delete the active changelist?"), action: "delete-changelist", target: id}
				}
				m.Separator()
				for _, cl := range a.snapshot.Changelists.Items {
					label := cl.Name
					if cl.ID == a.snapshot.Changelists.Active {
						label = "✓ " + label
					}
					id := cl.ID
					if m.Item(label).Chosen() {
						a.setActiveChangelist(id)
					}
				}
			})
		})
		// Section heading and the list.
		ui.Row(c).Height(24).PaddingX(8).Gap(5).AlignItems(ui.Center).Children(func() {
			ui.Text(c, a.t("Changed files")).FontSize(11.5).FontWeight(600).TextColor(ui.Hex(p.fg))
			ui.Text(c, fmtInt(len(a.changes))).FontSize(10.5).TextColor(ui.Hex(p.muted2))
			ui.Spacer(c).Grow(1)
			allChecked := true
			for _, row := range a.changes {
				key := row.change.Path
				if row.staged {
					key = "staged:" + key
				}
				if !a.checked[key] {
					allChecked = false
					break
				}
			}
			if len(a.changes) > 0 {
				if ui.Checkbox(c, &allChecked, "").Changed() {
					for _, row := range a.changes {
						key := row.change.Path
						if row.staged {
							key = "staged:" + key
						}
						a.checked[key] = allChecked
					}
				}
			}
		})
		if len(a.changes) == 0 {
			ui.Column(c).Grow(1).MinHeight(0).Center().Gap(8).Padding(28, 20).Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.success)).Center().Children(func() {
					a.icon(c, "check", 20)
				})
				ui.Text(c, a.t("No local changes")).FontSize(12).TextColor(ui.Hex(p.muted))
				ui.Text(c, a.t("The working tree is clean.")).FontSize(11).TextColor(ui.Hex(p.muted2))
			})
		} else {
			ui.Scroll(c).Grow(1).MinHeight(0).Children(func() {
				ui.Column(c).Gap(1).Padding(2, 0, 8, 0).Children(func() {
					staged, changed, untracked := 0, 0, 0
					for _, row := range a.changes {
						switch {
						case row.staged:
							staged++
						case row.change.Kind == "untracked":
							untracked++
						case row.change.Kind == "ignored":
						default:
							changed++
						}
					}
					if staged > 0 {
						a.changeSection(c, a.t("Staged Changes"), staged, "stage")
					}
					for i, row := range a.changes {
						if row.staged {
							a.changeRow(c, i)
						}
					}
					if changed > 0 {
						a.changeSection(c, a.t("Changed files"), changed, "file")
					}
					for i, row := range a.changes {
						if row.staged || row.change.Kind == "untracked" || row.change.Kind == "ignored" || row.change.Unmerged {
							continue
						}
						a.changeRow(c, i)
					}
					conflicts := 0
					for _, row := range a.changes {
						if row.change.Unmerged {
							conflicts++
						}
					}
					if conflicts > 0 {
						a.changeSection(c, a.t("Merge Conflicts"), conflicts, "warning")
					}
					for i, row := range a.changes {
						if row.change.Unmerged {
							a.changeRow(c, i)
						}
					}
					if untracked > 0 {
						a.changeSection(c, a.t("Untracked files"), untracked, "file")
					}
					for i, row := range a.changes {
						if row.change.Kind != "untracked" {
							continue
						}
						a.changeRow(c, i)
					}
					if a.settings.ShowIgnored {
						ignored := 0
						for _, row := range a.changes {
							if row.change.Kind == "ignored" {
								ignored++
							}
						}
						if ignored > 0 {
							a.changeSection(c, a.t("Ignored Files"), ignored, "eye")
							for i, row := range a.changes {
								if row.change.Kind == "ignored" {
									a.changeRow(c, i)
								}
							}
						}
					}
				})
			})
		}
		a.stashSection(c)
		a.commitBox(c)
	})
}

func (a *nativeApp) changeSection(c *ui.Context, title string, count int, icon string) {
	p := palette(c.Theme())
	ui.Row(c).Height(25).Padding(0, 8, 0, 6).Gap(5).AlignItems(ui.Center).Background(ui.Hex(p.panel)).Children(func() {
		ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
			a.icon(c, icon, 13)
		})
		ui.Text(c, title).FontSize(12).FontWeight(600).TextColor(ui.Hex(p.fg))
		ui.Text(c, fmt.Sprintf("%d %s", count, a.t("files"))).FontSize(10.5).TextColor(ui.Hex(p.muted2))
	})
}

func (a *nativeApp) changeRow(c *ui.Context, i int) {
	if i < 0 || i >= len(a.changes) {
		return
	}
	p := palette(c.Theme())
	row := a.changes[i]
	ch := row.change
	line := ui.Row(c).Height(23).PaddingX(8).Gap(5).AlignItems(ui.Center)
	if i == a.changeSel {
		line.Background(ui.Hex(p.selection))
	} else if line.Hovered() {
		line.Background(ui.Hex(p.hover))
	}
	if line.Clicked() {
		a.changeSel = i
	}
	if line.DoubleClicked() {
		a.changeSel = i
		a.openSelectedChange()
	}
	line.Children(func() {
		if !ch.Unmerged && ch.Kind != "ignored" {
			key := ch.Path
			if row.staged {
				key = "staged:" + key
			}
			v := a.checked[key]
			if ui.Checkbox(c, &v, "").Changed() {
				a.checked[key] = v
			}
		}
		mark := statusLetter(ch)
		ui.Text(c, mark).FontSize(10.5).Font("monospace").FontWeight(700).Width(13).
			TextColor(statusColor(c.Theme(), ch))
		ui.Row(c).TextColor(fileTint(ch.Path)).Center().Children(func() {
			a.icon(c, "file", 14)
		})
		ui.Text(c, filepath.Base(ch.Path)).FontSize(12.5).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
		if dir := filepath.Dir(ch.Path); dir != "." && !row.staged {
			ui.Text(c, dir+"/").FontSize(10.5).TextColor(ui.Hex(p.muted2)).MaxLines(1)
		}
		ui.Spacer(c).Grow(1)
		if ch.Additions > 0 {
			ui.Text(c, fmt.Sprintf("+%d", ch.Additions)).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.added))
		}
		if ch.Deletions > 0 {
			ui.Text(c, fmt.Sprintf("−%d", ch.Deletions)).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.deleted))
		}
		if row.staged {
			ui.Box(c).Size(5, 5).Radius(3).Background(ui.Hex(p.accent))
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
	t := c.Theme()
	ui.Row(c).Padding(6, 8).Gap(6).AlignItems(ui.Center).Children(func() {
		ui.Text(c, a.t("Stashes")).FontSize(10).FontWeight(700).TextColor(t.TextMuted)
		ui.Text(c, fmt.Sprintf("%d", len(a.snapshot.Stashes))).FontSize(9).TextColor(t.TextMuted)
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Clear")).Clicked() {
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
				row := ui.Row(c).Height(22).Padding(2, 8).Gap(6).AlignItems(ui.Center)
				row.Children(func() {
					ui.Text(c, st.Message).FontSize(10).MaxLines(1)
					ui.Spacer(c).Grow(1)
					ui.Text(c, a.stamp(st.Time)).FontSize(9).TextColor(t.TextMuted)
				})
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
	ui.Column(c).Padding(7, 8).Gap(6).BorderWidth(1, 0, 0, 0).BorderColor(ui.Hex(p.border)).
		Background(ui.Hex(p.panel)).Children(func() {
		ui.Box(c).Children(func() {
			msg := ui.TextArea(c, &a.commitForm.Message).Height(76).FontSize(12.5).
				Placeholder(a.t("Commit message"))
			if a.focusCommit > 0 {
				msg.AutoFocus()
				a.focusCommit = 0
			}
			ui.Row(c).Absolute().Top(5).Right(5).Gap(1).Children(func() {
				history := ui.ButtonBase(c).Size(20, 20).Radius(3).Center().Tooltip(a.t("Recent messages"))
				if history.Hovered() {
					history.Background(ui.Hex(p.hover))
				}
				history.Children(func() {
					ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
						a.icon(c, "clock", 13)
					})
				})
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
				reflow := ui.ButtonBase(c).Size(20, 20).Radius(3).Center().Tooltip(a.t("Reformat to 72 columns"))
				if reflow.Hovered() {
					reflow.Background(ui.Hex(p.hover))
				}
				reflow.Children(func() {
					ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
						a.icon(c, "rows", 13)
					})
				})
				if reflow.Clicked() {
					a.commitForm.Message = wrapCommitMessage(a.commitForm.Message, 72)
				}
			})
		})
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Checkbox(c, &a.commitForm.Amend, a.t("Amend"))
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
				ui.Checkbox(c, &a.commitForm.SignOff, a.t("Sign-off commit"))
				ui.Checkbox(c, &a.commitForm.NoVerify, a.t("Skip hooks (--no-verify)"))
				ui.Checkbox(c, &a.commitForm.AllowEmpty, a.t("Allow an empty commit"))
				ui.Checkbox(c, &a.commitForm.Sign, a.t("Sign the commit (GPG)"))
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
		canCommit := strings.TrimSpace(a.commitForm.Message) != "" || a.commitForm.Amend
		ui.Row(c).Gap(0).Children(func() {
			main := ui.ButtonBase(c).Height(30).Grow(1).Radius(5).Gap(6).Center().
				Background(ui.Hex(p.accent)).Disabled(a.busy > 0 || !canCommit)
			if main.Hovered() && canCommit {
				main.Background(ui.Hex(p.accentHover))
			}
			main.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.accentText)).Center().Children(func() {
					a.icon(c, "commit", 15)
				})
				label := a.t("Commit")
				if count > 0 {
					label = fmt.Sprintf("%s (%d)", a.t("Commit"), count)
				}
				ui.Text(c, label).FontSize(12.5).FontWeight(600).TextColor(ui.Hex(p.accentText))
			})
			if main.Clicked() && canCommit {
				a.commitForm.PushAfter = false
				a.commitForm.RebaseAfter = false
				a.commitForm.SelectedOnly = false
				a.requestCommit()
			}
			arrow := ui.ButtonBase(c).Size(30, 30).Center().Radius(5).
				Background(ui.Hex(p.accent)).Disabled(a.busy > 0 || !canCommit)
			if arrow.Hovered() && canCommit {
				arrow.Background(ui.Hex(p.accentHover))
			}
			arrow.BorderWidth(0, 0, 0, 1).BorderColor(ui.RGBA(255, 255, 255, 0.28))
			arrow.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.accentText)).Center().Children(func() {
					a.icon(c, "chevronUp", 12)
				})
			})
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
}

func (a *nativeApp) editorArea(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).FillHeight().Background(ui.Hex(p.editor)).Children(func() {
		a.tabStrip(c)
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
	ui.Row(c).Height(33).PaddingX(6).Gap(2).AlignItems(ui.Center).
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
		if _, submitted, _ := a.searchBox(c, &a.logSearch, a.t("Search commits"), 235); submitted {
			a.logOpts.Search = strings.TrimSpace(a.logSearch)
			a.logDirty = true
			a.refresh()
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
		if _, submitted, _ := a.searchBox(c, &a.logAuthor, a.t("Author"), 96); submitted {
			a.logOpts.Author = strings.TrimSpace(a.logAuthor)
			a.logDirty = true
			a.refresh()
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
		list := ui.List(c, &a.logList, len(a.log.Commits), func(i int) {
			if i < 0 || i >= len(a.log.Commits) {
				return
			}
			cm := a.log.Commits[i]
			row := ui.Row(c).Height(26).Padding(4, 10).Gap(8).AlignItems(ui.Center)
			row.Children(func() {
				a.graphCellSized(c, i, 26)
				ui.Text(c, cm.Short).FontSize(10.5).Font("monospace").TextColor(ui.Hex(p.muted2)).Width(58)
				ui.Text(c, cm.Subject).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1).Grow(1)
				for j, ref := range cm.Refs {
					if j >= 2 {
						break
					}
					a.refBadge(c, ref.Name)
				}
				ui.Text(c, cm.Author).FontSize(10.5).TextColor(ui.Hex(p.muted)).MaxLines(1).Width(88)
				ui.Text(c, a.stamp(cm.AuthorTime)).FontSize(10.5).TextColor(ui.Hex(p.muted2)).MaxLines(1)
			})
			if row.RowDoubleClicked() {
				a.openCommitTab(cm.Hash)
			}
			row.ContextMenu(func(m *ui.Menu) {
				if m.Item(a.t("Open Commit")).Chosen() {
					a.openCommitTab(cm.Hash)
				}
				if m.Item(a.t("Copy Revision Number")).Chosen() {
					a.copyText(cm.Hash)
				}
				if m.Item(a.t("Create Branch")).Chosen() {
					a.openCreateBranchDialog(cm.Hash)
				}
				if m.Item(a.t("Create Tag")).Chosen() {
					a.openCreateTagDialog(cm.Hash)
				}
			})
		}).Grow(1)
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
			ui.Column(c).Fill().Center().Gap(8).Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
					a.icon(c, "commit", 20)
				})
				ui.Text(c, a.t("No commits")).FontSize(11).TextColor(ui.Hex(p.muted))
			})
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
			ui.Column(c).Fill().Center().Gap(8).Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
					a.icon(c, "log", 20)
				})
				ui.Text(c, a.t("Select a commit to see its details")).FontSize(11).TextColor(ui.Hex(p.muted))
			})
			return
		}
		d := a.logDetail
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Padding(12, 14).Gap(8).Children(func() {
				ui.Text(c, d.Subject).FontSize(12.5).FontWeight(600).TextColor(ui.Hex(p.fg)).MaxLines(2)
				ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
					for _, r := range d.Refs {
						a.refBadge(c, r.Name)
					}
					ui.Text(c, d.Author).FontSize(10.5).TextColor(ui.Hex(p.muted))
					ui.Text(c, a.stamp(d.AuthorTime)).FontSize(10.5).TextColor(ui.Hex(p.muted2))
					ui.Spacer(c).Grow(1)
					ui.Text(c, d.Short).FontSize(10).Font("monospace").TextColor(ui.Hex(p.muted2))
				})
				ui.Row(c).Gap(10).Children(func() {
					ui.Text(c, fmt.Sprintf("%d %s", d.Stats.Files, a.t("files"))).FontSize(10).TextColor(ui.Hex(p.muted))
					ui.Text(c, fmt.Sprintf("+%d", d.Stats.Additions)).FontSize(10).TextColor(ui.Hex(p.success))
					ui.Text(c, fmt.Sprintf("−%d", d.Stats.Deletions)).FontSize(10).TextColor(ui.Hex(p.danger))
				})
				if d.Body != "" {
					ui.Box(c).Padding(8, 10).Radius(8).Background(ui.Hex(p.code)).
						Border(1, ui.Hex(p.border)).Children(func() {
						ui.Text(c, strings.TrimSpace(d.Body)).FontSize(11).TextColor(ui.Hex(p.fgSoft)).Wrap()
					})
				}
				ui.Box(c).Height(1).Background(ui.Hex(p.border)).MarginY(2)
				ui.Column(c).Gap(1).Children(func() {
					for _, f := range d.Files {
						f := f
						row := ui.ButtonBase(c).Height(26).PaddingX(4).Radius(5).AlignItems(ui.Center).Gap(7)
						if row.Hovered() {
							row.Background(ui.Hex(p.hover))
						}
						row.Children(func() {
							ui.Text(c, statusLetterKind(f.Status)).FontSize(10).Font("monospace").FontWeight(700).
								Width(12).TextColor(statusKindColor(p, f.Status))
							ui.Text(c, f.Path).FontSize(11).TextColor(ui.Hex(p.fgSoft)).MaxLines(1).Grow(1)
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
					}
				})
				ui.Row(c).Gap(6).PaddingY(4).Children(func() {
					if a.miniTextButton(c, a.t("Copy Revision Number"), false) {
						a.copyText(d.Hash)
					}
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
			b := ui.ButtonBase(c).Height(34).Radius(9).Gap(7).PaddingX(10).AlignItems(ui.Center)
			if active {
				b.Background(ui.Hex(p.raised)).Border(1, ui.Hex(p.border)).
					Shadow(0, 1, 2, 0, ui.RGBA(16, 24, 40, 0.05))
			} else if b.Hovered() {
				b.Background(ui.Hex(p.hover))
			}
			b.Children(func() {
				if active {
					ui.Box(c).Absolute().Top(0).Left(8).Right(8).Height(2).Radius(2).
						Gradient(ui.Hex(p.accent), ui.Hex(p.accentAlt), 0)
				}
				icon := "file"
				switch tab.kind {
				case tabDiff:
					icon = "diff"
				case tabRevisionTree:
					icon = "folder"
				}
				col := p.muted
				if active {
					col = p.fg
				}
				ui.Row(c).TextColor(ui.Hex(col)).Center().Children(func() {
					a.icon(c, icon, 13)
				})
				ui.Text(c, tab.title).FontSize(12).TextColor(ui.Hex(col)).MaxLines(1)
				if tab.dirty() {
					ui.Box(c).Size(5, 5).Radius(3).Background(ui.Hex(p.accent))
				}
				close := ui.ButtonBase(c).Size(16, 16).Radius(3).Center()
				if close.Hovered() {
					close.Background(ui.Hex(p.hoverStrong))
				}
				close.Children(func() {
					ui.Row(c).TextColor(ui.Hex(p.muted2)).Center().Children(func() {
						a.icon(c, "close", 11)
					})
				})
				if close.Clicked() {
					a.closeTab(i)
				}
			})
			if b.Clicked() {
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
		Gradient(ui.Hex(p.panel), ui.Hex(p.panel).Mix(ui.Hex(p.bg), 0.18), 90).Children(func() {
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
		ui.Row(c).Height(33).PaddingX(6).Gap(4).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			if _, _, changed := a.searchBox(c, &a.fileFilter, a.t("Filter files"), 228); changed {
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
			ui.Column(c).Grow(1).Center().Children(func() {
				ui.Text(c, a.t("No files")).TextColor(ui.Hex(p.muted)).FontSize(11)
			})
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
			row := ui.Row(c).Height(24).PaddingStart(6 + float32(f.depth)*12).PaddingEnd(8).Gap(5).AlignItems(ui.Center)
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
					ui.Row(c).TextColor(fileTint(f.path)).Center().Children(func() {
						a.icon(c, icon, 14)
					})
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
		if list.Changed() || list.Submitted() {
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
		ui.Row(c).Height(33).PaddingX(6).Gap(1).AlignItems(ui.Center).
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
	header := ui.ButtonBase(c).Height(26).PaddingX(6).Gap(5).AlignItems(ui.Center).FillWidth().Justify(ui.Start)
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
		ui.Text(c, title).FontSize(11.5).FontWeight(600).TextColor(ui.Hex(p.fg))
		ui.Text(c, fmtInt(n)).FontSize(10).TextColor(ui.Hex(p.muted2))
	})
	if header.Clicked() {
		a.branchClosed[group] = !closed
	}
	if closed {
		return
	}
	for i := range rows {
		if rows[i].group != group {
			continue
		}
		ref := rows[i].ref
		if a.branchSearch != "" && !strings.Contains(strings.ToLower(ref.Name), strings.ToLower(a.branchSearch)) {
			continue
		}
		selected := len(a.logOpts.Refs) == 1 && a.logOpts.Refs[0] == ref.Name
		row := ui.ButtonBase(c).Height(26).PaddingStart(19).PaddingEnd(8).Radius(4).Gap(6).AlignItems(ui.Center).FillWidth().Justify(ui.Start)
		if selected {
			row.Background(ui.Hex(p.selection))
		} else if row.Hovered() {
			row.Background(ui.Hex(p.hover))
		}
		row.Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.accent)).Center().Children(func() {
				a.icon(c, "branch", 12)
			})
			ui.Text(c, ref.Name).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
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
		})
		if row.Clicked() {
			a.loadBranchLog(ref.Name)
		}
		if row.DoubleClicked() && !ref.Head {
			a.checkout(ref.Name)
		}
		row.ContextMenu(func(m *ui.Menu) {
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
		})
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
	header := ui.ButtonBase(c).Height(26).PaddingX(6).Gap(5).AlignItems(ui.Center).FillWidth().Justify(ui.Start)
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
		ui.Text(c, a.t("Tags")).FontSize(11.5).FontWeight(600).TextColor(ui.Hex(p.fg))
		ui.Text(c, fmtInt(len(a.tags))).FontSize(10).TextColor(ui.Hex(p.muted2))
		ui.Spacer(c).Grow(1)
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
		line := ui.ButtonBase(c).Height(26).PaddingStart(19).PaddingEnd(8).Radius(4).Gap(6).AlignItems(ui.Center).FillWidth().Justify(ui.Start)
		if line.Hovered() {
			line.Background(ui.Hex(p.hover))
		}
		line.Children(func() {
			ui.Row(c).TextColor(ui.Hex(p.accentAlt)).Center().Children(func() {
				a.icon(c, "tag", 12)
			})
			ui.Text(c, ref.Name).FontSize(12).TextColor(ui.Hex(p.fgSoft)).MaxLines(1)
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
	box.Draw(func(p *ui.Painter, r ui.Rect) {
		mid := r.Y + r.H/2
		x := func(lane int) float32 { return r.X + 7 + float32(lane)*graphLaneWidth }
		for lane, hash := range g.before {
			if hash == "" {
				continue
			}
			c := colors[lane%len(colors)]
			if lane < len(g.faint) && g.faint[lane] {
				c = c.Alpha(0.35)
			}
			p.Line(x(lane), r.Y, x(lane), mid, 1.5, c)
		}
		for lane, hash := range g.after {
			if hash == "" {
				continue
			}
			p.Line(x(lane), mid, x(lane), r.Y+r.H, 1.5, colors[lane%len(colors)])
		}
		for _, target := range g.edges {
			p.Line(x(g.lane), mid, x(target), r.Y+r.H, 1.5, colors[g.lane%len(colors)])
		}
		c := colors[g.lane%len(colors)]
		p.Fill(ui.Rect{X: x(g.lane) - 3.5, Y: mid - 3.5, W: 7, H: 7}, c, 3.5)
	})
}

func graphColors(t *ui.Theme) []ui.Color {
	return []ui.Color{
		t.Accent,
		t.Success,
		t.Warning,
		t.Danger,
		ui.Hex("#a855f7"),
		ui.Hex("#06b6d4"),
	}
}

// ----- console ----------------------------------------------------------

func (a *nativeApp) consolePane(c *ui.Context) {
	p := palette(c.Theme())
	ui.Column(c).Grow(1).MinHeight(0).Background(ui.Hex(p.panel)).Children(func() {
		ui.Row(c).Height(33).PaddingX(6).Gap(2).AlignItems(ui.Center).
			BorderWidth(0, 0, 1, 0).BorderColor(ui.Hex(p.border)).Children(func() {
			for i, label := range []string{a.t("Command"), a.t("Operations")} {
				i := i
				b := ui.ButtonBase(c).Height(27).PaddingX(9).Radius(4).AlignItems(ui.Center)
				if a.consoleTab == i {
					b.Background(ui.Hex(p.raised))
				} else if b.Hovered() {
					b.Background(ui.Hex(p.hover))
				}
				b.Children(func() {
					ui.Text(c, label).FontSize(12).TextColor(ui.Hex(p.fgSoft))
				})
				if b.Clicked() {
					a.consoleTab = i
				}
			}
			ui.Spacer(c).Grow(1)
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
			ui.Column(c).Padding(8, 10).Gap(1).Children(func() {
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
		ui.Row(c).Height(36).PaddingX(6).Gap(4).AlignItems(ui.Center).
			BorderWidth(1, 0, 0, 0).BorderColor(ui.Hex(p.border)).Background(ui.Hex(p.panel)).Children(func() {
			if _, clicked := a.smallIconButton(c, "clock", a.t("History"), false); clicked {
				// The menu is attached to the button below; retain the
				// keyboard shortcut as the visible affordance.
			}
			history := ui.ButtonBase(c).Height(24).PaddingX(7).Radius(4).Gap(4).AlignItems(ui.Center)
			if history.Hovered() {
				history.Background(ui.Hex(p.hover))
			}
			history.Children(func() {
				ui.Row(c).TextColor(ui.Hex(p.muted)).Center().Children(func() {
					a.icon(c, "clock", 13)
				})
				ui.Text(c, a.t("History")).FontSize(11).TextColor(ui.Hex(p.muted))
			})
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
			ui.Text(c, "$").FontSize(12).Font("monospace").FontWeight(700).TextColor(ui.Hex(p.accent))
			in := ui.TextInputBase(c, &a.consoleIn).FontSize(12).Font("monospace").
				Placeholder(a.t("git status")).Grow(1).PaddingX(4)
			if in.Submitted() {
				a.runConsole()
			}
			if a.primaryButton(c, a.t("Run")) {
				a.runConsole()
			}
			if _, clicked := a.smallIconButton(c, "sparkle", a.t("Complete"), false); clicked {
				a.completeConsole()
			}
		})
	})
}

// ----- shared helpers ---------------------------------------------------

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
	a.busy++
	go func() {
		detail, err := a.g.ShowCommit(hash)
		mygoMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			a.dialog = dialogState{kind: dialogCommitDetail, commit: detail, hash: hash}
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
