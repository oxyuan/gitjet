package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"gitjet/internal/git"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

// Bootstrap is the state the page needs when it starts.
type Bootstrap struct {
	Settings Settings             `json:"settings"`
	Repo     *git.ChangesSnapshot `json:"repo"`
	Error    string               `json:"error"`
	Version  string               `json:"version"`
	Platform string               `json:"platform"`
}

// Workspace is the bound service for app-level actions: choosing and
// opening a repository, settings, and the recent list.
type Workspace struct {
	c *core
}

// Git is the bound service for the open repository. Every method that
// changes the repository also tells pages about it through RepoChanged.
type Git struct {
	c *core
}

// RepoChanged is sent when the working tree, the index or HEAD changes,
// including changes made outside the app.
var RepoChanged = mygo.NewEvent[git.RepoState]("repo:changed")

// Bootstrap returns settings, and reopens the last repository if it still
// exists, like an IDE reopening the last project.
func (w *Workspace) Bootstrap() (Bootstrap, error) {
	b := Bootstrap{
		Settings: w.c.settings,
		Version:  "0.1.0",
		Platform: runtime.GOOS + "/" + runtime.GOARCH,
	}
	w.c.mu.Lock()
	startup := w.c.startup
	recent := append([]RecentRepo(nil), w.c.settings.Recent...)
	w.c.mu.Unlock()
	if startup != "" {
		snap, err := w.Open(startup)
		if err != nil {
			b.Error = err.Error()
		} else {
			b.Repo = &snap
		}
		return b, nil
	}
	if len(recent) > 0 {
		path := recent[0].Path
		if st, err := os.Stat(path); err == nil && st.IsDir() {
			snap, err := w.Open(path)
			if err == nil {
				b.Repo = &snap
			} else {
				b.Error = err.Error()
			}
		}
	}
	return b, nil
}

// OpenInWindow starts another copy of the app on path, letting the caller
// keep its own repository open. Each window is its own process, so the two
// cannot share a repository, a poll loop or a settings write.
func (w *Workspace) OpenInWindow(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("no folder was given")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, path)
	cmd.Dir = path
	return cmd.Start()
}

// ChooseFolder shows the native folder picker and returns the chosen
// path, or "" when the user canceled.
func (w *Workspace) ChooseFolder(ctx context.Context) (string, error) {
	win := mygo.CallerWindow(ctx)
	l := w.c.uiLang()
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      win,
		Title:       l.tr("dialog.openRepo"),
		ButtonLabel: l.tr("dialog.openRepoButton"),
		Directory:   true,
		Message:     l.tr("dialog.openRepoMessage"),
	})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	if st, err := os.Stat(paths[0]); err == nil && !st.IsDir() {
		return filepath.Dir(paths[0]), nil
	}
	return paths[0], nil
}

// Open opens a repository and returns its local changes.
func (w *Workspace) Open(path string) (git.ChangesSnapshot, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return git.ChangesSnapshot{}, errors.New("no folder was given")
	}
	if st, err := os.Stat(path); err == nil && !st.IsDir() {
		path = filepath.Dir(path)
	}
	w.c.mu.Lock()
	gitPath := w.c.settings.GitPath
	w.c.mu.Unlock()
	repo, err := git.Open(context.Background(), path, gitPath)
	if err != nil {
		return git.ChangesSnapshot{}, err
	}
	w.c.mu.Lock()
	w.c.repo = repo
	w.c.meta = loadRepoMeta(repo.Dir())
	w.c.lastSig = ""
	w.c.mu.Unlock()
	w.c.addRecent(repo.Dir(), filepath.Base(repo.Dir()))
	w.c.startPolling()
	snap, err := w.c.snapshot(context.Background(), w.c.settings.ShowIgnored)
	if err != nil {
		return git.ChangesSnapshot{}, err
	}
	return snap, nil
}

// Close closes the open repository.
func (w *Workspace) Close() {
	w.c.stopPolling()
	w.c.mu.Lock()
	w.c.repo = nil
	w.c.meta = RepoMeta{}
	w.c.mu.Unlock()
}

// Settings returns the current settings.
func (w *Workspace) Settings() Settings { return w.c.settings }

// SaveSettings persists settings, reopening the repository when the git
// executable changed.
func (w *Workspace) SaveSettings(s Settings) (Settings, error) {
	if s.DiffContext <= 0 || s.DiffContext > 100 {
		s.DiffContext = 3
	}
	if s.Theme != "light" && s.Theme != "dark" {
		s.Theme = "system"
	}
	if s.Language != "en" && s.Language != "zh" {
		s.Language = "system"
	}
	if s.UpdateMethod != "rebase" {
		s.UpdateMethod = "merge"
	}
	if s.AutoFetchMinutes <= 0 {
		s.AutoFetchMinutes = 15
	}
	if s.UIScale < 70 || s.UIScale > 160 {
		s.UIScale = 100
	}
	if s.GitPath != "" {
		if _, err := git.GitVersion(context.Background(), s.GitPath); err != nil {
			return w.c.settings, fmt.Errorf("the git executable cannot be used: %w", err)
		}
	}
	oldGitPath := w.c.settings.GitPath
	oldLang := w.c.settings.Language
	w.c.mu.Lock()
	oldRecent := w.c.settings.Recent
	s.Recent = oldRecent
	w.c.settings = s
	repo := w.c.repo
	w.c.mu.Unlock()
	if err := saveSettings(s); err != nil {
		return s, err
	}
	if s.Language != oldLang {
		applyMenu(resolveLang(s.Language))
	}
	if repo != nil && s.GitPath != oldGitPath {
		reopened, err := git.Open(context.Background(), repo.Dir(), s.GitPath)
		if err != nil {
			return s, fmt.Errorf("settings were saved, but the repository could not be reopened with that git: %w", err)
		}
		w.c.mu.Lock()
		w.c.repo = reopened
		w.c.mu.Unlock()
		w.c.stopPolling()
		w.c.startPolling()
	}
	return s, nil
}

// Recent returns the recent repositories, newest first.
func (w *Workspace) Recent() []RecentRepo {
	w.c.mu.Lock()
	defer w.c.mu.Unlock()
	return append([]RecentRepo(nil), w.c.settings.Recent...)
}

// RemoveRecent forgets a recent repository.
func (w *Workspace) RemoveRecent(path string) error {
	w.c.mu.Lock()
	var out []RecentRepo
	for _, r := range w.c.settings.Recent {
		if r.Path != path {
			out = append(out, r)
		}
	}
	w.c.settings.Recent = out
	s := w.c.settings
	w.c.mu.Unlock()
	return saveSettings(s)
}

// ValidateGit checks a git executable path and returns its version.
func (w *Workspace) ValidateGit(path string) (string, error) {
	return git.GitVersion(context.Background(), path)
}

// Reveal shows a path of the repository in the file manager.
func (w *Workspace) Reveal(path string) error {
	repo, err := w.c.currentRepo()
	if err != nil {
		return err
	}
	target := repo.Dir()
	if path != "" {
		clean, err := filepath.Rel(repo.Dir(), repo.AbsPath(path))
		if err != nil || strings.HasPrefix(clean, "..") {
			return errors.New("path is outside the repository")
		}
		target = repo.AbsPath(path)
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", target).Start()
	case "windows":
		return exec.Command("explorer", "/select,", target).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(target)).Start()
	}
}

// Copy puts text on the system clipboard.
func (w *Workspace) Copy(text string) error {
	return mygo.Clipboard.Write(transfer.TextData(text))
}

// OpenURL opens a link in the browser.
func (w *Workspace) OpenURL(url string) error {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return errors.New("only http links can be opened")
	}
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

// startPolling watches git status for changes the app did not make, the
// way an IDE refreshes VCS status in the background.
func (c *core) startPolling() {
	c.stopPolling()
	stop := make(chan struct{})
	c.mu.Lock()
	c.pollStop = stop
	repo := c.repo
	c.mu.Unlock()
	if repo == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(1500 * time.Millisecond)
		defer ticker.Stop()
		lastFetch := time.Now()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				c.mu.Lock()
				autoFetch := c.settings.AutoFetch
				fetchEvery := time.Duration(c.settings.AutoFetchMinutes) * time.Minute
				c.mu.Unlock()
				if autoFetch && fetchEvery > 0 && time.Since(lastFetch) >= fetchEvery {
					lastFetch = time.Now()
					if remotes, err := repo.Remotes(ctx); err == nil && len(remotes) > 0 {
						fetchCtx, fetchCancel := context.WithTimeout(context.Background(), 2*time.Minute)
						if _, ferr := repo.Fetch(fetchCtx, git.FetchOptions{All: true, Prune: true, Tags: true}, nil); ferr == nil {
							if snap, serr := c.snapshot(fetchCtx, c.settings.ShowIgnored); serr == nil {
								RepoChanged.Broadcast(snap.State)
							}
						}
						fetchCancel()
						cancel()
						continue
					}
				}
				sig := repo.Signature(ctx)
				if sig == "" {
					cancel()
					continue
				}
				c.mu.Lock()
				changed := sig != c.lastSig
				if changed {
					c.lastSig = sig
				}
				c.mu.Unlock()
				if changed {
					if snap, err := c.snapshot(ctx, c.settings.ShowIgnored); err == nil {
						RepoChanged.Broadcast(snap.State)
					}
				}
				cancel()
			}
		}
	}()
}

func (c *core) stopPolling() {
	c.mu.Lock()
	stop := c.pollStop
	c.pollStop = nil
	c.mu.Unlock()
	if stop != nil {
		close(stop)
	}
}

// notify reads the state after a change and broadcasts it.
func (g *Git) notify() {
	repo, err := g.c.currentRepo()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if st, err := repo.Status(ctx, false); err == nil {
		g.c.mu.Lock()
		g.c.lastSig = ""
		g.c.mu.Unlock()
		RepoChanged.Broadcast(st.State)
	}
}

// Changes returns the local changes, stashes and changelists.
func (g *Git) Changes(includeIgnored bool) (git.ChangesSnapshot, error) {
	return g.c.snapshot(context.Background(), includeIgnored)
}

// Refresh rereads the repository.
func (g *Git) Refresh() (git.ChangesSnapshot, error) {
	return g.c.snapshot(context.Background(), g.c.settings.ShowIgnored)
}

// Stage adds paths to the index.
func (g *Git) Stage(paths []string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.Stage(context.Background(), paths); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Unstage removes paths from the index.
func (g *Git) Unstage(paths []string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.Unstage(context.Background(), paths); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Rollback discards local changes.
func (g *Git) Rollback(paths []string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.Rollback(context.Background(), paths); err != nil {
		return err
	}
	g.notify()
	return nil
}

// DeleteUntracked deletes untracked files.
func (g *Git) DeleteUntracked(paths []string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.DeleteUntracked(context.Background(), paths); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Ignore appends paths to .gitignore.
func (g *Git) Ignore(paths []string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	file, err := repo.Ignore(context.Background(), paths)
	if err != nil {
		return "", err
	}
	g.notify()
	return file, nil
}

// Diff returns one file's diff.
func (g *Git) Diff(opts git.DiffOptions) (git.FileDiff, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.FileDiff{}, err
	}
	if opts.Context <= 0 {
		opts.Context = g.c.settings.DiffContext
	}
	return repo.FileDiff(context.Background(), opts)
}

// ApplyHunk stages, unstages or rolls back one hunk.
func (g *Git) ApplyHunk(opts git.DiffOptions, hunkIndex int, action string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if opts.Context <= 0 {
		opts.Context = g.c.settings.DiffContext
	}
	if err := repo.ApplyDiffHunk(context.Background(), opts, hunkIndex, action); err != nil {
		return err
	}
	g.notify()
	return nil
}

// ApplyFile stages, unstages or rolls back a whole file.
func (g *Git) ApplyFile(opts git.DiffOptions, action string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.ApplyDiffHunkFile(context.Background(), opts, action); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Commit commits the selected changes.
func (g *Git) Commit(opts git.CommitOptions) (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	res, err := repo.Commit(context.Background(), opts)
	if err != nil {
		return git.CommitResult{}, err
	}
	g.rememberMessage(opts.Message)
	g.notify()
	return res, nil
}

func (g *Git) rememberMessage(msg string) {
	msg = strings.TrimSpace(msg)
	if msg == "" {
		return
	}
	g.c.mu.Lock()
	msgs := []string{msg}
	for _, m := range g.c.meta.Messages {
		if m != msg {
			msgs = append(msgs, m)
		}
	}
	if len(msgs) > 30 {
		msgs = msgs[:30]
	}
	g.c.meta.Messages = msgs
	g.c.mu.Unlock()
	_ = g.c.saveMeta()
}

// MessageHistory returns messages used in this repository.
func (g *Git) MessageHistory() []string {
	g.c.mu.Lock()
	defer g.c.mu.Unlock()
	return append([]string(nil), g.c.meta.Messages...)
}

// LastCommitMessage returns HEAD's message.
func (g *Git) LastCommitMessage() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	return repo.LastCommitMessage(context.Background())
}

// Log returns commits.
func (g *Git) Log(opts git.LogOptions) (git.LogResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.LogResult{}, err
	}
	result, err := repo.Log(context.Background(), opts)
	if err != nil {
		if st, serr := repo.Status(context.Background(), false); serr == nil && st.State.Unborn {
			refs, _ := repo.Refs(context.Background())
			return git.LogResult{Commits: []git.Commit{}, Refs: append(append(refs.Local, refs.Remote...), refs.Tags...)}, nil
		}
		return git.LogResult{}, err
	}
	if result.Commits == nil {
		result.Commits = []git.Commit{}
	}
	return result, nil
}

// ShowCommit returns a commit and its files.
func (g *Git) ShowCommit(hash string) (git.CommitDetail, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitDetail{}, err
	}
	detail, err := repo.ShowCommit(context.Background(), hash)
	if err != nil {
		return git.CommitDetail{}, err
	}
	if detail.Files == nil {
		detail.Files = []git.CommitFile{}
	}
	return detail, nil
}

// Refs lists branches and tags.
func (g *Git) Refs() (git.RefsSnapshot, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.RefsSnapshot{}, err
	}
	refs, err := repo.Refs(context.Background())
	if err != nil {
		return git.RefsSnapshot{}, err
	}
	if refs.Local == nil {
		refs.Local = []git.RepoRef{}
	}
	if refs.Remote == nil {
		refs.Remote = []git.RepoRef{}
	}
	if refs.Tags == nil {
		refs.Tags = []git.RepoRef{}
	}
	return refs, nil
}

// Remotes lists remotes.
func (g *Git) Remotes() ([]git.Remote, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.Remotes(context.Background())
}

// Checkout switches branches.
func (g *Git) Checkout(ref string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.Checkout(context.Background(), ref)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// CreateBranch creates a branch and optionally checks it out.
func (g *Git) CreateBranch(name, start string, checkout bool) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.CreateBranch(context.Background(), name, start, checkout); err != nil {
		return err
	}
	g.notify()
	return nil
}

// DeleteBranch deletes a local or remote branch.
func (g *Git) DeleteBranch(name string, force bool) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.DeleteBranch(context.Background(), name, force); err != nil {
		return err
	}
	g.notify()
	return nil
}

// RenameBranch renames a local branch.
func (g *Git) RenameBranch(oldName, newName string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RenameBranch(context.Background(), oldName, newName); err != nil {
		return err
	}
	g.notify()
	return nil
}

// SetUpstream sets a branch's upstream.
func (g *Git) SetUpstream(branch, upstream string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.SetUpstream(context.Background(), branch, upstream); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Merge merges a ref into the current branch.
func (g *Git) Merge(ref string, opts git.MergeOptions) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.Merge(context.Background(), ref, opts)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// Rebase rebases onto a ref.
func (g *Git) Rebase(onto string, autostash bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.Rebase(context.Background(), onto, autostash)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// CherryPick applies a commit.
func (g *Git) CherryPick(hash string, noCommit bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.CherryPick(context.Background(), hash, noCommit)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// Revert reverts a commit.
func (g *Git) Revert(hash string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.Revert(context.Background(), hash)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// Reset moves the current branch.
func (g *Git) Reset(hash, mode string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.Reset(context.Background(), hash, mode)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// CreateTag creates a tag.
func (g *Git) CreateTag(opts git.TagOptions) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.CreateTag(context.Background(), opts); err != nil {
		return err
	}
	g.notify()
	return nil
}

// DeleteTag deletes a tag.
func (g *Git) DeleteTag(name, remote string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.DeleteTag(context.Background(), name, remote); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Push pushes and streams git's output.
func (g *Git) Push(opts git.PushOptions, out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	text, err := repo.Push(context.Background(), opts, func(line string) { _ = out.Send(line) })
	g.notify()
	return text, err
}

// Pull pulls and streams git's output.
func (g *Git) Pull(opts git.PullOptions, out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	text, err := repo.Pull(context.Background(), opts, func(line string) { _ = out.Send(line) })
	g.notify()
	return text, err
}

// Fetch fetches and streams git's output.
func (g *Git) Fetch(opts git.FetchOptions, out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	text, err := repo.Fetch(context.Background(), opts, func(line string) { _ = out.Send(line) })
	g.notify()
	return text, err
}

// Stashes lists the stash.
func (g *Git) Stashes() ([]git.Stash, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.Stashes(context.Background())
}

// StashPush saves local changes to the stash.
func (g *Git) StashPush(opts git.StashOptions) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.StashPush(context.Background(), opts)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// StashApply applies or pops a stash.
func (g *Git) StashApply(index int, pop bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.StashApply(context.Background(), index, pop)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// StashDrop drops a stash.
func (g *Git) StashDrop(index int) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.StashDrop(context.Background(), index)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// Conflict reads the stages of an unmerged path.
func (g *Git) Conflict(path string) (git.ConflictContent, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.ConflictContent{}, err
	}
	return repo.Conflict(context.Background(), path)
}

// SaveResolution writes and stages a resolved file.
func (g *Git) SaveResolution(path, content string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.SaveResolution(context.Background(), path, content); err != nil {
		return err
	}
	g.notify()
	return nil
}

// TakeSide takes ours or theirs for a conflict.
func (g *Git) TakeSide(path, side string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.TakeConflictSide(context.Background(), path, side); err != nil {
		return err
	}
	g.notify()
	return nil
}

// MarkResolved stages conflict resolutions.
func (g *Git) MarkResolved(paths []string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.MarkResolved(context.Background(), paths); err != nil {
		return err
	}
	g.notify()
	return nil
}

// AbortOperation aborts the merge or rebase in progress.
func (g *Git) AbortOperation() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.AbortOperation(context.Background())
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// ContinueOperation continues the merge or rebase in progress.
func (g *Git) ContinueOperation() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.ContinueOperation(context.Background())
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// File reads a file for the source viewer. An empty revision reads the
// working tree.
func (g *Git) File(path, revision string) (git.SourceFile, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.SourceFile{}, err
	}
	return repo.FileContent(context.Background(), path, revision)
}

// Files searches the working tree's files for quick open.
func (g *Git) Files(query string) ([]git.RepoFile, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	files, err := repo.Files(context.Background(), query, 200)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []git.RepoFile{}
	}
	return files, nil
}

// Blame annotates a file.
func (g *Git) Blame(path string) (git.BlameResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.BlameResult{}, err
	}
	return repo.Blame(context.Background(), path)
}

// Console runs a command from the Git console and streams its output.
func (g *Git) Console(command string, out *mygo.Channel[string]) (git.ConsoleResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.ConsoleResult{}, err
	}
	res, err := repo.RunConsole(context.Background(), command, func(line string) { _ = out.Send(line) })
	g.notify()
	return res, err
}

// Completions suggests git commands and refs.
func (g *Git) Completions(prefix string) ([]git.Completion, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.ConsoleCompletions(context.Background(), prefix), nil
}

// CreateChangelist adds a changelist and makes it active.
func (g *Git) CreateChangelist(name, comment string) (git.Changelists, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return git.Changelists{}, errors.New("a changelist needs a name")
	}
	g.c.mu.Lock()
	id := "cl-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	g.c.meta.Changelists = append(g.c.meta.Changelists, git.Changelist{ID: id, Name: name, Comment: comment})
	g.c.meta.Active = id
	g.c.mu.Unlock()
	if err := g.c.saveMeta(); err != nil {
		return git.Changelists{}, err
	}
	return g.changelists()
}

// RenameChangelist renames a changelist.
func (g *Git) RenameChangelist(id, name, comment string) (git.Changelists, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return git.Changelists{}, errors.New("a changelist needs a name")
	}
	g.c.mu.Lock()
	found := false
	for i := range g.c.meta.Changelists {
		if g.c.meta.Changelists[i].ID == id {
			g.c.meta.Changelists[i].Name = name
			g.c.meta.Changelists[i].Comment = comment
			found = true
		}
	}
	g.c.mu.Unlock()
	if !found {
		return git.Changelists{}, fmt.Errorf("no changelist %q", id)
	}
	if err := g.c.saveMeta(); err != nil {
		return git.Changelists{}, err
	}
	return g.changelists()
}

// DeleteChangelist removes a changelist and moves its files to the
// default one.
func (g *Git) DeleteChangelist(id string) (git.Changelists, error) {
	g.c.mu.Lock()
	var kept []git.Changelist
	var fallback string
	for _, cl := range g.c.meta.Changelists {
		if cl.ID == id {
			continue
		}
		if cl.Default {
			fallback = cl.ID
		}
		kept = append(kept, cl)
	}
	if fallback == "" && len(kept) > 0 {
		fallback = kept[0].ID
	}
	if len(kept) == len(g.c.meta.Changelists) {
		g.c.mu.Unlock()
		return git.Changelists{}, fmt.Errorf("no changelist %q", id)
	}
	for path, cl := range g.c.meta.Assignments {
		if cl == id {
			g.c.meta.Assignments[path] = fallback
		}
	}
	g.c.meta.Changelists = kept
	if g.c.meta.Active == id {
		g.c.meta.Active = fallback
	}
	g.c.mu.Unlock()
	if err := g.c.saveMeta(); err != nil {
		return git.Changelists{}, err
	}
	return g.changelists()
}

// SetActiveChangelist makes a changelist active.
func (g *Git) SetActiveChangelist(id string) (git.Changelists, error) {
	if err := g.c.setMetaActive(id); err != nil {
		return git.Changelists{}, err
	}
	return g.changelists()
}

// MoveToChangelist moves paths to a changelist.
func (g *Git) MoveToChangelist(paths []string, id string) (git.Changelists, error) {
	g.c.mu.Lock()
	found := false
	for _, cl := range g.c.meta.Changelists {
		if cl.ID == id {
			found = true
		}
	}
	if !found {
		g.c.mu.Unlock()
		return git.Changelists{}, fmt.Errorf("no changelist %q", id)
	}
	for _, p := range paths {
		g.c.meta.Assignments[p] = id
	}
	g.c.mu.Unlock()
	if err := g.c.saveMeta(); err != nil {
		return git.Changelists{}, err
	}
	return g.changelists()
}

func (g *Git) changelists() (git.Changelists, error) {
	snap, err := g.c.snapshot(context.Background(), g.c.settings.ShowIgnored)
	if err != nil {
		return git.Changelists{}, err
	}
	return snap.Changelists, nil
}
