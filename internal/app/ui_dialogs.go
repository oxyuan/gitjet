package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"gitjet/internal/git"
)

// dialogKind selects the modal card the window shows.
type dialogKind uint8

const (
	dialogNone dialogKind = iota
	dialogConfirm
	dialogClone
	dialogInit
	dialogSettings
	dialogCommitChecks
	dialogCommitDetail
	dialogPush
	dialogPull
	dialogStash
	dialogBranch
	dialogTag
	dialogUpstream
	dialogRemotes
	dialogCleanup
	dialogConflicts
	dialogBlame
	dialogLocalHistory
	dialogRepoTools
	dialogCompare
	dialogPatch
	dialogQuick
	dialogPrompt
	dialogStashFiles
	dialogShelf
	dialogJournal
	dialogWorktree
	dialogSubmodule
	dialogLFS
	dialogRewrite
	dialogMerge
	dialogRebase
)

// dialogState is the open dialog and everything it edits.
type dialogState struct {
	kind    dialogKind
	title   string
	message string
	action  string
	text    string
	text2   string
	text3   string
	flag1   bool
	flag2   bool
	flag3   bool
	flag4   bool
	flag5   bool
	flag6   bool
	flag7   bool
	flag8   bool
	flag9   bool

	paths    []string
	tabIndex int
	warnings []git.CommitWarning
	commit   git.CommitDetail
	hash     string
	tab      *docTab
	line     int

	preview      *git.PushPreview
	pushOpts     *git.PushOptions
	remote       string
	branch       string
	remoteBranch string
	url          string
	dir          string
	from         string
	to           string

	draft      Settings
	entries    []git.LocalHistoryEntry
	merged     []git.BranchInfo
	gone       []git.BranchInfo
	checks     map[string]bool
	target     string
	stashIndex int
	stashFiles []git.StashFile
	shelves    []git.Shelf
	journal    []JournalEntry
	dirPath    string
	patterns   string
	plan       []git.PlanCommit
	steps      []git.PlanStep
	onto       string
}

func (a *nativeApp) dialogOpen() bool { return a.dialog.kind != dialogNone }

func (a *nativeApp) closeDialog() {
	a.dialog = dialogState{}
	a.redraw()
}

func (a *nativeApp) dialogView(c *ui.Context) {
	if a.quickOpen {
		a.quickOpenView(c)
		return
	}
	if !a.dialogOpen() {
		return
	}
	open := true
	m := ui.Modal(c, &open, func() {
		a.dialogCard(c)
	})
	if m.Dismissed() || !open {
		a.closeDialog()
	}
}

func (a *nativeApp) dialogCard(c *ui.Context) {
	t := c.Theme()
	ui.Column(c).Width(520).MaxWidth(760).Padding(16).Gap(10).Background(t.Surface).Radius(12).Children(func() {
		title := a.dialog.title
		if title == "" {
			title = a.dialogTitle()
		}
		ui.Text(c, title).FontSize(15).FontWeight(700)
		switch a.dialog.kind {
		case dialogConfirm:
			a.confirmDialog(c)
		case dialogClone:
			a.cloneDialog(c)
		case dialogInit:
			a.initDialog(c)
		case dialogSettings:
			a.settingsDialog(c)
		case dialogCommitChecks:
			a.commitChecksDialog(c)
		case dialogCommitDetail:
			a.commitDetailDialog(c)
		case dialogPush:
			a.pushDialog(c)
		case dialogPull:
			a.pullDialog(c)
		case dialogStash:
			a.stashDialog(c)
		case dialogBranch:
			a.branchDialog(c)
		case dialogTag:
			a.tagDialog(c)
		case dialogUpstream:
			a.upstreamDialog(c)
		case dialogRemotes:
			a.remotesDialog(c)
		case dialogCleanup:
			a.cleanupDialog(c)
		case dialogConflicts:
			a.conflictsDialog(c)
		case dialogBlame:
			a.blameDialog(c)
		case dialogLocalHistory:
			a.localHistoryDialog(c)
		case dialogRepoTools:
			a.repoToolsDialog(c)
		case dialogCompare:
			a.compareDialog(c)
		case dialogPrompt:
			a.promptDialog(c)
		case dialogStashFiles:
			a.stashFilesDialog(c)
		case dialogShelf:
			a.shelfDialog(c)
		case dialogJournal:
			a.journalDialog(c)
		case dialogWorktree:
			a.worktreeDialog(c)
		case dialogSubmodule:
			a.submoduleDialog(c)
		case dialogLFS:
			a.lfsDialog(c)
		case dialogPatch:
			a.patchDialog(c)
		case dialogRewrite:
			a.rewriteDialog(c)
		case dialogMerge:
			a.mergeDialog(c)
		case dialogRebase:
			a.rebaseDialog(c)
		}
	})
}

func (a *nativeApp) dialogTitle() string {
	switch a.dialog.kind {
	case dialogConfirm:
		return a.t("Confirm")
	case dialogClone:
		return a.t("Clone Repository")
	case dialogInit:
		return a.t("Create Repository")
	case dialogSettings:
		return a.t("Settings")
	case dialogCommitChecks:
		return a.t("Commit Checks")
	case dialogCommitDetail:
		return a.t("Commit")
	case dialogPush:
		return a.t("Push")
	case dialogPull:
		return a.t("Pull")
	case dialogStash:
		return a.t("Stash Changes")
	case dialogBranch:
		return a.t("Branch")
	case dialogTag:
		return a.t("Tag")
	case dialogUpstream:
		return a.t("Set Upstream")
	case dialogRemotes:
		return a.t("Remotes")
	case dialogCleanup:
		return a.t("Clean Up Branches")
	case dialogConflicts:
		return a.t("Conflicts")
	case dialogBlame:
		return a.t("Blame")
	case dialogLocalHistory:
		return a.t("Local History")
	case dialogRepoTools:
		return a.t("Repository Tools")
	case dialogCompare:
		return a.t("Compare")
	}
	return ""
}

func (a *nativeApp) buttons(c *ui.Context, ok string, fn func()) {
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Cancel")).Clicked() {
			a.closeDialog()
		}
		if ui.PrimaryButton(c, ok).Clicked() {
			fn()
		}
	})
}

func (a *nativeApp) confirmDialog(c *ui.Context) {
	ui.Text(c, a.dialog.message).FontSize(12)
	a.buttons(c, a.t("OK"), func() {
		d := a.dialog
		a.closeDialog()
		switch d.action {
		case "rollback":
			a.doRollback(d.paths)
		case "abort":
			a.doAbortOperation()
		case "commit":
			a.commitNow(a.checkedPaths(), a.commitForm)
		case "delete-branch":
			a.busyRun("delete-branch", func() error { return a.g.DeleteBranch(d.text, true) })
		case "delete-path":
			a.busyRun("delete-path", func() error { return a.g.DeletePath(d.text) })
		case "force-push":
			if d.pushOpts != nil {
				a.push(*d.pushOpts)
			}
		case "delete-changelist":
			id := d.target
			a.busyRun("changelist", func() error {
				_, err := a.g.DeleteChangelist(id)
				return err
			})
		case "close-tab":
			if d.tabIndex >= 0 && d.tabIndex < len(a.tabs) {
				a.tabs[d.tabIndex].src.Buffer.MarkSaved()
				a.closeTab(d.tabIndex)
			}
		}
	})
}

// ----- clone / init -----------------------------------------------------

func (a *nativeApp) openCloneDialog() {
	a.dialog = dialogState{kind: dialogClone, url: "", dir: "", branch: ""}
}

func (a *nativeApp) cloneDialog(c *ui.Context) {
	ui.Field(c, a.t("Repository URL"), func() {
		ui.TextInput(c, &a.dialog.url).Placeholder("https://github.com/user/repo.git")
	})
	ui.Field(c, a.t("Folder"), func() {
		ui.TextInput(c, &a.dialog.dir).Placeholder(a.t("Where to clone it"))
	})
	ui.Field(c, a.t("Branch"), func() {
		ui.TextInput(c, &a.dialog.branch).Placeholder(a.t("Optional"))
	})
	if a.dialog.text != "" {
		ui.Text(c, a.dialog.text).FontSize(10).TextColor(c.Theme().TextMuted).MaxLines(8)
	}
	a.buttons(c, a.t("Clone"), func() {
		url, dir := strings.TrimSpace(a.dialog.url), strings.TrimSpace(a.dialog.dir)
		if url == "" || dir == "" {
			a.dialog.text = a.t("A URL and a folder are needed")
			return
		}
		a.closeDialog()
		a.busy++
		go func() {
			res, err := a.ws.Clone(url, dir, nil)
			mygo.RunOnMain(func() {
				a.busy--
				if res != "" {
					a.appendConsole(res)
				}
				if err != nil {
					a.fail(err)
					return
				}
				a.openPath(dir)
			})
		}()
	})
}

func (a *nativeApp) openInitDialog() {
	a.dialog = dialogState{kind: dialogInit}
}

func (a *nativeApp) initDialog(c *ui.Context) {
	ui.Field(c, a.t("Folder"), func() {
		ui.TextInput(c, &a.dialog.dir).Placeholder(a.t("Folder to create the repository in"))
	})
	ui.Field(c, a.t("Initial branch"), func() {
		ui.TextInput(c, &a.dialog.branch).Placeholder("main")
	})
	if a.dialog.text != "" {
		ui.Text(c, a.dialog.text).FontSize(10).TextColor(c.Theme().Danger).MaxLines(6)
	}
	a.buttons(c, a.t("Create"), func() {
		dir := strings.TrimSpace(a.dialog.dir)
		if dir == "" {
			a.dialog.text = a.t("A folder is needed")
			return
		}
		branch := strings.TrimSpace(a.dialog.branch)
		if branch == "" {
			branch = "main"
		}
		a.closeDialog()
		a.busy++
		go func() {
			res, err := a.ws.Init(dir, branch)
			mygo.RunOnMain(func() {
				a.busy--
				if res != "" {
					a.appendConsole(res)
				}
				if err != nil {
					a.fail(err)
					return
				}
				a.openPath(dir)
			})
		}()
	})
}

// ----- settings ---------------------------------------------------------

func (a *nativeApp) openSettingsDialog() {
	a.dialog = dialogState{kind: dialogSettings, draft: a.settings}
}

func (a *nativeApp) settingsDialog(c *ui.Context) {
	s := &a.dialog.draft
	ui.Scroll(c).MaxHeight(520).Children(func() {
		ui.Column(c).Gap(8).Children(func() {
			ui.Field(c, a.t("Language"), func() {
				opts := []string{"system", "en", "zh"}
				ui.Select(c, &s.Language, opts)
			})
			ui.Field(c, a.t("Theme"), func() {
				ui.Select(c, &s.Theme, []string{"system", "light", "dark"})
			})
			ui.Field(c, a.t("Interface scale"), func() {
				v := float64(s.UIScale)
				if ui.NumberInput(c, &v, 70, 160, 10).Changed() {
					s.UIScale = int(v)
				}
			})
			ui.Field(c, a.t("Git executable"), func() {
				ui.TextInput(c, &s.GitPath).Placeholder(a.t("Found on PATH when empty"))
			})
			ui.Field(c, a.t("SSH command"), func() {
				ui.TextInput(c, &s.SshCommand).Placeholder("ssh -i ~/.ssh/id_ed25519")
			})
			ui.Field(c, a.t("Fetch tags"), func() {
				ui.Select(c, &s.FetchTagsMode, []string{"auto", "always", "never"})
			})
			ui.Field(c, a.t("Diff context"), func() {
				v := float64(s.DiffContext)
				if ui.NumberInput(c, &v, -1, 100, 1).Changed() {
					s.DiffContext = int(v)
				}
			})
			ui.Checkbox(c, &s.IgnoreWhitespace, a.t("Ignore whitespace in diffs"))
			ui.Checkbox(c, &s.ShowIgnored, a.t("Show ignored files"))
			ui.Checkbox(c, &s.ConfirmRollback, a.t("Confirm before rollback"))
			ui.Checkbox(c, &s.ConfirmForcePush, a.t("Confirm force push"))
			ui.Field(c, a.t("Update method"), func() {
				ui.Select(c, &s.UpdateMethod, []string{"merge", "rebase"})
			})
			ui.Checkbox(c, &s.AutoUpdateOnReject, a.t("Update when a push is rejected"))
			ui.Checkbox(c, &s.OpenInNewWindow, a.t("Open a repository in a new window"))
			ui.Checkbox(c, &s.AutoFetch, a.t("Fetch automatically"))
			ui.Field(c, a.t("Fetch every (minutes)"), func() {
				v := float64(s.AutoFetchMinutes)
				if ui.NumberInput(c, &v, 1, 1440, 1).Changed() {
					s.AutoFetchMinutes = int(v)
				}
			})
			ui.Checkbox(c, &s.CommitCheckCRLF, a.t("Warn about CRLF"))
			ui.Checkbox(c, &s.CommitCheckNames, a.t("Warn about invalid names"))
			ui.Checkbox(c, &s.CommitCheckHead, a.t("Warn about detached HEAD"))
			ui.Field(c, a.t("Large file warning (MB)"), func() {
				v := float64(s.CommitCheckLargeMB)
				if ui.NumberInput(c, &v, 0, 1000, 1).Changed() {
					s.CommitCheckLargeMB = int(v)
				}
			})
			ui.Field(c, a.t("Commit template"), func() {
				ui.TextArea(c, &s.CommitTemplate).Height(70)
			})
			ui.Field(c, a.t("Protected branches"), func() {
				joined := strings.Join(s.ProtectedBranches, "\n")
				if ui.TextArea(c, &joined).Changed() {
					s.ProtectedBranches = splitLines(joined)
				}
				ui.Text(c, a.t("One pattern per line")).FontSize(10).TextColor(c.Theme().TextMuted)
			})
		})
	})
	if a.dialog.text != "" {
		ui.Text(c, a.dialog.text).FontSize(10).TextColor(c.Theme().Danger)
	}
	ui.Row(c).Children(func() {
		if ui.Button(c, a.t("Restore Defaults")).Clicked() {
			a.dialog.draft = a.ws.DefaultSettings()
		}
		ui.Spacer(c).Grow(1)
	})
	a.buttons(c, a.t("Save"), func() {
		draft := a.dialog.draft
		a.closeDialog()
		a.busy++
		go func() {
			saved, err := a.ws.SaveSettings(draft)
			mygo.RunOnMain(func() {
				a.busy--
				if err != nil {
					a.fail(err)
					return
				}
				a.settings = saved
				a.lang = resolveLang(saved.Language)
				applyMenu(saved.Language)
				for _, tab := range a.tabs {
					if tab.kind == tabDiff {
						tab.opts.Context = saved.DiffContext
						tab.opts.IgnoreWhitespace = saved.IgnoreWhitespace
						a.loadDiff(tab)
					}
				}
				a.refresh()
			})
		}()
	})
}

func splitLines(s string) []string {
	var out []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

// ----- commit checks / detail ------------------------------------------

func (a *nativeApp) commitChecksDialog(c *ui.Context) {
	t := c.Theme()
	ui.Text(c, a.t("Some files need your attention before committing")).FontSize(12)
	ui.Scroll(c).MaxHeight(300).Children(func() {
		ui.Column(c).Gap(4).Children(func() {
			for _, w := range a.dialog.warnings {
				ui.Column(c).Children(func() {
					ui.Text(c, w.Path).FontSize(12).FontWeight(600)
					ui.Text(c, w.Message).FontSize(10).TextColor(t.Warning)
				})
			}
		})
	})
	ui.Row(c).Gap(8).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Cancel")).Clicked() {
			a.closeDialog()
		}
		if ui.PrimaryButton(c, a.t("Commit Anyway")).Clicked() {
			form := a.commitForm
			a.closeDialog()
			a.commitNow(a.checkedPaths(), form)
		}
	})
}

func (a *nativeApp) commitDetailDialog(c *ui.Context) {
	t := c.Theme()
	d := a.dialog.commit
	ui.Text(c, d.Short+" · "+d.Subject).FontSize(13).FontWeight(600).MaxLines(2)
	ui.Text(c, fmt.Sprintf("%s · %s", d.Author, a.stamp(d.AuthorTime))).FontSize(10).TextColor(t.TextMuted)
	ui.Text(c, d.Message).FontSize(11).MaxLines(6)
	m := ui.TextInput(c, &a.dialog.text).Placeholder(a.t("Create fixup/squash or edit history"))
	_ = m
	ui.Scroll(c).MaxHeight(360).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			for _, f := range d.Files {
				f := f
				row := ui.ButtonBase(c).Padding(3, 8).Radius(4)
				row.Children(func() {
					ui.Row(c).Gap(6).Children(func() {
						ui.Text(c, statusLetterFromString(f.Status)).FontSize(10).Width(14).TextColor(t.Accent)
						ui.Text(c, f.Path).FontSize(12)
						ui.Spacer(c).Grow(1)
						ui.Text(c, fmt.Sprintf("+%d −%d", f.Additions, f.Deletions)).FontSize(10).TextColor(t.TextMuted)
					})
				})
				if row.Clicked() {
					a.openDiff(git.DiffOptions{Path: f.Path, OldPath: f.OldPath, Target: git.DiffCommit, Revision: d.Hash, Context: a.settings.DiffContext})
					a.closeDialog()
				}
			}
		})
	})
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Cherry-Pick")).Clicked() {
			hash := d.Hash
			a.closeDialog()
			a.busyRun("cherry-pick", func() error {
				_, err := a.g.CherryPick([]string{hash}, false)
				return err
			})
		}
		if ui.Button(c, a.t("Revert")).Clicked() {
			hash := d.Hash
			a.closeDialog()
			a.busyRun("revert", func() error {
				_, err := a.g.Revert([]string{hash})
				return err
			})
		}
		if ui.Button(c, a.t("New Branch")).Clicked() {
			hash := d.Hash
			a.openCreateBranchDialog(hash)
		}
		if ui.Button(c, a.t("New Tag")).Clicked() {
			hash := d.Hash
			a.openCreateTagDialog(hash)
		}
		if ui.Button(c, a.t("Checkout")).Clicked() {
			hash := d.Hash
			a.closeDialog()
			a.checkout(hash)
		}
		ui.MenuButton(c, a.t("Reset"), func(m *ui.Menu) {
			for _, mode := range []string{"soft", "mixed", "hard"} {
				mode := mode
				if m.Item(mode).Chosen() {
					hash := d.Hash
					a.closeDialog()
					a.busyRun("reset", func() error {
						_, err := a.g.Reset(hash, mode)
						return err
					})
				}
			}
		})
		if ui.Button(c, a.t("Fixup")).Clicked() {
			hash := d.Hash
			a.closeDialog()
			a.busyRun("fixup", func() error {
				_, err := a.g.CommitFixup(hash, false)
				return err
			})
		}
		if ui.Button(c, a.t("Squash")).Clicked() {
			hash := d.Hash
			a.closeDialog()
			a.busyRun("squash", func() error {
				_, err := a.g.CommitFixup(hash, true)
				return err
			})
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

func statusLetterFromString(status string) string {
	switch status {
	case "added":
		return "A"
	case "deleted":
		return "D"
	case "renamed":
		return "R"
	case "copied":
		return "C"
	}
	return "M"
}

// ----- push / pull / stash ---------------------------------------------

func (a *nativeApp) pushDialog(c *ui.Context) {
	t := c.Theme()
	d := &a.dialog
	ui.Field(c, a.t("Remote"), func() {
		opts := make([]string, 0, len(a.remotes))
		for _, r := range a.remotes {
			opts = append(opts, r.Name)
		}
		ui.Select(c, &d.remote, opts)
	})
	ui.Field(c, a.t("Branch"), func() {
		ui.TextInput(c, &d.branch)
	})
	ui.Field(c, a.t("Remote branch"), func() {
		if ui.TextInput(c, &d.remoteBranch).Submitted() {
			a.refreshPushPreview()
		}
	})
	if d.preview != nil {
		p := d.preview
		ui.Text(c, fmt.Sprintf("%s → %s/%s", p.Branch, p.Remote, p.RemoteBranch)).FontSize(11)
		if p.Creates {
			ui.Text(c, a.t("Creates a new remote branch")).FontSize(10).TextColor(t.Success)
		}
		if p.Diverged {
			ui.Text(c, a.t("The remote branch has diverged")).FontSize(10).TextColor(t.Danger)
		}
		ui.Text(c, fmt.Sprintf("%d commits · %d files", len(p.Commits), len(p.Files))).FontSize(10).TextColor(t.TextMuted)
		ui.Scroll(c).MaxHeight(160).Children(func() {
			ui.Column(c).Gap(1).Children(func() {
				for _, cm := range p.Commits {
					ui.Text(c, cm.Short+" "+cm.Subject).FontSize(10)
				}
			})
		})
	}
	ui.Checkbox(c, &d.flag1, a.t("Set upstream"))
	ui.Checkbox(c, &d.flag2, a.t("Force with lease"))
	ui.Checkbox(c, &d.flag3, a.t("Force if includes"))
	ui.Checkbox(c, &d.flag4, a.t("Push tags"))
	ui.Checkbox(c, &d.flag5, a.t("Dry run"))
	if a.dialog.text != "" {
		ui.Text(c, a.dialog.text).FontSize(10).TextColor(t.Danger)
	}
	a.buttons(c, a.t("Push"), func() {
		remote := strings.TrimSpace(d.remote)
		branch := strings.TrimSpace(d.branch)
		remoteBranch := strings.TrimSpace(d.remoteBranch)
		if remoteBranch == "" {
			remoteBranch = branch
		}
		opts := git.PushOptions{
			Remote:          remote,
			Branch:          branch,
			RemoteBranch:    remoteBranch,
			SetUpstream:     d.flag1,
			ForceWithLease:  d.flag2,
			ForceIfIncludes: d.flag3,
			Tags:            d.flag4,
			DryRun:          d.flag5,
		}
		a.closeDialog()
		if a.protectedBranch() && (opts.ForceWithLease || opts.ForceIfIncludes) {
			a.fail(errors.New(a.t("A protected branch cannot be force-pushed")))
			return
		}
		if (opts.ForceWithLease || opts.ForceIfIncludes) && a.settings.ConfirmForcePush {
			a.dialog = dialogState{kind: dialogConfirm, title: a.t("Force push"), message: a.t("Rewrite the remote branch?"), action: "force-push", pushOpts: &opts}
			return
		}
		a.push(opts)
	})
}

func (a *nativeApp) pullDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("Remote"), func() {
		opts := make([]string, 0, len(a.remotes))
		for _, r := range a.remotes {
			opts = append(opts, r.Name)
		}
		ui.Select(c, &d.remote, opts)
	})
	ui.Field(c, a.t("Branch"), func() { ui.TextInput(c, &d.branch) })
	ui.Checkbox(c, &d.flag1, a.t("Rebase"))
	ui.Checkbox(c, &d.flag2, a.t("Autostash"))
	ui.Checkbox(c, &d.flag3, a.t("Prune"))
	ui.Checkbox(c, &d.flag4, a.t("Tags"))
	ui.Checkbox(c, &d.flag5, a.t("Fast-forward only"))
	ui.Checkbox(c, &d.flag6, a.t("No fast-forward"))
	ui.Checkbox(c, &d.flag7, a.t("Squash"))
	if a.dialog.text != "" {
		ui.Text(c, a.dialog.text).FontSize(10).TextColor(c.Theme().Danger)
	}
	a.buttons(c, a.t("Pull"), func() {
		opts := git.PullOptions{
			Remote:    strings.TrimSpace(d.remote),
			Branch:    strings.TrimSpace(d.branch),
			Rebase:    d.flag1,
			Autostash: d.flag2,
			Prune:     d.flag3,
			Tags:      d.flag4,
			FFOnly:    d.flag5,
			NoFF:      d.flag6,
			Squash:    d.flag7,
			TagsMode:  a.settings.FetchTagsMode,
		}
		a.closeDialog()
		a.pull(opts)
	})
}

func (a *nativeApp) openStashDialog() {
	a.dialog = dialogState{kind: dialogStash}
}

func (a *nativeApp) stashDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("Message"), func() { ui.TextInput(c, &d.text) })
	ui.Checkbox(c, &d.flag1, a.t("Include untracked files"))
	ui.Checkbox(c, &d.flag2, a.t("Keep the index"))
	a.buttons(c, a.t("Stash"), func() {
		opts := git.StashOptions{Message: strings.TrimSpace(d.text), IncludeUntracked: d.flag1, KeepIndex: d.flag2}
		a.closeDialog()
		a.busyRun("stash", func() error {
			_, err := a.g.StashPush(opts)
			return err
		})
	})
}

// ----- branch / tag / upstream -----------------------------------------

func (a *nativeApp) openCreateBranchDialog(start string) {
	a.dialog = dialogState{kind: dialogBranch, from: start, branch: "", flag1: true}
}

func (a *nativeApp) branchDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("Name"), func() { ui.TextInput(c, &d.branch) })
	ui.Field(c, a.t("Start point"), func() { ui.TextInput(c, &d.from) })
	ui.Checkbox(c, &d.flag1, a.t("Check out after creating"))
	if a.dialog.text != "" {
		ui.Text(c, a.dialog.text).FontSize(10).TextColor(c.Theme().Danger)
	}
	a.buttons(c, a.t("Create"), func() {
		name := strings.TrimSpace(d.branch)
		if name == "" {
			d.text = a.t("A branch needs a name")
			return
		}
		start := strings.TrimSpace(d.from)
		checkout := d.flag1
		a.closeDialog()
		a.busyRun("branch", func() error { return a.g.CreateBranch(name, start, checkout) })
	})
}

func (a *nativeApp) promptRenameBranch(old string) {
	a.dialog = dialogState{kind: dialogBranch, title: a.t("Rename Branch"), from: old, branch: old}
}

func (a *nativeApp) openCreateTagDialog(rev string) {
	a.dialog = dialogState{kind: dialogTag, from: rev}
}

func (a *nativeApp) tagDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("Name"), func() { ui.TextInput(c, &d.branch) })
	ui.Field(c, a.t("Message"), func() { ui.TextArea(c, &d.text).Height(70) })
	ui.Field(c, a.t("Revision"), func() { ui.TextInput(c, &d.from) })
	ui.Checkbox(c, &d.flag1, a.t("Force"))
	a.buttons(c, a.t("Create"), func() {
		opts := git.TagOptions{Name: strings.TrimSpace(d.branch), Message: d.text, Revision: strings.TrimSpace(d.from), Force: d.flag1}
		if opts.Name == "" {
			return
		}
		a.closeDialog()
		a.busyRun("tag", func() error { return a.g.CreateTag(opts) })
	})
}

func (a *nativeApp) openUpstreamDialog(branch string) {
	a.dialog = dialogState{kind: dialogUpstream, branch: branch, text: ""}
}

func (a *nativeApp) upstreamDialog(c *ui.Context) {
	d := &a.dialog
	ui.Text(c, d.branch).FontSize(12)
	ui.Field(c, a.t("Upstream"), func() { ui.TextInput(c, &d.text).Placeholder("origin/main") })
	a.buttons(c, a.t("Set"), func() {
		upstream := strings.TrimSpace(d.text)
		branch := d.branch
		a.closeDialog()
		a.busyRun("upstream", func() error { return a.g.SetUpstream(branch, upstream) })
	})
}

// ----- remotes / cleanup / conflicts -----------------------------------

func (a *nativeApp) openRemotesDialog() {
	a.dialog = dialogState{kind: dialogRemotes, text: "", text2: ""}
}

func (a *nativeApp) remotesDialog(c *ui.Context) {
	t := c.Theme()
	for _, r := range a.remotes {
		r := r
		ui.Column(c).Children(func() {
			ui.Row(c).Gap(6).Children(func() {
				ui.Text(c, r.Name).FontSize(12).FontWeight(600)
				ui.Text(c, r.URL).FontSize(10).TextColor(t.TextMuted)
				ui.Spacer(c).Grow(1)
				if ui.Button(c, a.t("Edit")).Clicked() {
					a.dialog.text = r.Name
					a.dialog.text2 = r.URL
				}
				if ui.Button(c, a.t("Rename")).Clicked() {
					a.dialog = dialogState{kind: dialogPrompt, title: a.t("Rename Remote"), message: a.t("New name"), action: "rename-remote", target: r.Name, text: r.Name}
				}
				if ui.Button(c, a.t("Remove")).Clicked() {
					name := r.Name
					a.busyRun("remote", func() error { return a.g.RemoveRemote(name) })
				}
			})
		})
	}
	ui.Field(c, a.t("Name"), func() { ui.TextInput(c, &a.dialog.text) })
	ui.Field(c, a.t("URL"), func() { ui.TextInput(c, &a.dialog.text2) })
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Save")).Clicked() {
			name, url := strings.TrimSpace(a.dialog.text), strings.TrimSpace(a.dialog.text2)
			if name != "" && url != "" {
				exists := false
				for _, r := range a.remotes {
					if r.Name == name {
						exists = true
						break
					}
				}
				if exists {
					a.busyRun("remote", func() error { return a.g.SetRemoteURL(name, url) })
				} else {
					a.busyRun("remote", func() error { return a.g.AddRemote(name, url) })
				}
			}
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

func (a *nativeApp) openCleanupDialog() {
	if !a.repoOpen {
		return
	}
	a.busy++
	go func() {
		cand, err := a.g.CleanupCandidates()
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			checks := map[string]bool{}
			for _, b := range cand.Merged {
				checks[b.Name] = true
			}
			for _, b := range cand.Gone {
				checks[b.Name] = true
			}
			a.dialog = dialogState{kind: dialogCleanup, merged: cand.Merged, gone: cand.Gone, checks: checks}
			a.redraw()
		})
	}()
}

func (a *nativeApp) cleanupDialog(c *ui.Context) {
	t := c.Theme()
	ui.Text(c, a.t("Merged into the current branch")).FontSize(11).FontWeight(600)
	for _, b := range a.dialog.merged {
		name := b.Name
		v := a.dialog.checks[name]
		if ui.Checkbox(c, &v, name).Changed() {
			a.dialog.checks[name] = v
		}
	}
	ui.Text(c, a.t("Upstream gone")).FontSize(11).FontWeight(600).PaddingY(6)
	for _, b := range a.dialog.gone {
		name := b.Name
		v := a.dialog.checks[name]
		if ui.Checkbox(c, &v, name).Changed() {
			a.dialog.checks[name] = v
		}
	}
	if len(a.dialog.merged)+len(a.dialog.gone) == 0 {
		ui.Text(c, a.t("No branches to clean up")).FontSize(11).TextColor(t.TextMuted)
	}
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Cancel")).Clicked() {
			a.closeDialog()
		}
		if ui.PrimaryButton(c, a.t("Delete")).Clicked() {
			var names []string
			for name, on := range a.dialog.checks {
				if on {
					names = append(names, name)
				}
			}
			a.closeDialog()
			a.busyRun("cleanup", func() error {
				_, err := a.g.DeleteBranches(names, true)
				return err
			})
		}
	})
}

func (a *nativeApp) conflictsDialog(c *ui.Context) {
	t := c.Theme()
	ui.Text(c, fmt.Sprintf("%d conflicted paths", len(a.snapshot.Conflicts))).FontSize(11)
	ui.Scroll(c).MaxHeight(320).Children(func() {
		ui.Column(c).Gap(2).Children(func() {
			for _, cf := range a.snapshot.Conflicts {
				cf := cf
				row := ui.ButtonBase(c).Padding(4, 6).Radius(4)
				row.Children(func() {
					ui.Row(c).Gap(6).Children(func() {
						ui.Text(c, cf.Path).FontSize(12)
						ui.Spacer(c).Grow(1)
						ui.Text(c, fmt.Sprintf("%s/%s", cf.OursState, cf.TheirsState)).FontSize(10).TextColor(t.TextMuted)
					})
				})
				if row.Clicked() {
					a.closeDialog()
					a.openMergeWindow(cf.Path)
				}
				row.ContextMenu(func(m *ui.Menu) {
					if m.Item(a.t("Accept Ours")).Chosen() {
						a.takeSide(cf.Path, "ours")
					}
					if m.Item(a.t("Accept Theirs")).Chosen() {
						a.takeSide(cf.Path, "theirs")
					}
				})
			}
		})
	})
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Resolve Simple Conflicts")).Clicked() {
			a.resolveSimpleConflicts()
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

// ----- blame / local history -------------------------------------------

func (a *nativeApp) blameDialog(c *ui.Context) {
	tab := a.dialog.tab
	line := a.dialog.line
	if tab == nil || line < 0 || line >= len(tab.blame) {
		a.closeDialog()
		return
	}
	l := tab.blame[line]
	ui.Text(c, fmt.Sprintf("%s · %s", l.Short, l.Summary)).FontSize(12)
	ui.Text(c, fmt.Sprintf("%s · %s", l.Author, a.stamp(l.Time))).FontSize(10).TextColor(c.Theme().TextMuted)
	ui.Text(c, l.Text).FontSize(10).Font("monospace").MaxLines(5)
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Show Commit")).Clicked() {
			a.closeDialog()
			a.openCommitTab(l.Commit)
		}
		if ui.Button(c, a.t("Show File at This Commit")).Clicked() {
			path := tab.path
			rev := l.Commit
			a.closeDialog()
			a.openSource(path, rev)
		}
		if ui.Button(c, a.t("History of This Line")).Clicked() {
			path := tab.path
			a.closeDialog()
			a.showLineHistory(path, line+1)
		}
		if ui.Button(c, a.t("Copy Revision Number")).Clicked() {
			a.copyText(l.Commit)
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

func (a *nativeApp) openLocalHistory(tab *docTab) {
	if tab == nil {
		return
	}
	a.busy++
	go func() {
		entries, err := a.g.LocalHistory(tab.path)
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			a.dialog = dialogState{kind: dialogLocalHistory, entries: entries, tab: tab}
			a.redraw()
		})
	}()
}

func (a *nativeApp) localHistoryDialog(c *ui.Context) {
	t := c.Theme()
	if len(a.dialog.entries) == 0 {
		ui.Text(c, a.t("No local history for this file")).FontSize(11).TextColor(t.TextMuted)
	}
	ui.Scroll(c).MaxHeight(360).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			for _, e := range a.dialog.entries {
				e := e
				row := ui.ButtonBase(c).Padding(3, 6).Radius(4)
				row.Children(func() {
					ui.Row(c).Gap(8).Children(func() {
						ui.Text(c, a.stamp(e.Time)).FontSize(11)
						ui.Text(c, fmt.Sprintf("%d bytes", e.Size)).FontSize(10).TextColor(t.TextMuted)
						if e.Label != "" {
							ui.Text(c, e.Label).FontSize(11)
						}
					})
				})
				row.ContextMenu(func(m *ui.Menu) {
					if m.Item(a.t("Label")).Chosen() {
						a.dialog = dialogState{kind: dialogPrompt, title: a.t("Label This Version"), message: a.t("Label"), action: "label-history", target: e.Path, dirPath: e.Digest}
					}
					if m.Item(a.t("Restore")).Chosen() {
						path, digest := e.Path, e.Digest
						a.closeDialog()
						a.busyRun("restore", func() error { return a.g.RestoreLocalHistory(path, digest) })
					}
					if m.Item(a.t("Preview")).Chosen() {
						path, digest := e.Path, e.Digest
						go func() {
							text, err := a.g.LocalHistoryContent(path, digest)
							mygoMain(func() {
								if err != nil {
									a.fail(err)
									return
								}
								a.openPreview(text, path)
							})
						}()
					}
				})
			}
		})
	})
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

// ----- repository tools ------------------------------------------------

func (a *nativeApp) openRepoToolsDialog() {
	a.dialog = dialogState{kind: dialogRepoTools}
}

func (a *nativeApp) repoToolsDialog(c *ui.Context) {
	t := c.Theme()
	ui.Tabs(c, &a.repoTab, a.t("Worktrees"), a.t("Submodules"), "LFS", a.t("Shelves"), a.t("Patches"), a.t("Journal"))
	switch a.repoTab {
	case 0:
		for _, w := range a.worktrees {
			w := w
			ui.Row(c).Gap(6).Children(func() {
				ui.Text(c, w.Path).FontSize(11)
				ui.Text(c, w.Branch).FontSize(10).TextColor(t.TextMuted)
				ui.Spacer(c).Grow(1)
				if ui.Button(c, a.t("Open")).Clicked() {
					_ = a.ws.OpenInWindow(w.Path)
				}
				if !w.Locked && ui.Button(c, a.t("Lock")).Clicked() {
					path := w.Path
					a.dialog = dialogState{kind: dialogPrompt, title: a.t("Lock Worktree"), message: a.t("Reason"), action: "lock-worktree", target: path}
				}
				if !w.Main && ui.Button(c, a.t("Remove")).Clicked() {
					path := w.Path
					a.busyRun("worktree", func() error {
						_, err := a.g.RemoveWorktree(path, false)
						return err
					})
				}
				if w.Locked && ui.Button(c, a.t("Unlock")).Clicked() {
					path := w.Path
					a.busyRun("worktree", func() error {
						_, err := a.g.UnlockWorktree(path)
						return err
					})
				}
			})
		}
		ui.Row(c).Gap(6).Children(func() {
			if ui.Button(c, a.t("New Worktree")).Clicked() {
				a.openWorktreeDialog()
			}
			if ui.Button(c, a.t("Prune")).Clicked() {
				a.busyRun("worktree", func() error {
					_, err := a.g.PruneWorktrees()
					return err
				})
			}
		})
	case 1:
		for _, sm := range a.submodules {
			ui.Text(c, fmt.Sprintf("%s · %s · %s", sm.Path, sm.Short, sm.State)).FontSize(11)
		}
		ui.Row(c).Gap(6).Children(func() {
			if ui.Button(c, a.t("Add Submodule")).Clicked() {
				a.openSubmoduleDialog()
			}
			if ui.Button(c, a.t("Update")).Clicked() {
				a.busyRun("submodule", func() error {
					_, err := a.g.UpdateSubmodules(true)
					return err
				})
			}
			if ui.Button(c, a.t("Sync")).Clicked() {
				a.busyRun("submodule", func() error {
					_, err := a.g.SyncSubmodules()
					return err
				})
			}
		})
	case 2:
		ui.Text(c, fmt.Sprintf("Git LFS %s · %d tracked files", a.lfs.Version, len(a.lfs.Files))).FontSize(11)
		if ui.Button(c, a.t("Git LFS")).Clicked() {
			a.openLFSDialog()
		}
	case 3:
		ui.Row(c).Gap(6).Children(func() {
			if ui.Button(c, a.t("Manage Shelves")).Clicked() {
				a.openShelfDialog()
			}
		})
	case 4:
		if ui.Button(c, a.t("Patches")).Clicked() {
			a.openPatchDialog()
		}
	case 5:
		if ui.Button(c, a.t("Open Journal")).Clicked() {
			a.openJournalDialog()
		}
		if a.snapshot.State.Shallow {
			if ui.Button(c, a.t("Fetch Full History")).Clicked() {
				a.busyRun("unshallow", func() error {
					_, err := a.g.Unshallow(nil)
					return err
				})
			}
		}
	}
	ui.Row(c).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

// ----- compare ----------------------------------------------------------

func (a *nativeApp) openCompare(from, to string) {
	a.dialog = dialogState{kind: dialogCompare, from: from, to: to}
}

func (a *nativeApp) compareDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("From"), func() { ui.TextInput(c, &d.from) })
	ui.Field(c, a.t("To"), func() { ui.TextInput(c, &d.to) })
	a.buttons(c, a.t("Compare"), func() {
		from, to := strings.TrimSpace(d.from), strings.TrimSpace(d.to)
		a.closeDialog()
		go func() {
			files, err := a.g.Compare(from, to)
			mygo.RunOnMain(func() {
				if err != nil {
					a.fail(err)
					return
				}
				a.openCompareTab(from, to, files)
			})
		}()
	})
}

func (a *nativeApp) openCompareTab(from, to string, files []git.Change) {
	id := "compare:" + from + ".." + to
	if i := a.findTab(id); i >= 0 {
		a.activeTab = i
		return
	}
	tab := &docTab{kind: tabRevisionTree, id: id, title: from + ".." + to, revision: to, from: from}
	tab.files = nil
	for _, f := range files {
		tab.files = append(tab.files, git.RepoFile{Path: f.Path})
	}
	a.tabs = append(a.tabs, tab)
	a.activeTab = len(a.tabs) - 1
}

// ----- quick open -------------------------------------------------------

func (a *nativeApp) quickOpenView(c *ui.Context) {
	t := c.Theme()
	ui.Overlay(c, func() {
		panel := ui.Column(c).Absolute().Top(80).LeftPercent(20).WidthPercent(60).MaxWidth(720).Padding(12).Gap(8).Background(t.Surface).Radius(12)
		panel.BorderWidth(1).BorderColor(t.Border)
		panel.Children(func() {
			in := ui.TextInput(c, &a.quickQuery).Placeholder(a.t("Search files and commits")).AutoFocus()
			if in.Changed() {
				a.rebuildQuick()
			}
			if in.Submitted() {
				a.chooseQuick()
			}
			if uiContextKey(c, ui.KeyEscape) {
				a.quickOpen = false
			}
			ui.Scroll(c).MaxHeight(420).Children(func() {
				ui.Column(c).Gap(1).Children(func() {
					for i, hit := range a.quickIndex {
						if i > 40 {
							break
						}
						i, hit := i, hit
						row := ui.ButtonBase(c).Padding(3, 8).Radius(4)
						if i == a.quickSel {
							row.Background(t.SurfaceHover)
						}
						row.Children(func() {
							ui.Row(c).Gap(8).Children(func() {
								ui.Text(c, hit.title).FontSize(12)
								ui.Spacer(c).Grow(1)
								if hit.detail != "" {
									ui.Text(c, hit.detail).FontSize(10).TextColor(t.TextMuted)
								}
							})
						})
						if row.Clicked() {
							a.quickSel = i
							a.chooseQuick()
						}
					}
				})
			})
		})
	})
}

// ContextKey reports an unconsumed key of this frame; it keeps the quick
// open overlay simple.
func uiContextKey(c *ui.Context, key ui.Key) bool {
	return c.KeyDown(key)
}

func (a *nativeApp) showStashFiles(st git.Stash) {
	go func() {
		files, err := a.g.StashFiles(st.Index)
		mygo.RunOnMain(func() {
			if err != nil {
				a.fail(err)
				return
			}
			a.dialog = dialogState{kind: dialogStashFiles, stashIndex: st.Index, stashFiles: files, title: fmt.Sprintf("stash@{%d}", st.Index)}
			a.redraw()
		})
	}()
}

func (a *nativeApp) stashFilesDialog(c *ui.Context) {
	t := c.Theme()
	ui.Text(c, fmt.Sprintf("stash@{%d}", a.dialog.stashIndex)).FontSize(10).TextColor(t.TextMuted)
	ui.Scroll(c).MaxHeight(320).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			for _, f := range a.dialog.stashFiles {
				f := f
				row := ui.ButtonBase(c).Padding(3, 8).Radius(4)
				row.Children(func() {
					ui.Row(c).Gap(6).Children(func() {
						ui.Text(c, f.Path).FontSize(11)
						ui.Spacer(c).Grow(1)
						ui.Text(c, fmt.Sprintf("+%d −%d", f.Additions, f.Deletions)).FontSize(9).TextColor(t.TextMuted)
					})
				})
				if row.Clicked() {
					index := a.dialog.stashIndex
					a.closeDialog()
					a.openDiff(git.DiffOptions{
						Path:     f.Path,
						OldPath:  f.OldPath,
						Target:   git.DiffRange,
						From:     fmt.Sprintf("stash@{%d}^", index),
						Revision: fmt.Sprintf("stash@{%d}", index),
						Context:  a.settings.DiffContext,
					})
				}
			}
		})
	})
	ui.Row(c).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
}

func (a *nativeApp) openPatchDialog() {
	a.dialog = dialogState{kind: dialogPatch, title: a.t("Patches")}
}

func (a *nativeApp) patchDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("From revision"), func() { ui.TextInput(c, &d.from).Placeholder(a.t("Optional")) })
	ui.Field(c, a.t("To revision"), func() { ui.TextInput(c, &d.to).Placeholder(a.t("Optional")) })
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Save Patch")).Clicked() {
			opts := git.PatchOptions{Staged: d.flag1, From: strings.TrimSpace(d.from), Revision: strings.TrimSpace(d.to)}
			a.closeDialog()
			a.busyRun("patch", func() error {
				_, err := a.g.SavePatch(opts, "changes.patch")
				return err
			})
		}
		if ui.Button(c, a.t("Apply Patch File")).Clicked() {
			a.closeDialog()
			a.busyRun("patch", func() error {
				_, err := a.g.ApplyPatchFile(false)
				return err
			})
		}
		if ui.Button(c, a.t("Apply Reverse")).Clicked() {
			a.closeDialog()
			a.busyRun("patch", func() error {
				_, err := a.g.ApplyPatchFile(true)
				return err
			})
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
	ui.Checkbox(c, &d.flag1, a.t("Staged changes only"))
}

func (a *nativeApp) openMergeDialog(ref string) {
	a.dialog = dialogState{kind: dialogMerge, from: ref, title: a.t("Merge")}
}

func (a *nativeApp) mergeDialog(c *ui.Context) {
	d := &a.dialog
	ui.Text(c, d.from).FontSize(12).FontWeight(600)
	ui.Checkbox(c, &d.flag1, a.t("Fast-forward only"))
	ui.Checkbox(c, &d.flag2, a.t("No fast-forward"))
	ui.Checkbox(c, &d.flag3, a.t("Squash"))
	ui.Checkbox(c, &d.flag4, a.t("No commit"))
	ui.Checkbox(c, &d.flag5, a.t("Skip hooks"))
	ui.Checkbox(c, &d.flag6, a.t("Allow unrelated histories"))
	a.buttons(c, a.t("Merge"), func() {
		opts := git.MergeOptions{
			FFOnly:                  d.flag1,
			NoFF:                    d.flag2,
			Squash:                  d.flag3,
			NoCommit:                d.flag4,
			NoVerify:                d.flag5,
			AllowUnrelatedHistories: d.flag6,
		}
		ref := d.from
		a.closeDialog()
		a.busyRun("merge", func() error {
			_, err := a.g.Merge(ref, opts)
			return err
		})
	})
}

func (a *nativeApp) openRebaseDialog(onto string) {
	a.dialog = dialogState{kind: dialogRebase, from: onto, title: a.t("Rebase")}
}

func (a *nativeApp) rebaseDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("Onto"), func() { ui.TextInput(c, &d.from) })
	ui.Checkbox(c, &d.flag1, a.t("Autostash"))
	ui.Checkbox(c, &d.flag2, a.t("Update refs"))
	ui.Checkbox(c, &d.flag3, a.t("Rebase merges"))
	ui.Checkbox(c, &d.flag4, a.t("Keep empty commits"))
	ui.Checkbox(c, &d.flag5, a.t("Rebase the root"))
	a.buttons(c, a.t("Rebase"), func() {
		opts := git.RebaseOptions{
			Onto:         strings.TrimSpace(d.from),
			Autostash:    d.flag1,
			UpdateRefs:   d.flag2,
			RebaseMerges: d.flag3,
			KeepEmpty:    d.flag4,
			Root:         d.flag5,
		}
		a.closeDialog()
		a.busyRun("rebase", func() error {
			_, err := a.g.Rebase(opts)
			return err
		})
	})
}

func (a *nativeApp) openRewrite(hash string) {
	if hash == "" {
		return
	}
	a.busy++
	go func() {
		detail, err := a.g.ShowCommit(hash)
		if err != nil {
			mygo.RunOnMain(func() { a.busy--; a.fail(err) })
			return
		}
		onto := ""
		if len(detail.Parents) > 0 {
			onto = detail.Parents[0]
		}
		plan, err := a.g.RewritePlan(onto)
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			steps := make([]git.PlanStep, len(plan))
			for i, c := range plan {
				steps[i] = git.PlanStep{Hash: c.Hash, Action: "pick"}
			}
			a.dialog = dialogState{kind: dialogRewrite, plan: plan, steps: steps, onto: onto}
			a.redraw()
		})
	}()
}

func (a *nativeApp) rewriteDialog(c *ui.Context) {
	t := c.Theme()
	if len(a.dialog.plan) == 0 {
		ui.Text(c, a.t("There is nothing to rewrite")).FontSize(11).TextColor(t.TextMuted)
	}
	for i := range a.dialog.plan {
		i := i
		commit := a.dialog.plan[i]
		step := &a.dialog.steps[i]
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			ui.Text(c, commit.Short).FontSize(10).Font("monospace").TextColor(t.TextMuted)
			ui.Text(c, commit.Subject).FontSize(11).MaxLines(1).Grow(1)
			ui.MenuButton(c, step.Action, func(m *ui.Menu) {
				for _, action := range []string{"pick", "reword", "squash", "fixup", "drop"} {
					action := action
					if m.Item(action).Chosen() {
						step.Action = action
						if action == "reword" || action == "squash" {
							step.Message = commit.Message
						}
					}
				}
			})
			if ui.Button(c, "↑").Clicked() && i > 0 {
				a.dialog.plan[i-1], a.dialog.plan[i] = a.dialog.plan[i], a.dialog.plan[i-1]
				a.dialog.steps[i-1], a.dialog.steps[i] = a.dialog.steps[i], a.dialog.steps[i-1]
			}
			if ui.Button(c, "↓").Clicked() && i < len(a.dialog.plan)-1 {
				a.dialog.plan[i+1], a.dialog.plan[i] = a.dialog.plan[i], a.dialog.plan[i+1]
				a.dialog.steps[i+1], a.dialog.steps[i] = a.dialog.steps[i], a.dialog.steps[i+1]
			}
		})
		if step.Action == "reword" || step.Action == "squash" {
			ui.TextArea(c, &step.Message).Height(56)
		}
	}
	ui.Row(c).Gap(6).Children(func() {
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Cancel")).Clicked() {
			a.closeDialog()
		}
		if ui.PrimaryButton(c, a.t("Rewrite")).Clicked() {
			onto := a.dialog.onto
			steps := append([]git.PlanStep(nil), a.dialog.steps...)
			a.closeDialog()
			a.busyRun("rewrite", func() error {
				_, err := a.g.Rewrite(onto, steps)
				return err
			})
		}
	})
}

func (a *nativeApp) openShelfDialog() {
	a.busy++
	go func() {
		shelves, err := a.g.Shelves()
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			a.dialog = dialogState{kind: dialogShelf, shelves: shelves}
			a.redraw()
		})
	}()
}

func (a *nativeApp) shelfDialog(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Save Current Changes")).Clicked() {
			a.dialog = dialogState{kind: dialogPrompt, title: a.t("Save Shelf"), message: a.t("Name"), action: "save-shelf"}
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
	if len(a.dialog.shelves) == 0 {
		ui.Text(c, a.t("No shelves")).FontSize(11).TextColor(t.TextMuted)
	}
	ui.Scroll(c).MaxHeight(340).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			for _, sh := range a.dialog.shelves {
				sh := sh
				row := ui.ButtonBase(c).Padding(3, 8).Radius(4)
				row.Children(func() {
					ui.Row(c).Gap(8).Children(func() {
						ui.Text(c, sh.Name).FontSize(11).FontWeight(600)
						ui.Text(c, fmt.Sprintf("%d files", sh.Files)).FontSize(9).TextColor(t.TextMuted)
						ui.Spacer(c).Grow(1)
						ui.Text(c, a.stamp(sh.Time)).FontSize(9).TextColor(t.TextMuted)
					})
				})
				row.ContextMenu(func(m *ui.Menu) {
					if m.Item(a.t("Apply")).Chosen() {
						name := sh.Name
						a.busyRun("shelf", func() error {
							_, err := a.g.ApplyShelf(name, false)
							return err
						})
					}
					if m.Item(a.t("Apply and Drop")).Chosen() {
						name := sh.Name
						a.busyRun("shelf", func() error {
							_, err := a.g.ApplyShelf(name, true)
							return err
						})
					}
					if m.Item(a.t("Rename")).Chosen() {
						a.dialog = dialogState{kind: dialogPrompt, title: a.t("Rename Shelf"), message: a.t("Name"), action: "rename-shelf", target: sh.Name, text: sh.Name}
					}
					if m.Item(a.t("Drop")).Chosen() {
						name := sh.Name
						a.busyRun("shelf", func() error {
							_, err := a.g.DropShelf(name)
							return err
						})
					}
				})
			}
		})
	})
}

func (a *nativeApp) openJournalDialog() {
	a.busy++
	go func() {
		entries, err := a.g.Journal(500)
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			a.dialog = dialogState{kind: dialogJournal, journal: entries}
			a.redraw()
		})
	}()
}

func (a *nativeApp) journalDialog(c *ui.Context) {
	t := c.Theme()
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Reveal Log File")).Clicked() {
			if path, err := a.g.JournalFile(); err == nil {
				_ = a.ws.Reveal(path)
			}
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
	ui.Scroll(c).MaxHeight(420).Children(func() {
		ui.Column(c).Gap(4).Children(func() {
			for i := len(a.dialog.journal) - 1; i >= 0; i-- {
				e := a.dialog.journal[i]
				ui.Column(c).Children(func() {
					ui.Row(c).Gap(8).Children(func() {
						ui.Text(c, a.stamp(e.At/1000)).FontSize(9).TextColor(t.TextMuted)
						ui.Text(c, e.Action).FontSize(10).FontWeight(600)
						if e.Error != "" {
							ui.Text(c, e.Error).FontSize(9).TextColor(t.Danger)
						}
					})
					for _, cmd := range e.Commands {
						ui.Text(c, "$ "+cmd).FontSize(9).Font("monospace").TextColor(t.TextMuted)
					}
					if e.Output != "" {
						ui.Text(c, strings.TrimRight(e.Output, "\n")).FontSize(9).Font("monospace").MaxLines(4)
					}
				})
			}
		})
	})
}

func (a *nativeApp) openWorktreeDialog() {
	a.dialog = dialogState{kind: dialogWorktree, title: a.t("New Worktree")}
}

func (a *nativeApp) worktreeDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("Path"), func() { ui.TextInput(c, &d.dirPath).Placeholder(a.t("Folder for the worktree")) })
	ui.Field(c, a.t("Branch"), func() { ui.TextInput(c, &d.branch) })
	ui.Checkbox(c, &d.flag1, a.t("Create a new branch"))
	a.buttons(c, a.t("Create"), func() {
		path, branch := strings.TrimSpace(d.dirPath), strings.TrimSpace(d.branch)
		newBranch := d.flag1
		a.closeDialog()
		a.busyRun("worktree", func() error {
			_, err := a.g.AddWorktree(path, branch, newBranch)
			return err
		})
	})
}

func (a *nativeApp) openSubmoduleDialog() {
	a.dialog = dialogState{kind: dialogSubmodule, title: a.t("Add Submodule")}
}

func (a *nativeApp) submoduleDialog(c *ui.Context) {
	d := &a.dialog
	ui.Field(c, a.t("URL"), func() { ui.TextInput(c, &d.url) })
	ui.Field(c, a.t("Path"), func() { ui.TextInput(c, &d.dirPath) })
	ui.Field(c, a.t("Branch"), func() { ui.TextInput(c, &d.branch).Placeholder(a.t("Optional")) })
	a.buttons(c, a.t("Add"), func() {
		url, path, branch := strings.TrimSpace(d.url), strings.TrimSpace(d.dirPath), strings.TrimSpace(d.branch)
		a.closeDialog()
		a.busyRun("submodule", func() error {
			_, err := a.g.AddSubmodule(url, path, branch)
			return err
		})
	})
}

func (a *nativeApp) openLFSDialog() {
	a.dialog = dialogState{kind: dialogLFS, title: "Git LFS"}
}

func (a *nativeApp) lfsDialog(c *ui.Context) {
	t := c.Theme()
	ui.Text(c, fmt.Sprintf("Git LFS %s", a.lfs.Version)).FontSize(11)
	ui.Field(c, a.t("Patterns"), func() {
		ui.TextInput(c, &a.dialog.patterns).Placeholder("*.psd, *.zip")
	})
	ui.Row(c).Gap(6).Children(func() {
		if ui.Button(c, a.t("Track")).Clicked() {
			patterns := splitPatterns(a.dialog.patterns)
			a.busyRun("lfs", func() error {
				_, err := a.g.LFSTrack(patterns)
				return err
			})
		}
		if ui.Button(c, a.t("Untrack")).Clicked() {
			patterns := splitPatterns(a.dialog.patterns)
			a.busyRun("lfs", func() error {
				_, err := a.g.LFSUntrack(patterns)
				return err
			})
		}
		if ui.Button(c, a.t("Pull LFS Files")).Clicked() {
			a.busyRun("lfs", func() error {
				_, err := a.g.LFSPull(nil)
				return err
			})
		}
		ui.Spacer(c).Grow(1)
		if ui.Button(c, a.t("Close")).Clicked() {
			a.closeDialog()
		}
	})
	ui.Scroll(c).MaxHeight(260).Children(func() {
		ui.Column(c).Gap(1).Children(func() {
			for _, f := range a.lfs.Files {
				ui.Text(c, f.Path).FontSize(10).TextColor(t.TextMuted)
			}
		})
	})
}

func splitPatterns(s string) []string {
	var out []string
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == ';' }) {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (a *nativeApp) undoCommit() {
	a.busy++
	go func() {
		res, err := a.g.UndoCommit()
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			if res.Subject != "" {
				a.commitForm.Message = res.Subject
			}
			a.refresh()
		})
	}()
}

func (a *nativeApp) promptDialog(c *ui.Context) {
	d := &a.dialog
	ui.Text(c, d.message).FontSize(11)
	in := ui.TextInput(c, &d.text).AutoFocus()
	if in.Submitted() {
		a.applyPrompt()
		return
	}
	a.buttons(c, a.t("OK"), a.applyPrompt)
}

func (a *nativeApp) applyPrompt() {
	d := a.dialog
	a.closeDialog()
	target := d.text
	switch d.action {
	case "new-file":
		path := joinRepoPath(d.target, target)
		a.busyRun("new-file", func() error { return a.g.CreateFile(path) })
	case "new-folder":
		path := joinRepoPath(d.target, target)
		a.busyRun("new-folder", func() error { return a.g.CreateDir(path) })
	case "new-changelist":
		name := strings.TrimSpace(target)
		if name != "" {
			a.busyRun("changelist", func() error {
				_, err := a.g.CreateChangelist(name, "")
				return err
			})
		}
	case "rename-changelist":
		name := strings.TrimSpace(target)
		id := d.target
		if name != "" {
			a.busyRun("changelist", func() error {
				_, err := a.g.RenameChangelist(id, name, "")
				return err
			})
		}
	case "lock-worktree":
		reason := strings.TrimSpace(target)
		path := d.target
		a.busyRun("worktree", func() error {
			_, err := a.g.LockWorktree(path, reason)
			return err
		})
	case "browse-revision":
		rev := strings.TrimSpace(target)
		if rev != "" {
			a.openRevisionTree(rev)
		}
	case "label-history":
		label := strings.TrimSpace(target)
		path := d.target
		digest := d.dirPath
		if label != "" {
			if err := a.g.LabelLocalHistory(path, digest, label); err != nil {
				a.fail(err)
			}
		}
	case "rename-remote":
		name := strings.TrimSpace(target)
		old := d.target
		if name != "" {
			a.busyRun("remote", func() error { return a.g.RenameRemote(old, name) })
		}
	case "stash-branch":
		branch := strings.TrimSpace(target)
		index, _ := strconv.Atoi(d.target)
		if branch != "" {
			a.busyRun("stash", func() error {
				_, err := a.g.StashToBranch(index, branch)
				return err
			})
		}
	case "save-shelf":
		name := strings.TrimSpace(target)
		if name != "" {
			a.busyRun("shelf", func() error {
				_, err := a.g.SaveShelf(name, git.PatchOptions{})
				return err
			})
		}
	case "rename-shelf":
		name := strings.TrimSpace(target)
		old := d.target
		if name != "" {
			a.busyRun("shelf", func() error { return a.g.RenameShelf(old, name) })
		}
	case "rename":
		to := target
		if !strings.Contains(to, "/") && d.target != "" {
			to = joinRepoPath(filepath.Dir(d.target), to)
		}
		from := d.target
		a.busyRun("rename", func() error { return a.g.RenamePath(from, to) })
	}
}

func joinRepoPath(dir, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return strings.TrimSpace(dir)
	}
	if filepath.IsAbs(name) {
		return name
	}
	dir = strings.Trim(strings.TrimSpace(dir), "/")
	if dir == "" {
		return name
	}
	return dir + "/" + name
}

// ----- small helpers ----------------------------------------------------

func (a *nativeApp) openPreview(text, path string) {
	tab := &docTab{kind: tabSource, id: "preview:" + path, title: a.t("Preview: ") + filepath.Base(path), path: path, revision: "PREVIEW"}
	buf := editorBuffer(text)
	tab.src = newEditorState(buf, true)
	a.tabs = append(a.tabs, tab)
	a.activeTab = len(a.tabs) - 1
}

func (a *nativeApp) resolveSimpleConflicts() {
	a.closeDialog()
	a.busy++
	go func() {
		resolved, remaining := 0, 0
		for _, cf := range a.snapshot.Conflicts {
			content, err := a.g.Conflict(cf.Path)
			if err != nil || content.Binary {
				continue
			}
			text, left := resolveSimpleText(content.Working)
			if err := a.g.SaveResolution(cf.Path, text, left == 0); err != nil {
				continue
			}
			if left == 0 {
				resolved++
			} else {
				remaining += left
			}
		}
		mygo.RunOnMain(func() {
			a.busy--
			a.setNotice(fmt.Sprintf(a.t("Resolved %d files, %d blocks remain"), resolved, remaining))
			a.refresh()
		})
	}()
}
