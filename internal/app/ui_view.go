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
	t := c.Theme()
	h := float32(52)
	title := ui.Row(c).Height(h).PaddingStart(12).PaddingEnd(12).AlignItems(ui.Center).Gap(8).DragWindow()
	title.BorderWidth(0, 0, 1, 0).BorderColor(t.Border)
	if runtime.GOOS == "darwin" {
		title.PaddingStart(84)
	}
	title.Children(func() {
		name := "GitJet"
		if a.repoOpen {
			name = a.snapshot.State.Name
			if name == "" {
				name = filepath.Base(a.snapshot.State.Root)
			}
		}
		ui.Text(c, name).FontWeight(700).FontSize(14)
		if a.repoOpen {
			ui.Text(c, a.snapshot.State.Branch).TextColor(t.TextMuted).FontSize(12)
		}
		ui.Spacer(c).Grow(1)
		if a.repoOpen {
			if ui.Button(c, a.t("Open")).Clicked() {
				a.chooseAndOpen()
			}
			if ui.Button(c, a.t("Refresh")).Disabled(a.busy > 0).Clicked() {
				a.refresh()
			}
			if ui.Button(c, a.t("Fetch")).Disabled(a.busy > 0).Clicked() {
				a.fetch()
			}
			if ui.Button(c, a.t("Pull")).Disabled(a.busy > 0).Clicked() {
				a.openPullDialog()
			}
			push := ui.Button(c, a.t("Push")).Disabled(a.busy > 0)
			if a.snapshot.State.Ahead > 0 {
				push.FocusRingColor(t.Success)
			}
			if push.Clicked() {
				a.openPushDialog()
			}
			if ui.Button(c, a.t("Quick Open")).Clicked() {
				a.openQuickOpen()
			}
			if ui.Button(c, a.t("Console")).Clicked() {
				a.sideTab = 4
			}
		}
		if ui.Button(c, a.t("Settings")).Clicked() {
			a.openSettingsDialog()
		}
	})
}

func (a *nativeApp) toolWindow(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).FillHeight().Background(t.Surface).Children(func() {
		ui.Column(c).Padding(8, 8).Children(func() {
			ui.Tabs(c, &a.sideTab, a.t("Commit"), a.t("Branches"), a.t("Files"), a.t("Log"), a.t("Console"))
		})
		switch a.sideTab {
		case 0:
			a.commitPane(c)
		case 1:
			a.branchesPane(c)
		case 2:
			a.filesPane(c)
		case 3:
			a.logPane(c)
		case 4:
			a.consolePane(c)
		}
	})
}

func (a *nativeApp) commitPane(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Grow(1).MinHeight(0).Children(func() {
		ui.Row(c).Padding(6, 8).Gap(6).Children(func() {
			if ui.Button(c, a.t("Stage All")).Clicked() {
				var paths []string
				for _, row := range a.changes {
					if !row.staged && !row.change.Unmerged {
						paths = append(paths, row.change.Path)
					}
				}
				a.stage(paths)
			}
			if ui.Button(c, a.t("Unstage All")).Clicked() {
				var paths []string
				for _, row := range a.changes {
					if row.staged {
						paths = append(paths, row.change.Path)
					}
				}
				a.unstage(paths)
			}
			ui.MenuButton(c, a.activeChangelistName(), func(m *ui.Menu) {
				if m.Item(a.t("New Changelist")).Chosen() {
					a.dialog = dialogState{kind: dialogPrompt, title: a.t("New Changelist"), message: a.t("Name"), action: "new-changelist"}
				}
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
			ui.Spacer(c).Grow(1)
			if ui.Button(c, a.t("Stash")).Clicked() {
				a.openStashDialog()
			}
		})
		if len(a.changes) == 0 {
			ui.Text(c, a.t("No local changes")).TextColor(t.TextMuted).Padding(12)
		}
		a.changeList.Selected = &a.changeSel
		a.changeList.Label = func(i int) string {
			if i < 0 || i >= len(a.changes) {
				return ""
			}
			return a.changes[i].change.Path
		}
		list := ui.List(c, &a.changeList, len(a.changes), func(i int) {
			a.changeRow(c, i)
		}).Grow(1)
		if list.Changed() || list.Submitted() {
			a.openSelectedChange()
		}
		a.stashSection(c)
		a.commitBox(c)
	})
}

func (a *nativeApp) changeRow(c *ui.Context, i int) {
	if i < 0 || i >= len(a.changes) {
		return
	}
	t := c.Theme()
	row := a.changes[i]
	ch := row.change
	line := ui.Row(c).Height(28).Padding(4, 8).Gap(6).AlignItems(ui.Center)
	line.BorderWidth(0, 0, 1, 0).BorderColor(t.Border)
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
		ui.Text(c, mark).FontSize(10).FontWeight(700).Width(14).TextColor(statusColor(t, ch))
		ui.Text(c, filepath.Base(ch.Path)).FontSize(12)
		if dir := filepath.Dir(ch.Path); dir != "." && !row.staged {
			ui.Text(c, dir).FontSize(10).TextColor(t.TextMuted)
		}
		ui.Spacer(c).Grow(1)
		if ch.Additions > 0 {
			ui.Text(c, fmt.Sprintf("+%d", ch.Additions)).FontSize(10).TextColor(t.Success)
		}
		if ch.Deletions > 0 {
			ui.Text(c, fmt.Sprintf("−%d", ch.Deletions)).FontSize(10).TextColor(t.Danger)
		}
		if row.staged {
			ui.Text(c, "●").FontSize(8).TextColor(t.Accent)
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
	case "added", "untracked":
		return "A"
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
	t := c.Theme()
	ui.Column(c).Padding(8).Gap(6).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
		ui.TextArea(c, &a.commitForm.Message).Height(88).Placeholder(a.t("Commit message"))
		ui.Row(c).Gap(6).Children(func() {
			ui.Checkbox(c, &a.commitForm.Amend, a.t("Amend"))
			ui.Checkbox(c, &a.commitForm.SignOff, a.t("Sign-off"))
			ui.Checkbox(c, &a.commitForm.NoVerify, a.t("Skip hooks"))
		})
		ui.Row(c).Gap(6).Children(func() {
			ui.Checkbox(c, &a.commitForm.AllowEmpty, a.t("Allow empty"))
			ui.Checkbox(c, &a.commitForm.Sign, a.t("Sign"))
			ui.Spacer(c).Grow(1)
			ui.MenuButton(c, a.t("Message"), func(m *ui.Menu) {
				if m.Item(a.t("Reformat to 72 columns")).Chosen() {
					a.commitForm.Message = wrapCommitMessage(a.commitForm.Message, 72)
				}
				if m.Item(a.t("Last Commit Message")).Chosen() {
					if msg := a.lastCommitMessage(); msg != "" {
						a.commitForm.Message = msg
					}
				}
				m.Separator()
				for _, msg := range a.g.MessageHistory() {
					msg := msg
					label := strings.SplitN(msg, "\n", 2)[0]
					if m.Item(label).Chosen() {
						a.commitForm.Message = msg
					}
				}
				m.Separator()
				for _, row := range a.changes {
					path := row.change.Path
					if m.Item(a.t("Insert ") + path).Chosen() {
						if a.commitForm.Message != "" && !strings.HasSuffix(a.commitForm.Message, "\n") {
							a.commitForm.Message += "\n"
						}
						a.commitForm.Message += path
						break
					}
				}
			})
		})
		ui.Row(c).Gap(6).Children(func() {
			ui.TextInput(c, &a.commitForm.AuthorName).Placeholder(a.t("Author name")).Width(120)
			ui.TextInput(c, &a.commitForm.AuthorEmail).Placeholder(a.t("Author email")).Width(160)
		})
		ui.Row(c).Gap(6).Children(func() {
			ui.Spacer(c).Grow(1)
			commit := ui.PrimaryButton(c, a.t("Commit"))
			if strings.TrimSpace(a.commitForm.Message) == "" && !a.commitForm.Amend {
				commit.Disabled(true)
			}
			if commit.Clicked() {
				a.requestCommit()
			}
		})
	})
}

func (a *nativeApp) editorArea(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).FillHeight().Children(func() {
		a.tabStrip(c)
		ui.Box(c).Grow(1).MinHeight(0).Background(t.Background).Children(func() {
			if len(a.tabs) == 0 || a.activeTab < 0 || a.activeTab >= len(a.tabs) {
				a.emptyEditor(c)
				return
			}
			a.tabView(c, a.tabs[a.activeTab])
		})
	})
}

func (a *nativeApp) tabStrip(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Height(38).Gap(2).Padding(4, 6).BorderWidth(0, 0, 1, 0).BorderColor(t.Border).Children(func() {
		for i, tab := range a.tabs {
			i, tab := i, tab
			label := tab.title
			if tab.dirty() {
				label += " •"
			}
			btn := ui.ButtonBase(c).Padding(4, 10).Radius(6)
			if i == a.activeTab {
				btn.Background(t.Surface)
			}
			btn.Children(func() {
				ui.Text(c, label).FontSize(12)
			})
			if btn.Clicked() {
				a.activeTab = i
			}
			btn.ContextMenu(func(m *ui.Menu) {
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
			})
			if ui.ButtonBase(c).Padding(2).Radius(4).Label("×").Clicked() {
				a.closeTab(i)
			}
		}
		ui.Spacer(c).Grow(1)
		if len(a.tabs) > 0 {
			if ui.Button(c, a.t("Close Tab")).Clicked() {
				a.closeActiveTab()
			}
		}
	})
}

func (a *nativeApp) emptyEditor(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Center().Gap(8).Children(func() {
		ui.Text(c, "GitJet").FontSize(28).FontWeight(700)
		ui.Text(c, a.t("Choose a file to see its diff or source")).TextColor(t.TextMuted)
		ui.Row(c).Gap(8).Children(func() {
			if ui.Button(c, a.t("Quick Open")).Clicked() {
				a.openQuickOpen()
			}
			if ui.Button(c, a.t("Files")).Clicked() {
				a.sideTab = 2
			}
			if ui.Button(c, a.t("Log")).Clicked() {
				a.sideTab = 0
			}
		})
	})
}

func (a *nativeApp) statusBar(c *ui.Context) {
	t := c.Theme()
	st := a.snapshot.State
	ui.Row(c).Height(26).Padding(0, 10).Gap(12).AlignItems(ui.Center).Background(t.Surface).BorderWidth(1, 0, 0, 0).BorderColor(t.Border).Children(func() {
		ui.Text(c, st.Branch).FontSize(11)
		if st.Detached {
			ui.Text(c, a.t("detached")).FontSize(11).TextColor(t.Warning)
		}
		if st.Ahead > 0 {
			ui.Text(c, fmt.Sprintf("↑%d", st.Ahead)).FontSize(11).TextColor(t.Success)
		}
		if st.Behind > 0 {
			ui.Text(c, fmt.Sprintf("↓%d", st.Behind)).FontSize(11).TextColor(t.Warning)
		}
		if st.Operation != "" {
			ui.Text(c, st.Operation).FontSize(11).TextColor(t.Warning)
			if st.OpProgress != "" {
				ui.Text(c, st.OpProgress).FontSize(11).TextColor(t.TextMuted)
			}
			if ui.Button(c, a.t("Continue")).Clicked() {
				a.continueOperation()
			}
			if ui.Button(c, a.t("Skip")).Clicked() {
				a.skipOperation()
			}
			if ui.Button(c, a.t("Abort")).Clicked() {
				a.abortOperation()
			}
		}
		if st.Conflicts > 0 {
			ui.Text(c, fmt.Sprintf("%d conflicts", st.Conflicts)).FontSize(11).TextColor(t.Danger)
			if ui.Button(c, a.t("Resolve")).Clicked() {
				a.openConflictSummary()
			}
		}
		ui.Spacer(c).Grow(1)
		ui.Text(c, fmt.Sprintf("%d changed", st.Changed)).FontSize(11).TextColor(t.TextMuted)
		if st.Untracked > 0 {
			ui.Text(c, fmt.Sprintf("%d untracked", st.Untracked)).FontSize(11).TextColor(t.TextMuted)
		}
		if a.lsp != nil && a.lsp.ready {
			ui.Text(c, a.lsp.name).FontSize(10).TextColor(t.TextMuted)
			if n := a.diagCount(); n > 0 {
				ui.Text(c, fmt.Sprintf("%d diagnostics", n)).FontSize(10).TextColor(t.Warning)
			}
		}
		if a.busy > 0 {
			ui.Spinner(c)
		}
		ui.Text(c, a.repoRoot()).FontSize(10).TextColor(t.TextMuted)
	})
}

func (a *nativeApp) welcomeView(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Fill().Center().Gap(12).Padding(24).Children(func() {
		ui.Text(c, "GitJet").FontSize(36).FontWeight(700)
		ui.Text(c, a.t("A Git client for reviewing changes and resolving conflicts")).TextColor(t.TextMuted)
		if a.loading {
			ui.Spinner(c)
			return
		}
		ui.Row(c).Gap(8).Children(func() {
			if ui.PrimaryButton(c, a.t("Open Repository")).Clicked() {
				a.chooseAndOpen()
			}
			if ui.Button(c, a.t("Clone Repository")).Clicked() {
				a.openCloneDialog()
			}
			if ui.Button(c, a.t("Create Repository")).Clicked() {
				a.openInitDialog()
			}
			if ui.Button(c, a.t("Settings")).Clicked() {
				a.openSettingsDialog()
			}
		})
		if len(a.recent) > 0 {
			ui.Text(c, a.t("Recent repositories")).FontSize(12).TextColor(t.TextMuted).PaddingY(12)
			ui.Column(c).Width(520).Gap(2).Children(func() {
				for i, r := range a.recent {
					if i >= 8 {
						break
					}
					r := r
					row := ui.ButtonBase(c).Padding(6, 10).Radius(6)
					row.Children(func() {
						ui.Column(c).Children(func() {
							ui.Text(c, r.Name).FontSize(13)
							ui.Text(c, r.Path).FontSize(10).TextColor(t.TextMuted)
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
			ui.Text(c, a.errText).FontSize(11).TextColor(t.Danger).PaddingY(8)
		}
	})
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
	t := c.Theme()
	ui.Column(c).Grow(1).MinHeight(0).Children(func() {
		ui.Column(c).Padding(6, 8).Children(func() {
			if ui.TextInput(c, &a.fileFilter).Placeholder(a.t("Filter files")).Changed() {
				a.rebuildFileTree()
			}
		})
		if len(a.fileTree) == 0 {
			ui.Text(c, a.t("No files")).TextColor(t.TextMuted).Padding(8)
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
			row := ui.Row(c).Height(24).PaddingStart(6 + float32(f.depth)*12).PaddingEnd(8).Gap(6).AlignItems(ui.Center)
			row.Children(func() {
				if f.dir {
					mark := "▸"
					if f.open {
						mark = "▾"
					}
					ui.Text(c, mark).FontSize(10).TextColor(t.TextMuted)
				}
				name := f.name
				if f.dir {
					name += "/"
				}
				ui.Text(c, name).FontSize(12)
				if a.changedPath(f.path) {
					ui.Spacer(c).Grow(1)
					ui.Text(c, "M").FontSize(9).TextColor(t.Warning)
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
				if m.Item(a.t("Copy Path")).Chosen() {
					a.copyText(f.path)
				}
				if m.Item(a.t("Copy Absolute Path")).Chosen() {
					a.copyText(a.absPath(f.path))
				}
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
	t := c.Theme()
	ui.Column(c).Grow(1).MinHeight(0).Children(func() {
		ui.Row(c).Padding(6, 8).Gap(6).Children(func() {
			if ui.Button(c, a.t("New Branch")).Clicked() {
				a.openCreateBranchDialog(a.snapshot.State.Branch)
			}
			if ui.Button(c, a.t("Fetch")).Clicked() {
				a.fetch()
			}
			if ui.Button(c, a.t("Cleanup")).Clicked() {
				a.openCleanupDialog()
			}
		})
		ui.Scroll(c).Grow(1).Children(func() {
			ui.Column(c).Gap(1).Children(func() {
				a.branchSection(c, a.t("Local"), a.branches, "local")
				a.branchSection(c, a.t("Remote"), a.branches, "remote")
				a.tagSection(c)
			})
		})
		if len(a.remotes) > 0 {
			ui.Text(c, fmt.Sprintf("%d remotes", len(a.remotes))).FontSize(10).TextColor(t.TextMuted).Padding(6, 8)
		}
	})
}

func (a *nativeApp) branchSection(c *ui.Context, title string, rows []repoRefRow, group string) {
	t := c.Theme()
	ui.Text(c, title).FontSize(10).FontWeight(700).TextColor(t.TextMuted).Padding(8, 8).PaddingY(2)
	for i := range rows {
		if rows[i].group != group {
			continue
		}
		ref := rows[i].ref
		row := ui.ButtonBase(c).Padding(3, 8).Radius(4)
		row.Children(func() {
			ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
				if ref.Head {
					ui.Text(c, "●").FontSize(8).TextColor(t.Accent)
				}
				ui.Text(c, ref.Name).FontSize(12)
				ui.Spacer(c).Grow(1)
				if ref.Ahead > 0 {
					ui.Text(c, fmt.Sprintf("↑%d", ref.Ahead)).FontSize(9).TextColor(t.Success)
				}
				if ref.Behind > 0 {
					ui.Text(c, fmt.Sprintf("↓%d", ref.Behind)).FontSize(9).TextColor(t.Warning)
				}
			})
		})
		if row.Clicked() {
			a.openRefLog(ref)
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
			}
		})
	}
}

func (a *nativeApp) tagSection(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Padding(8, 8).Gap(6).Children(func() {
		ui.Text(c, a.t("Tags")).FontSize(10).FontWeight(700).TextColor(t.TextMuted)
		ui.Spacer(c).Grow(1)
		if ui.Button(c, "+").Clicked() {
			a.openCreateTagDialog(a.snapshot.State.Head)
		}
	})
	for _, row := range a.tags {
		ref := row.ref
		line := ui.ButtonBase(c).Padding(3, 8).Radius(4)
		line.Children(func() {
			ui.Text(c, ref.Name).FontSize(12)
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
			if m.Item(a.t("Delete")).Chosen() {
				a.deleteTag(ref.Name)
			}
		})
	}
}

// ----- log --------------------------------------------------------------

func (a *nativeApp) logPane(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Grow(1).MinHeight(0).Children(func() {
		ui.Row(c).Padding(6, 8).Gap(6).Children(func() {
			in := ui.TextInput(c, &a.logSearch).Placeholder(a.t("Search commits")).Grow(1)
			if in.Submitted() {
				a.logOpts.Search = strings.TrimSpace(a.logSearch)
				a.refresh()
			}
			if ui.Checkbox(c, &a.logAll, a.t("All branches")).Changed() {
				a.refresh()
			}
		})
		if a.logOpts.Path != "" || a.logOpts.Line > 0 {
			ui.Row(c).Padding(4, 8).Gap(6).Children(func() {
				label := a.logOpts.Path
				if a.logOpts.Line > 0 {
					label += ":" + fmt.Sprint(a.logOpts.Line)
				}
				ui.Text(c, label).FontSize(10).TextColor(t.Accent)
				ui.Spacer(c).Grow(1)
				if ui.Button(c, "×").Clicked() {
					a.logOpts.Path = ""
					a.logOpts.Line = 0
					a.refresh()
				}
			})
		}
		if a.logLoading {
			ui.Row(c).Padding(8).Children(func() { ui.Spinner(c) })
		}
		if n := a.logPick.Len(); n > 0 {
			ui.Row(c).Padding(4, 8).Gap(6).Children(func() {
				ui.Text(c, fmt.Sprintf("%d selected", n)).FontSize(10).TextColor(t.Accent)
				if ui.Button(c, a.t("Clear")).Clicked() {
					a.logPick.Clear()
				}
			})
		}
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
			row := ui.Row(c).Height(30).Padding(3, 8).Gap(6).AlignItems(ui.Center)
			row.Children(func() {
				a.graphCell(c, i)
				ui.Text(c, cm.Short).FontSize(10).Font("monospace").TextColor(t.TextMuted)
				ui.Text(c, cm.Subject).FontSize(11).MaxLines(1)
			})
			row.ContextMenu(func(m *ui.Menu) {
				if a.logPick.Len() > 1 && a.logPick.Has(cm.Hash) {
					hashes := a.pickedHashes()
					if m.Item(a.t("Cherry-Pick Selected")).Chosen() {
						a.busyRun("cherry-pick", func() error {
							_, err := a.g.CherryPick(hashes, false)
							return err
						})
					}
					if m.Item(a.t("Revert Selected")).Chosen() {
						a.busyRun("revert", func() error {
							_, err := a.g.Revert(hashes)
							return err
						})
					}
					if m.Item(a.t("Copy Revision Numbers")).Chosen() {
						a.copyText(strings.Join(hashes, "\n"))
					}
					m.Separator()
				}
				if m.Item(a.t("Open Commit")).Chosen() {
					a.openCommitTab(cm.Hash)
				}
				if m.Item(a.t("Cherry-Pick")).Chosen() {
					hash := cm.Hash
					a.busyRun("cherry-pick", func() error {
						_, err := a.g.CherryPick([]string{hash}, false)
						return err
					})
				}
				if m.Item(a.t("Revert")).Chosen() {
					hash := cm.Hash
					a.busyRun("revert", func() error {
						_, err := a.g.Revert([]string{hash})
						return err
					})
				}
				if m.Item(a.t("Copy Revision Number")).Chosen() {
					a.copyText(cm.Hash)
				}
				if m.Item(a.t("Create Tag")).Chosen() {
					a.openCreateTagDialog(cm.Hash)
				}
				if m.Item(a.t("Create Branch")).Chosen() {
					a.openCreateBranchDialog(cm.Hash)
				}
			})
		}).Grow(1)
		if list.Changed() || list.Submitted() {
			if a.logSel >= 0 && a.logSel < len(a.log.Commits) {
				a.openCommitTab(a.log.Commits[a.logSel].Hash)
			}
		}
		if len(a.log.Commits) == 0 {
			ui.Text(c, a.t("No commits")).FontSize(11).TextColor(t.TextMuted).Padding(8)
		}
	})
}

func (a *nativeApp) graphCell(c *ui.Context, row int) {
	if row < 0 || row >= len(a.graph) {
		ui.Spacer(c).Width(32)
		return
	}
	g := a.graph[row]
	width := graphWidth(a.graph)
	if width < 32 {
		width = 32
	}
	box := ui.Box(c).Width(width).Height(30)
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
	t := c.Theme()
	ui.Column(c).Grow(1).MinHeight(0).Children(func() {
		ui.Row(c).Padding(4, 6).Gap(6).Children(func() {
			ui.Tabs(c, &a.consoleTab, a.t("Command"), a.t("Operations"))
			ui.Spacer(c).Grow(1)
			if ui.Button(c, a.t("Clear")).Clicked() {
				a.consoleLog = nil
			}
			if ui.Button(c, a.t("Log File")).Clicked() {
				if path, err := a.g.JournalFile(); err == nil {
					_ = a.ws.Reveal(path)
				}
			}
		})
		ui.Scroll(c).Grow(1).Background(t.Background).Children(func() {
			ui.Column(c).Padding(6).Children(func() {
				if a.consoleTab == 0 {
					for _, line := range a.consoleLog {
						ui.Text(c, line).FontSize(11).Font("monospace")
					}
					return
				}
				for i := len(a.journal) - 1; i >= 0; i-- {
					e := a.journal[i]
					ui.Text(c, a.stamp(e.At/1000)+"  "+e.Action).FontSize(10).FontWeight(600)
					for _, cmd := range e.Commands {
						ui.Text(c, "$ "+cmd).FontSize(10).Font("monospace").TextColor(t.TextMuted)
					}
					if e.Output != "" {
						ui.Text(c, strings.TrimRight(e.Output, "\n")).FontSize(10).Font("monospace")
					}
					if e.Error != "" {
						ui.Text(c, e.Error).FontSize(10).TextColor(t.Danger)
					}
					ui.Spacer(c).Height(6)
				}
				if len(a.journal) == 0 {
					ui.Text(c, a.t("No operations yet")).FontSize(10).TextColor(t.TextMuted)
				}
			})
		})
		ui.Row(c).Padding(4).Gap(4).Children(func() {
			in := ui.TextInput(c, &a.consoleIn).Placeholder(a.t("git status")).Grow(1)
			if in.Submitted() || ui.Button(c, a.t("Run")).Clicked() {
				a.runConsole()
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
