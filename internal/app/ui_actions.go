package app

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

// ----- index and working tree ------------------------------------------

func (a *nativeApp) stage(paths []string) {
	paths = cleanList(paths)
	if len(paths) == 0 {
		return
	}
	a.busyRun("stage", func() error { return a.g.Stage(paths) })
}

func (a *nativeApp) stageIntent(paths []string) {
	paths = cleanList(paths)
	if len(paths) == 0 {
		return
	}
	a.busyRun("intent", func() error { return a.g.StageIntent(paths) })
}

func (a *nativeApp) unstage(paths []string) {
	paths = cleanList(paths)
	if len(paths) == 0 {
		return
	}
	a.busyRun("unstage", func() error { return a.g.Unstage(paths) })
}

func (a *nativeApp) rollback(paths []string) {
	paths = cleanList(paths)
	if len(paths) == 0 {
		return
	}
	if a.settings.ConfirmRollback {
		a.dialog = dialogState{kind: dialogConfirm, title: a.t("Rollback changes"), message: a.t("Discard the changes to these files?"), action: "rollback", paths: paths}
		return
	}
	a.doRollback(paths)
}

func (a *nativeApp) doRollback(paths []string) {
	a.busyRun("rollback", func() error { return a.g.Rollback(paths) })
}

func (a *nativeApp) ignore(paths []string) {
	paths = cleanList(paths)
	if len(paths) == 0 {
		return
	}
	a.busyRun("ignore", func() error {
		_, err := a.g.Ignore(paths)
		return err
	})
}

func cleanList(paths []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// ----- diff actions -----------------------------------------------------

func (a *nativeApp) diffAction(tab *docTab, hunk int, lines []int, action string) {
	opts := tab.opts
	opts.IgnoreWhitespace = a.settings.IgnoreWhitespace
	a.busyRun(action, func() error {
		var err error
		switch {
		case len(lines) > 0:
			err = a.g.ApplyLines(opts, lines, action)
		case hunk >= 0:
			err = a.g.ApplyHunk(opts, hunk, action)
		default:
			err = a.g.ApplyFile(opts, action)
		}
		return err
	})
}

func (a *nativeApp) applyAction(tab *docTab) string {
	if tab.opts.Target == git.DiffStaged {
		return "unstage"
	}
	return "stage"
}

func (a *nativeApp) applyDiffFile(tab *docTab) {
	a.diffAction(tab, -1, nil, a.applyAction(tab))
}

func (a *nativeApp) applyDiffHunk(tab *docTab, hunk int) {
	a.diffAction(tab, hunk, nil, a.applyAction(tab))
}

func (a *nativeApp) applyDiffLines(tab *docTab) {
	if !tab.hasSel {
		return
	}
	var lines []int
	for i := tab.selStart; i <= tab.selEnd; i++ {
		lines = append(lines, i+1)
	}
	a.diffAction(tab, -1, lines, a.applyAction(tab))
}

func (a *nativeApp) externalDiff(opts git.DiffOptions) {
	a.busyRun("difftool", func() error {
		_, err := a.g.ExternalDiff(opts)
		return err
	})
}

// ----- commit -----------------------------------------------------------

// checkedPaths returns the paths checked in the commit tool window. When
// nothing is checked, every change counts, as IDEA commits the changelist.
func (a *nativeApp) checkedPaths() []string {
	seen := map[string]bool{}
	var out []string
	for _, row := range a.changes {
		if row.change.Unmerged || row.change.Kind == "ignored" {
			continue
		}
		key := row.change.Path
		if row.staged {
			key = "staged:" + key
		}
		if a.checked[key] {
			if !seen[row.change.Path] {
				seen[row.change.Path] = true
				out = append(out, row.change.Path)
			}
		}
	}
	if len(out) == 0 {
		for _, row := range a.changes {
			if row.change.Unmerged || row.change.Kind == "ignored" {
				continue
			}
			if !seen[row.change.Path] {
				seen[row.change.Path] = true
				out = append(out, row.change.Path)
			}
		}
	}
	return out
}

func (a *nativeApp) requestCommit() {
	form := a.commitForm
	paths := a.checkedPaths()
	if strings.TrimSpace(form.Message) == "" && !form.Amend {
		a.setNotice(a.t("A commit needs a message"))
		return
	}
	if a.protectedBranch() {
		a.dialog = dialogState{kind: dialogConfirm, title: a.t("Protected branch"), message: fmt.Sprintf(a.t("Commit to %s anyway?"), a.snapshot.State.Branch), action: "commit"}
		return
	}
	a.busy++
	a.redraw()
	go func() {
		warnings, err := a.g.CommitChecks(paths)
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			if len(warnings) > 0 {
				a.dialog = dialogState{kind: dialogCommitChecks, warnings: warnings}
				a.redraw()
				return
			}
			a.commitNow(paths, form)
		})
	}()
}

func (a *nativeApp) protectedBranch() bool {
	name := a.snapshot.State.Branch
	for _, pattern := range a.settings.ProtectedBranches {
		if pattern != "" && (name == pattern || strings.Contains(name, pattern)) {
			return true
		}
	}
	return false
}

func (a *nativeApp) commitNow(paths []string, form commitForm) {
	opts := git.CommitOptions{
		Message:     form.Message,
		Paths:       paths,
		Amend:       form.Amend,
		SignOff:     form.SignOff,
		NoVerify:    form.NoVerify,
		AllowEmpty:  form.AllowEmpty,
		Sign:        form.Sign,
		AuthorName:  form.AuthorName,
		AuthorEmail: form.AuthorEmail,
	}
	a.busy++
	a.redraw()
	go func() {
		res, err := a.g.Commit(opts)
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			a.committed(res.Subject)
			a.afterCommit()
		})
	}()
}

func (a *nativeApp) committed(subject string) {
	if subject == "" {
		subject = a.t("Commit created")
	}
	a.setNotice(subject)
}

func (a *nativeApp) continueOperation() {
	a.busyRun("continue", func() error {
		_, err := a.g.ContinueOperation()
		return err
	})
}

func (a *nativeApp) skipOperation() {
	a.busyRun("skip", func() error {
		_, err := a.g.SkipOperation()
		return err
	})
}

func (a *nativeApp) abortOperation() {
	a.dialog = dialogState{kind: dialogConfirm, title: a.t("Abort operation"), message: a.t("Abort and return to the previous state?"), action: "abort"}
}

func (a *nativeApp) doAbortOperation() {
	a.busyRun("abort", func() error {
		_, err := a.g.AbortOperation()
		return err
	})
}

// ----- fetch and network ------------------------------------------------

func (a *nativeApp) fetch() {
	opts := git.FetchOptions{All: true, Prune: true, Tags: false}
	a.busy++
	a.consoleOpen = true
	a.redraw()
	go func() {
		text, err := a.g.Fetch(opts, nil)
		mygo.RunOnMain(func() {
			a.busy--
			if text != "" {
				a.appendConsole(text)
			}
			if err != nil {
				a.fail(err)
				return
			}
			a.setNotice(a.t("Fetched"))
			a.refresh()
		})
	}()
}

func (a *nativeApp) openPullDialog() {
	if !a.repoOpen {
		return
	}
	branch := a.snapshot.State.Branch
	remote := ""
	for _, r := range a.remotes {
		remote = r.Name
		break
	}
	a.dialog = dialogState{kind: dialogPull, remote: remote, branch: branch}
}

func (a *nativeApp) pull(opts git.PullOptions) {
	a.busy++
	go func() {
		text, err := a.g.Pull(opts, nil)
		mygo.RunOnMain(func() {
			a.busy--
			if text != "" {
				a.appendConsole(text)
			}
			if err != nil {
				a.fail(err)
				return
			}
			a.refresh()
		})
	}()
}

func (a *nativeApp) openPushDialog() {
	if !a.repoOpen {
		return
	}
	branch := a.snapshot.State.Branch
	remote := ""
	for _, r := range a.remotes {
		remote = r.Name
		break
	}
	a.dialog = dialogState{kind: dialogPush, remote: remote, branch: branch, remoteBranch: branch}
	go func() {
		preview, err := a.g.PushPreview(remote, branch, branch)
		mygo.RunOnMain(func() {
			if err == nil {
				a.dialog.preview = &preview
				if preview.RemoteBranch != "" {
					a.dialog.remoteBranch = preview.RemoteBranch
				}
				a.dialog.remote = preview.Remote
				a.redraw()
			}
		})
	}()
}

func (a *nativeApp) push(opts git.PushOptions) {
	a.busy++
	go func() {
		text, err := a.g.Push(opts, nil)
		mygo.RunOnMain(func() {
			a.busy--
			if text != "" {
				a.appendConsole(text)
			}
			if err != nil {
				a.fail(err)
				if a.settings.AutoUpdateOnReject && strings.Contains(err.Error(), "rejected") {
					a.openPullDialog()
				}
				return
			}
			a.refresh()
		})
	}()
}

// ----- checkout, branches, tags -----------------------------------------

func (a *nativeApp) checkout(ref string) {
	a.busyRun("checkout", func() error {
		_, err := a.g.Checkout(ref)
		return err
	})
}

func (a *nativeApp) checkoutUpdate(ref string) {
	a.busyRun("checkout", func() error {
		_, err := a.g.CheckoutAndUpdate(ref)
		return err
	})
}

func (a *nativeApp) deleteBranch(name string) {
	a.dialog = dialogState{kind: dialogConfirm, title: a.t("Delete branch"), message: fmt.Sprintf(a.t("Delete branch %s?"), name), action: "delete-branch", text: name}
}

func (a *nativeApp) deleteTag(name string) {
	a.busyRun("delete-tag", func() error { return a.g.DeleteTag(name, "") })
}

func (a *nativeApp) takeSide(path, side string) {
	a.busyRun("take-side", func() error { return a.g.TakeSide(path, side) })
}

func (a *nativeApp) openRefLog(ref git.RepoRef) {
	a.logOpts.Refs = []string{ref.FullName}
	if a.logOpts.Refs[0] == "" {
		a.logOpts.Refs = []string{ref.Name}
	}
	a.logOpts.Path = ""
	a.logOpts.Line = 0
	a.openLogTab()
}

func (a *nativeApp) showFileHistory(path string) {
	a.logOpts.Refs = nil
	a.logOpts.Path = path
	a.logOpts.Line = 0
	a.logOpts.Follow = true
	a.openLogTab()
}

func (a *nativeApp) showLineHistory(path string, line int) {
	a.logOpts.Refs = nil
	a.logOpts.Path = path
	a.logOpts.Line = line
	a.logOpts.Follow = true
	a.openLogTab()
}

func (a *nativeApp) openLogTab() {
	if !a.repoOpen {
		return
	}
	a.sideTab = 3
	a.refresh()
}

// ----- console ----------------------------------------------------------

func (a *nativeApp) runConsole() {
	line := strings.TrimSpace(a.consoleIn)
	if line == "" {
		return
	}
	a.consoleIn = ""
	a.consoleHis = append([]string{line}, a.consoleHis...)
	a.consoleAt = -1
	if !strings.HasPrefix(line, "!") && line != "git" && !strings.HasPrefix(line, "git ") {
		line = "git " + line
	}
	if strings.HasPrefix(line, "!") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "!"))
	}
	a.appendConsole("$ " + line)
	a.busy++
	go func() {
		res, err := a.g.Console(line, nil)
		mygo.RunOnMain(func() {
			a.busy--
			if res.Output != "" {
				a.appendConsole(strings.TrimRight(res.Output, "\n"))
			}
			if err != nil {
				a.appendConsole("exit " + fmt.Sprint(res.ExitCode))
				a.errText = err.Error()
			}
			a.refresh()
		})
	}()
}

func (a *nativeApp) appendConsole(text string) {
	if text == "" {
		return
	}
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	a.consoleLog = append(a.consoleLog, lines...)
	if len(a.consoleLog) > 2000 {
		a.consoleLog = a.consoleLog[len(a.consoleLog)-2000:]
	}
	a.redraw()
}

// openMergeWindow opens the three-way merge editor. The native window is
// built in ui_conflict.go.
func (a *nativeApp) openMergeWindow(path string) {
	openMergeEditor(a, path)
}

// ----- helpers used by the views ---------------------------------------

func (a *nativeApp) openConflictSummary() {
	if !a.repoOpen {
		return
	}
	if len(a.snapshot.Conflicts) == 0 {
		a.setNotice(a.t("No conflicts"))
		return
	}
	a.dialog = dialogState{kind: dialogConflicts}
}

func (a *nativeApp) openQuickOpen() {
	if !a.repoOpen {
		return
	}
	a.quickOpen = true
	a.quickQuery = ""
	a.quickSel = 0
	a.quickIndex = nil
	go func() {
		files, _ := a.g.Files("")
		mygo.RunOnMain(func() {
			a.quickFiles = files
			a.rebuildQuick()
			a.redraw()
		})
	}()
}

func (a *nativeApp) rebuildQuick() {
	q := strings.ToLower(strings.TrimSpace(a.quickQuery))
	a.quickIndex = a.quickIndex[:0]
	for _, f := range a.quickFiles {
		if q == "" || strings.Contains(strings.ToLower(f.Path), q) {
			a.quickIndex = append(a.quickIndex, quickHit{title: f.Path, path: f.Path})
			if len(a.quickIndex) >= 100 {
				break
			}
		}
	}
	if q != "" {
		for i, commit := range a.log.Commits {
			if len(a.quickIndex) >= 150 {
				break
			}
			if strings.Contains(strings.ToLower(commit.Subject), q) || strings.Contains(strings.ToLower(commit.Author), q) {
				a.quickIndex = append(a.quickIndex, quickHit{title: commit.Subject, detail: commit.Short + " · " + commit.Author, revision: commit.Hash, commit: true})
				_ = i
			}
		}
	}
	if a.quickSel >= len(a.quickIndex) {
		a.quickSel = len(a.quickIndex) - 1
	}
	if a.quickSel < 0 {
		a.quickSel = 0
	}
}

func (a *nativeApp) chooseQuick() {
	if a.quickSel < 0 || a.quickSel >= len(a.quickIndex) {
		return
	}
	hit := a.quickIndex[a.quickSel]
	a.quickOpen = false
	if hit.commit {
		a.openCommitTab(hit.revision)
	} else {
		a.openSource(hit.path, "")
	}
}

// ----- LSP hooks (implemented in ui_lsp.go) -----------------------------

func (a *nativeApp) jumpToDefinition(tab *docTab, offset int) {
	a.lspDefinition(tab, offset)
}

func (a *nativeApp) hover(tab *docTab, r editor.HoverRequest) {
	a.lspHover(tab, r)
}

func (a *nativeApp) complete(tab *docTab, r editor.CompletionRequest) {
	a.lspComplete(tab, r)
}

func (a *nativeApp) gutterMenu(tab *docTab, line int) {
	if line < 0 || line >= len(tab.blame) {
		return
	}
	a.dialog = dialogState{kind: dialogBlame, tab: tab, line: line}
}
