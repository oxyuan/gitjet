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
	// A bridge belongs to the repository it was started for.
	w.c.stopLSP()
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
	w.c.stopLSP()
	w.c.mu.Lock()
	w.c.repo = nil
	w.c.meta = RepoMeta{}
	w.c.mu.Unlock()
}

// Settings returns the current settings.
func (w *Workspace) Settings() Settings { return w.c.settings }

// DefaultSettings returns what a fresh install starts from, so the page can
// reset a group of settings without spelling those values out a second time.
func (w *Workspace) DefaultSettings() Settings { return defaultSettings() }

// SaveSettings persists settings, reopening the repository when the git
// executable changed.
func (w *Workspace) SaveSettings(s Settings) (Settings, error) {
	s.clamp()
	if s.Language != "en" && s.Language != "zh" {
		s.Language = "system"
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
	ctx, trace := git.WithCommandTrace(context.Background())
	res, err := repo.Commit(ctx, opts)
	if err != nil {
		return git.CommitResult{}, err
	}
	res.Output = appendCommands(res.Output, *trace)
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

// Checkout switches branches. Uncommitted work is stashed and restored
// around the switch, so a check out is never refused for local changes.
func (g *Git) Checkout(ref string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := preserveLocalChanges(ctx, repo, "checking out "+ref, func() (string, error) {
		return repo.Checkout(ctx, ref)
	})
	g.notify()
	return appendCommands(out, *trace), err
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

// Merge merges a ref into the current branch. Local changes are stashed
// and restored around it.
func (g *Git) Merge(ref string, opts git.MergeOptions) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := preserveLocalChanges(ctx, repo, "merging "+ref, func() (string, error) {
		return repo.Merge(ctx, ref, opts)
	})
	g.notify()
	return appendCommands(out, *trace), err
}

// Rebase rebases onto a ref. Local changes are stashed and restored around
// it, in addition to git's own --autostash.
func (g *Git) Rebase(onto string, autostash bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := preserveLocalChanges(ctx, repo, "rebasing onto "+onto, func() (string, error) {
		return repo.Rebase(ctx, onto, autostash)
	})
	g.notify()
	return appendCommands(out, *trace), err
}

// CherryPick applies commits, oldest first.
func (g *Git) CherryPick(hashes []string, noCommit bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := preserveLocalChanges(ctx, repo, "cherry-picking", func() (string, error) {
		return repo.CherryPick(ctx, hashes, noCommit)
	})
	g.notify()
	return appendCommands(out, *trace), err
}

// Revert reverts commits.
func (g *Git) Revert(hashes []string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := preserveLocalChanges(ctx, repo, "reverting", func() (string, error) {
		return repo.Revert(ctx, hashes)
	})
	g.notify()
	return appendCommands(out, *trace), err
}

// Reset moves the current branch. It deliberately does not stash: a hard
// reset is asked for to throw local changes away.
func (g *Git) Reset(hash, mode string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.Reset(ctx, hash, mode)
	g.notify()
	return appendCommands(out, *trace), err
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

// PushPreview reports what a push would publish, for the confirmation
// dialog: the commits, the files, and whether the remote branch is new.
func (g *Git) PushPreview(remote, branch, remoteBranch string) (git.PushPreview, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.PushPreview{}, err
	}
	return repo.PushPreview(context.Background(), remote, branch, remoteBranch)
}

// Push pushes and streams git's output.
func (g *Git) Push(opts git.PushOptions, out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	text, err := repo.Push(ctx, opts, func(line string) { _ = out.Send(line) })
	if err == nil {
		g.rememberPushTarget(opts.Remote, opts.Branch)
	}
	g.notify()
	return appendCommands(text, *trace), err
}

// Pull pulls and streams git's output. Without --autostash the local
// changes are stashed and restored around the update.
func (g *Git) Pull(opts git.PullOptions, out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	run := func(ctx context.Context) (string, error) {
		return repo.Pull(ctx, opts, func(line string) { _ = out.Send(line) })
	}
	var text string
	if opts.Autostash {
		text, err = run(ctx)
	} else {
		text, err = preserveLocalChanges(ctx, repo, "pulling", func() (string, error) { return run(ctx) })
	}
	g.notify()
	return appendCommands(text, *trace), err
}

// Fetch fetches and streams git's output.
func (g *Git) Fetch(opts git.FetchOptions, out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	text, err := repo.Fetch(ctx, opts, func(line string) { _ = out.Send(line) })
	g.notify()
	return appendCommands(text, *trace), err
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
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.StashPush(ctx, opts)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// StashApply applies or pops a stash.
func (g *Git) StashApply(index int, pop bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.StashApply(ctx, index, pop)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// StashDrop drops a stash.
func (g *Git) StashDrop(index int) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.StashDrop(ctx, index)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
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
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.AbortOperation(ctx)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// ContinueOperation continues the merge or rebase in progress.
func (g *Git) ContinueOperation() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.ContinueOperation(ctx)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
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

// rememberPushTarget keeps the branch a push went to at the head of the
// list the push dialog starts from.
func (g *Git) rememberPushTarget(remote, branch string) {
	remote = strings.TrimSpace(remote)
	if remote == "" {
		remote = "origin"
	}
	if strings.TrimSpace(branch) == "" && g.c.repo != nil {
		if st, err := g.c.repo.Status(context.Background(), false); err == nil {
			branch = st.State.Branch
		}
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		return
	}
	target := remote + "/" + branch
	g.c.mu.Lock()
	targets := []string{target}
	for _, t := range g.c.meta.PushTargets {
		if t != target {
			targets = append(targets, t)
		}
	}
	if len(targets) > 10 {
		targets = targets[:10]
	}
	g.c.meta.PushTargets = targets
	g.c.mu.Unlock()
	_ = g.c.saveMeta()
}

// PushTargets lists the remote branches this repository pushed to, newest
// first.
func (g *Git) PushTargets() []string {
	g.c.mu.Lock()
	defer g.c.mu.Unlock()
	return append([]string(nil), g.c.meta.PushTargets...)
}

// Compare lists the files that differ between two revisions.
func (g *Git) Compare(from, to string) ([]git.Change, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	changes, err := repo.CompareRefs(context.Background(), from, to)
	if err != nil {
		return nil, err
	}
	if changes == nil {
		changes = []git.Change{}
	}
	return changes, nil
}

// ---- history rewriting ----

// RewritePlan lists the commits a rewrite of the branch onto onto would
// replay, so the plan dialog can show them with their actions.
func (g *Git) RewritePlan(onto string) ([]git.PlanCommit, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	commits, err := repo.RewritePlan(context.Background(), onto)
	if err != nil {
		return nil, err
	}
	if commits == nil {
		commits = []git.PlanCommit{}
	}
	return commits, nil
}

// Rewrite replays the commits of the range with the plan's actions. A
// conflicting step keeps the rest of the plan for ContinueOperation.
func (g *Git) Rewrite(onto string, steps []git.PlanStep) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := preserveLocalChanges(ctx, repo, "rewriting history", func() (string, error) {
		return repo.Rewrite(ctx, onto, steps)
	})
	g.notify()
	return appendCommands(out, *trace), err
}

// ---- worktrees ----

// Worktrees lists the repository's working trees.
func (g *Git) Worktrees() ([]git.Worktree, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	trees, err := repo.Worktrees(context.Background())
	if err != nil {
		return nil, err
	}
	if trees == nil {
		trees = []git.Worktree{}
	}
	return trees, nil
}

// AddWorktree checks a branch out in a new folder.
func (g *Git) AddWorktree(path, branch string, newBranch bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.AddWorktree(ctx, path, branch, newBranch)
	g.notify()
	return appendCommands(out, *trace), err
}

// RemoveWorktree deletes a working tree.
func (g *Git) RemoveWorktree(path string, force bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.RemoveWorktree(ctx, path, force)
	g.notify()
	return appendCommands(out, *trace), err
}

// PruneWorktrees forgets working trees whose folder is gone.
func (g *Git) PruneWorktrees() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.PruneWorktrees(ctx)
	return appendCommands(out, *trace), err
}

// ---- stash details ----

// StashFiles lists the paths a stash entry touches.
func (g *Git) StashFiles(index int) ([]git.StashFile, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	files, err := repo.StashFiles(context.Background(), index)
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []git.StashFile{}
	}
	return files, nil
}

// StashToBranch restores a stash on its own branch.
func (g *Git) StashToBranch(index int, branch string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.StashToBranch(ctx, index, branch)
	g.notify()
	return appendCommands(out, *trace), err
}

// ---- branch cleanup ----

// CleanupCandidates lists branches a cleanup can delete.
func (g *Git) CleanupCandidates() (git.BranchCleanup, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.BranchCleanup{}, err
	}
	return repo.CleanupCandidates(context.Background())
}

// DeleteBranches deletes several branches at once, reporting how many went.
func (g *Git) DeleteBranches(names []string, force bool) (int, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return 0, err
	}
	deleted := 0
	var firstErr error
	for _, name := range names {
		if err := repo.DeleteBranch(context.Background(), name, force); err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("%s: %w", name, err)
			}
			continue
		}
		deleted++
	}
	g.notify()
	return deleted, firstErr
}

// TakeSideAll takes ours or theirs for several conflicted paths.
func (g *Git) TakeSideAll(paths []string, side string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if len(paths) == 0 {
		return errors.New("no conflicted files were chosen")
	}
	for _, path := range paths {
		if err := repo.TakeConflictSide(context.Background(), path, side); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
	}
	g.notify()
	return nil
}

// ---- submodules, LFS, shallow clones ----

// Submodules lists the repository's submodules.
func (g *Git) Submodules() ([]git.Submodule, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	subs, err := repo.Submodules(context.Background())
	if err != nil {
		return nil, err
	}
	if subs == nil {
		subs = []git.Submodule{}
	}
	return subs, nil
}

// UpdateSubmodules checks the submodules out at their recorded commits.
func (g *Git) UpdateSubmodules(init bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	out, err := repo.UpdateSubmodules(ctx, init)
	g.notify()
	return appendCommands(out, *trace), err
}

// LFS reports whether Git LFS is installed and what it tracks.
func (g *Git) LFS() (git.LFSStatus, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.LFSStatus{}, err
	}
	return repo.LFS(context.Background()), nil
}

// Unshallow fetches the full history of a shallow clone.
func (g *Git) Unshallow(out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	text, err := repo.Unshallow(ctx, func(line string) { _ = out.Send(line) })
	g.notify()
	return appendCommands(text, *trace), err
}

// ---- command echo and local-change protection ----

// appendCommands adds the git commands an operation ran to its output, so
// the operation dock can show and copy them.
func appendCommands(out string, cmds []string) string {
	if len(cmds) == 0 {
		return out
	}
	lines := make([]string, 0, len(cmds))
	for _, c := range cmds {
		lines = append(lines, "$ "+c)
	}
	text := strings.TrimRight(out, "\n")
	if text != "" {
		text += "\n"
	}
	return text + strings.Join(lines, "\n")
}

// appendNote adds one line of explanation to an operation's output.
func appendNote(out, note string) string {
	text := strings.TrimRight(out, "\n")
	if text != "" {
		text += "\n"
	}
	return text + note
}

// preserveLocalChanges stashes uncommitted work, runs fn, then restores
// it, the way an IDE offers to shelve changes an operation would
// overwrite. label names the action in the stash message and the note.
func preserveLocalChanges(ctx context.Context, repo *git.Repo, label string, fn func() (string, error)) (string, error) {
	st, err := repo.Status(ctx, false)
	if err != nil || len(st.Changes) == 0 {
		return fn()
	}
	note := "local changes were stashed before " + label + " and restored after it"
	if _, err := repo.StashPush(ctx, git.StashOptions{Message: "gitjet: before " + label, IncludeUntracked: true}); err != nil {
		return "", fmt.Errorf("your local changes could not be saved before %s: %w", label, err)
	}
	out, opErr := fn()
	if _, popErr := repo.StashRestore(ctx, 0); popErr != nil {
		kept := "your local changes could not be restored and are in stash@{0}: " + popErr.Error()
		if opErr != nil {
			return appendNote(out, kept), fmt.Errorf("%v; %s", opErr, kept)
		}
		return appendNote(out, kept), errors.New(kept)
	}
	if opErr != nil {
		return out, opErr
	}
	return appendNote(out, note), nil
}
