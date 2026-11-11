package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
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
	// The newest recent repository that still exists and still opens: a
	// folder that was moved away must not leave the app on a blank window
	// while a usable one sits further down the list.
	for _, entry := range recent {
		st, err := os.Stat(entry.Path)
		if err != nil || !st.IsDir() {
			continue
		}
		snap, err := w.Open(entry.Path)
		if err != nil {
			continue
		}
		b.Repo = &snap
		return b, nil
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

// mergeWindows tracks the separate merge-editor windows, so asking for the
// same file twice focuses the one already showing it.
var (
	mergeMu      sync.Mutex
	mergeWindows = map[string]*mygo.Window{}
)

// OpenMergeWindow shows one file's merge editor in its own window. IDEA
// resolves a conflict in a window that belongs only to that file; closing it
// leaves the repository window exactly as it was.
func (w *Workspace) OpenMergeWindow(path string) error {
	path = strings.TrimSpace(path)
	if path == "" {
		return errors.New("no file was given")
	}
	mergeMu.Lock()
	if existing := mergeWindows[path]; existing != nil && !existing.IsDestroyed() {
		mergeMu.Unlock()
		existing.Show()
		existing.Focus()
		return nil
	}
	mergeMu.Unlock()
	win := mygo.NewWindow(mygo.WindowOptions{
		Title:           "Merge " + filepath.Base(path),
		Width:           1240,
		Height:          800,
		MinWidth:        900,
		MinHeight:       560,
		BackgroundColor: "light-dark(#f5f5f7, #141416)",
		URL:             "/?merge=" + url.QueryEscape(path),
	})
	// The merge window is a page too: without this its right-click menu
	// offers Reload, which would throw away a half-resolved conflict.
	installPageContextMenu(win)
	mergeMu.Lock()
	mergeWindows[path] = win
	mergeMu.Unlock()
	win.OnClosed(func() {
		mergeMu.Lock()
		if mergeWindows[path] == win {
			delete(mergeWindows, path)
		}
		mergeMu.Unlock()
	})
	win.Focus()
	return nil
}

// CloseWindow closes the window the call came from. The merge editor calls it
// when its file is applied, saved or handed to the next conflict.
func (w *Workspace) CloseWindow(ctx context.Context) error {
	win := mygo.CallerWindow(ctx)
	if win == nil || win.IsDestroyed() {
		return nil
	}
	win.Close()
	return nil
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
	repo.SetSSHCommand(w.c.settings.SshCommand)
	w.c.mu.Unlock()
	// A bridge belongs to the repository it was started for.
	w.c.stopLSP()
	w.c.mu.Lock()
	w.c.repo = repo
	w.c.meta = loadRepoMeta(repo.Dir())
	w.c.lastSig = ""
	w.c.mu.Unlock()
	w.c.addRecent(repo.Dir(), filepath.Base(repo.Dir()))
	// The system lists the repository too: the Open Recent menu, the Dock
	// menu on macOS and the jump list on Windows hand it back through
	// App.OnOpenFile, which the window then opens like the picker does.
	if err := mygo.App.AddRecentDocument(repo.Dir()); err != nil {
		log.Print("gitjet: recent documents: ", err)
	}
	w.c.startPolling()
	snap, err := w.c.snapshot(context.Background(), w.c.settings.ShowIgnored)
	if err != nil {
		return git.ChangesSnapshot{}, err
	}
	return snap, nil
}

// Clone clones url into dir, streaming git's progress. The page opens the
// new repository when the call succeeds.
func (w *Workspace) Clone(url, dir string, out *mygo.Channel[string]) (string, error) {
	w.c.mu.Lock()
	gitPath := w.c.settings.GitPath
	w.c.mu.Unlock()
	ctx, trace := git.WithCommandTrace(context.Background())
	text, err := git.Clone(ctx, gitPath, url, dir, func(line string) { _ = out.Send(line) })
	return appendCommands(text, *trace), err
}

// Init creates a repository in dir; the page opens it afterwards.
func (w *Workspace) Init(dir, branch string) (string, error) {
	w.c.mu.Lock()
	gitPath := w.c.settings.GitPath
	w.c.mu.Unlock()
	ctx, trace := git.WithCommandTrace(context.Background())
	text, err := git.InitRepo(ctx, gitPath, dir, branch)
	return appendCommands(text, *trace), err
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
	oldSsh := w.c.settings.SshCommand
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
		applyMenu(s.Language)
	}
	if repo != nil && s.GitPath != oldGitPath {
		reopened, err := git.Open(context.Background(), repo.Dir(), s.GitPath)
		if err != nil {
			return s, fmt.Errorf("settings were saved, but the repository could not be reopened with that git: %w", err)
		}
		// The SSH client is a property of the open repository, and the new
		// one has none yet.
		reopened.SetSSHCommand(s.SshCommand)
		w.c.mu.Lock()
		w.c.repo = reopened
		w.c.mu.Unlock()
		w.c.stopPolling()
		w.c.startPolling()
	} else if repo != nil && s.SshCommand != oldSsh {
		// Every command reads this off the repository, so a saved change
		// has to reach the one that is already open.
		repo.SetSSHCommand(s.SshCommand)
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
	return revealPath(target)
}

// revealPath shows a file or folder in the system file manager.
func revealPath(target string) error {
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

// The poll reads git status while the app is in front; a read takes a git
// process, so while it is not, it reads one tick in pollIdleEvery: nothing
// on screen changes for a user in another app, and becoming active again
// refreshes at once.
const (
	pollEvery     = 1500 * time.Millisecond
	pollIdleEvery = 6
)

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
		ticker := time.NewTicker(pollEvery)
		defer ticker.Stop()
		// Coming back to the app reads the state right away instead of
		// waiting for the next tick.
		wake := make(chan struct{}, 1)
		offActive := mygo.App.OnDidBecomeActive(func() {
			select {
			case wake <- struct{}{}:
			default:
			}
		})
		defer offActive()
		lastFetch := time.Now()
		ticks := 0
		for {
			select {
			case <-stop:
				return
			case <-wake:
			case <-ticker.C:
				ticks++
				if !mygo.App.IsActive() && ticks%pollIdleEvery != 0 {
					continue
				}
			}
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			c.mu.Lock()
			autoFetch := c.settings.AutoFetch
			tagsMode := c.settings.FetchTagsMode
			fetchEvery := time.Duration(c.settings.AutoFetchMinutes) * time.Minute
			c.mu.Unlock()
			if autoFetch && fetchEvery > 0 && time.Since(lastFetch) >= fetchEvery {
				lastFetch = time.Now()
				if remotes, err := repo.Remotes(ctx); err == nil && len(remotes) > 0 {
					fetchCtx, fetchCancel := context.WithTimeout(context.Background(), 2*time.Minute)
					if _, ferr := repo.Fetch(fetchCtx, git.FetchOptions{All: true, Prune: true, TagsMode: tagsMode}, nil); ferr == nil {
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
				// An edit made outside the app is still worth a history
				// entry, which is what IDEA records too.
				repo.SnapshotChanged(ctx, 40)
				if snap, err := c.snapshot(ctx, c.settings.ShowIgnored); err == nil {
					RepoChanged.Broadcast(snap.State)
				}
			}
			cancel()
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

// CreateFile creates an empty file in the working tree.
func (g *Git) CreateFile(path string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.CreateFile(context.Background(), path); err != nil {
		return err
	}
	g.notify()
	return nil
}

// CreateDir creates a directory in the working tree.
func (g *Git) CreateDir(path string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.CreateDir(context.Background(), path); err != nil {
		return err
	}
	g.notify()
	return nil
}

// SaveFile replaces an existing working-tree file's text.
func (g *Git) SaveFile(path, text string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.SaveFile(context.Background(), path, text); err != nil {
		return err
	}
	// Local history keeps what the file looked like at each save, so a
	// revert is possible without a commit; a failure never blocks the save.
	_, _, _ = repo.SnapshotLocal(path, "save")
	g.notify()
	return nil
}

// RenamePath moves a file or directory.
func (g *Git) RenamePath(from, to string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RenamePath(context.Background(), from, to); err != nil {
		return err
	}
	g.notify()
	return nil
}

// DeletePath deletes a file or directory and stages tracked removals.
func (g *Git) DeletePath(path string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.DeletePath(context.Background(), path); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Ignore adds paths to .gitignore and removes tracked files under them from the index.
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

// ThreeWay returns a file's HEAD, index and working tree contents.
func (g *Git) ThreeWay(opts git.DiffOptions) (git.ThreeWayDiff, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.ThreeWayDiff{}, err
	}
	return repo.ThreeWay(context.Background(), opts)
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

// ExternalDiff opens the user's difftool for one file.
func (g *Git) ExternalDiff(opts git.DiffOptions) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	return repo.OpenExternalDiff(context.Background(), opts)
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

// CommitSelected commits the chosen paths without touching the staging of
// anything else, which is IDEA's in-memory commit.
func (g *Git) CommitSelected(opts git.CommitOptions) (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	res, err := repo.CommitSelected(ctx, opts)
	g.journalOperation(repo, JournalEntry{Action: "commit-selected", Commands: *trace, Output: res.Output}, err, started)
	if err != nil {
		return res, err
	}
	g.notify()
	return res, nil
}

// CommitAll commits every change the repository has, untracked files
// included. It is the commit dialog's "Commit All" button, which must not
// depend on which rows are checked.
func (g *Git) CommitAll(opts git.CommitOptions) (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	res, err := repo.CommitAllChanges(ctx, opts)
	g.journalOperation(repo, JournalEntry{Action: "commit-all", Commands: *trace, Output: res.Output}, err, started)
	if err != nil {
		return git.CommitResult{}, err
	}
	res.Output = appendCommands(res.Output, *trace)
	g.rememberMessage(opts.Message)
	g.notify()
	return res, nil
}

// UndoCommit moves HEAD back one commit, keeping its changes staged.
func (g *Git) UndoCommit() (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	res, err := repo.UndoCommit(ctx)
	g.journalOperation(repo, JournalEntry{Action: "undo-commit", Commands: *trace, Output: res.Output}, err, started)
	if err != nil {
		return res, err
	}
	g.notify()
	return res, nil
}

// CommitFixup records the staged changes as a fixup or squash commit.
func (g *Git) CommitFixup(hash string, squash bool) (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	res, err := repo.CommitFixup(ctx, hash, squash)
	g.journalOperation(repo, JournalEntry{Action: "commit-fixup", Commands: *trace, Output: res.Output}, err, started)
	if err != nil {
		return res, err
	}
	g.notify()
	return res, nil
}

// CommitFixupBySubject records a fixup commit for the one commit whose
// subject matches exactly.
func (g *Git) CommitFixupBySubject(subject string, squash bool) (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	res, err := repo.CommitFixupBySubject(ctx, subject, squash)
	g.journalOperation(repo, JournalEntry{Action: "commit-fixup-subject", Commands: *trace, Output: res.Output}, err, started)
	if err != nil {
		return res, err
	}
	g.notify()
	return res, nil
}

// AmendCommit folds the staged changes into an older commit.
func (g *Git) AmendCommit(hash, message string) (git.CommitResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.CommitResult{}, err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	res, err := repo.AmendCommit(ctx, hash, message)
	g.journalOperation(repo, JournalEntry{Action: "amend-commit", Commands: *trace, Output: res.Output}, err, started)
	if err != nil {
		return res, err
	}
	g.notify()
	return res, nil
}

// CommitChecks reports what the settings ask to warn about before a commit.
func (g *Git) CommitChecks(paths []string) ([]git.CommitWarning, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	opts := git.CommitCheckOptions{
		CRLF:        g.c.settings.CommitCheckCRLF,
		LargeFileMB: g.c.settings.CommitCheckLargeMB,
		BadNames:    g.c.settings.CommitCheckNames,
		Detached:    g.c.settings.CommitCheckHead,
	}
	return repo.CheckCommit(context.Background(), paths, opts)
}

// ApplyLines stages, unstages or rolls back the selected changed lines.
func (g *Git) ApplyLines(opts git.DiffOptions, lines []int, action string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if opts.Context <= 0 {
		opts.Context = g.c.settings.DiffContext
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	err = repo.ApplyDiffLines(ctx, opts, lines, action)
	if err == nil {
		g.journalOperation(repo, JournalEntry{Action: action + "-lines", Commands: *trace}, nil, started)
	}
	if err != nil {
		return err
	}
	g.notify()
	return nil
}

// StageIntent marks untracked paths intent-to-add.
func (g *Git) StageIntent(paths []string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.StageIntent(context.Background(), paths); err != nil {
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
	started := time.Now()
	res, err := repo.Commit(ctx, opts)
	g.journalOperation(repo, JournalEntry{Action: "commit", Commands: *trace, Output: res.Output}, err, started)
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
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "checking out "+ref, func() (string, error) {
		return repo.Checkout(ctx, ref)
	})
	g.journalOperation(repo, JournalEntry{Action: "checkout", Commands: *trace, Output: out}, err, started)
	if err == nil {
		g.rememberBranch(ref)
	}
	g.notify()
	return appendCommands(out, *trace), err
}

// rememberBranch puts a checked-out branch at the head of the recent list.
func (g *Git) rememberBranch(branch string) {
	branch = strings.TrimSpace(branch)
	if branch == "" || branch == "HEAD" || strings.HasPrefix(branch, "-") {
		return
	}
	g.c.mu.Lock()
	branches := []string{branch}
	for _, b := range g.c.meta.RecentBranches {
		if b != branch {
			branches = append(branches, b)
		}
	}
	if len(branches) > 8 {
		branches = branches[:8]
	}
	g.c.meta.RecentBranches = branches
	g.c.mu.Unlock()
	_ = g.c.saveMeta()
}

// RecentBranches lists the branches checked out lately, newest first.
func (g *Git) RecentBranches() []string {
	g.c.mu.Lock()
	defer g.c.mu.Unlock()
	return append([]string(nil), g.c.meta.RecentBranches...)
}

// CheckoutAndUpdate checks a branch out and fast-forwards it to its
// upstream, which is IDEA's "Checkout and Update".
func (g *Git) CheckoutAndUpdate(ref string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "checking out "+ref, func() (string, error) {
		out, err := repo.Checkout(ctx, ref)
		if err != nil {
			return out, err
		}
		updated, uerr := repo.UpdateSelected(ctx, ref)
		if uerr != nil {
			// The checkout happened; the update is what failed, and its
			// message says why.
			return out + "\n" + uerr.Error(), uerr
		}
		return out + "\n" + updated, nil
	})
	g.journalOperation(repo, JournalEntry{Action: "checkout-update", Commands: *trace, Output: out}, err, started)
	if err == nil {
		g.rememberBranch(ref)
	}
	g.notify()
	return appendCommands(out, *trace), err
}

// UpdateSelected fast-forwards a branch to its upstream without checking it
// out.
func (g *Git) UpdateSelected(branch string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "updating "+branch, func() (string, error) {
		return repo.UpdateSelected(ctx, branch)
	})
	g.journalOperation(repo, JournalEntry{Action: "update-selected", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// ResetToRemote resets a branch to its upstream after a force-push.
func (g *Git) ResetToRemote(branch string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := repo.ResetToRemote(ctx, branch)
	g.journalOperation(repo, JournalEntry{Action: "reset-to-remote", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// PushCommits publishes commits up to hash into a remote branch.
func (g *Git) PushCommits(remote, remoteBranch, hash string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := repo.PushCommits(ctx, remote, remoteBranch, hash)
	g.journalOperation(repo, JournalEntry{Action: "push-commits", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.rememberPushTarget(remote, remoteBranch)
	g.notify()
	return appendCommands(out, *trace), nil
}

// PushTag publishes one tag.
func (g *Git) PushTag(remote, tag string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := repo.PushTag(ctx, remote, tag)
	g.journalOperation(repo, JournalEntry{Action: "push-tag", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// AddRemote adds a remote and tells the page to refresh.
func (g *Git) AddRemote(name, url string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RemoteAdd(context.Background(), name, url); err != nil {
		return err
	}
	g.notify()
	return nil
}

// SetRemoteURL points an existing remote at another URL.
func (g *Git) SetRemoteURL(name, url string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RemoteSetURL(context.Background(), name, url); err != nil {
		return err
	}
	g.notify()
	return nil
}

// RemoveRemote deletes a remote.
func (g *Git) RemoveRemote(name string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RemoteRemove(context.Background(), name); err != nil {
		return err
	}
	g.notify()
	return nil
}

// RenameRemote renames a remote.
func (g *Git) RenameRemote(oldName, newName string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RemoteRename(context.Background(), oldName, newName); err != nil {
		return err
	}
	g.notify()
	return nil
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
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "merging "+ref, func() (string, error) {
		return repo.Merge(ctx, ref, opts)
	})
	g.journalOperation(repo, JournalEntry{Action: "merge", Commands: *trace, Output: out}, err, started)
	g.notify()
	return appendCommands(out, *trace), err
}

// Rebase rebases onto a ref. Local changes are stashed and restored around
// it, in addition to git's own --autostash.
func (g *Git) Rebase(opts git.RebaseOptions) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	where := opts.Onto
	if opts.Root {
		where = "the root"
	}
	out, err := preserveLocalChanges(ctx, repo, "rebasing onto "+where, func() (string, error) {
		return repo.Rebase(ctx, opts)
	})
	g.journalOperation(repo, JournalEntry{Action: "rebase", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "cherry-picking", func() (string, error) {
		return repo.CherryPick(ctx, hashes, noCommit)
	})
	g.journalOperation(repo, JournalEntry{Action: "cherry-pick", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "reverting", func() (string, error) {
		return repo.Revert(ctx, hashes)
	})
	g.journalOperation(repo, JournalEntry{Action: "revert", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.Reset(ctx, hash, mode)
	g.journalOperation(repo, JournalEntry{Action: "reset", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	text, err := repo.Push(ctx, opts, func(line string) { _ = out.Send(line) })
	g.journalOperation(repo, JournalEntry{Action: "push", Commands: *trace, Output: text}, err, started)
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
	started := time.Now()
	opts.TagsMode = g.c.settings.FetchTagsMode
	run := func(ctx context.Context) (string, error) {
		return repo.Pull(ctx, opts, func(line string) { _ = out.Send(line) })
	}
	var text string
	if opts.Autostash {
		text, err = run(ctx)
	} else {
		text, err = preserveLocalChanges(ctx, repo, "pulling", func() (string, error) { return run(ctx) })
	}
	g.journalOperation(repo, JournalEntry{Action: "pull", Commands: *trace, Output: text}, err, started)
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
	started := time.Now()
	opts.TagsMode = g.c.settings.FetchTagsMode
	text, err := repo.Fetch(ctx, opts, func(line string) { _ = out.Send(line) })
	g.journalOperation(repo, JournalEntry{Action: "fetch", Commands: *trace, Output: text}, err, started)
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
	started := time.Now()
	out, err := repo.StashPush(ctx, opts)
	g.journalOperation(repo, JournalEntry{Action: "stash-push", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// StashApply applies or pops a stash.
func (g *Git) StashApply(index int, pop, restoreIndex bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := repo.StashApply(ctx, index, pop, restoreIndex)
	action := "stash-apply"
	if pop {
		action = "stash-pop"
	}
	g.journalOperation(repo, JournalEntry{Action: action, Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.StashDrop(ctx, index)
	g.journalOperation(repo, JournalEntry{Action: "stash-drop", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// LocalHistory lists the saved copies of a file, newest first.
func (g *Git) LocalHistory(path string) ([]git.LocalHistoryEntry, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.LocalHistory(path)
}

// LocalHistoryAll lists the saved copies of every file in the repository.
func (g *Git) LocalHistoryAll() []git.LocalHistoryEntry {
	repo, err := g.c.currentRepo()
	if err != nil {
		return []git.LocalHistoryEntry{}
	}
	return repo.LocalHistoryAll()
}

// LocalHistoryContent reads one saved copy.
func (g *Git) LocalHistoryContent(path, digest string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	return repo.LocalHistoryContent(path, digest)
}

// RestoreLocalHistory writes a saved copy back to the working tree.
func (g *Git) RestoreLocalHistory(path, digest string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RestoreLocalHistory(path, digest); err != nil {
		return err
	}
	g.notify()
	return nil
}

// LabelLocalHistory names one saved copy.
func (g *Git) LabelLocalHistory(path, digest, label string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	return repo.LabelLocalHistory(path, digest, label)
}

// ClearStashes drops every stash entry.
func (g *Git) ClearStashes() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.ClearStashes(context.Background())
	if err == nil {
		g.notify()
	}
	return out, err
}

// CreatePatch returns the selected changes as a unified patch.
func (g *Git) CreatePatch(opts git.PatchOptions) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	return repo.CreatePatch(context.Background(), opts)
}

// SavePatch asks for a file and writes the patch there.
func (g *Git) SavePatch(opts git.PatchOptions, name string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	patch, err := repo.CreatePatch(context.Background(), opts)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(patch) == "" {
		return "", errors.New("there are no changes for the patch")
	}
	win := mygo.CallerWindow(context.Background())
	chosen, err := mygo.Dialog.Save(mygo.SaveDialogOptions{
		Parent:      win,
		Title:       g.c.uiLang().tr("dialog.savePatch"),
		DefaultPath: filepath.Join(repo.Dir(), name),
		ButtonLabel: g.c.uiLang().tr("dialog.save"),
		Filters:     []mygo.FileFilter{{Name: "Patch", Extensions: []string{"patch", "diff"}}},
	})
	if err != nil || chosen == "" {
		return "", err
	}
	if err := os.WriteFile(chosen, []byte(patch), 0o644); err != nil {
		return "", err
	}
	return chosen, nil
}

// ApplyPatch applies patch text to the working tree.
func (g *Git) ApplyPatch(patch string, reverse bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.ApplyPatch(context.Background(), patch, reverse, false)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// ApplyPatchFile reads a patch file chosen by the user and applies it.
func (g *Git) ApplyPatchFile(reverse bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	win := mygo.CallerWindow(context.Background())
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:  win,
		Title:   g.c.uiLang().tr("dialog.openPatch"),
		Filters: []mygo.FileFilter{{Name: "Patch", Extensions: []string{"patch", "diff"}}},
	})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	data, err := os.ReadFile(paths[0])
	if err != nil {
		return "", err
	}
	out, err := repo.ApplyPatch(context.Background(), string(data), reverse, false)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// Shelves lists saved shelves.
func (g *Git) Shelves() ([]git.Shelf, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.Shelves(context.Background())
}

// SaveShelf saves and discards the selected changes.
func (g *Git) SaveShelf(name string, opts git.PatchOptions) (git.Shelf, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.Shelf{}, err
	}
	shelf, err := repo.SaveShelf(context.Background(), name, opts)
	if err != nil {
		return git.Shelf{}, err
	}
	g.notify()
	return shelf, nil
}

// ApplyShelf applies a shelf, optionally dropping it.
func (g *Git) ApplyShelf(name string, drop bool) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.ApplyShelf(context.Background(), name, drop)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// ShelfPatch reads one shelf's patch, for the viewer.
func (g *Git) ShelfPatch(name string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	return repo.ShelfPatch(context.Background(), name)
}

// DropShelf removes a shelf.
func (g *Git) DropShelf(name string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.DropShelf(context.Background(), name)
	if err != nil {
		return out, err
	}
	g.notify()
	return out, nil
}

// RenameShelf renames a shelf.
func (g *Git) RenameShelf(name, newName string) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.RenameShelf(context.Background(), name, newName); err != nil {
		return err
	}
	g.notify()
	return nil
}

// Conflict reads the stages of an unmerged path.
func (g *Git) Conflict(path string) (git.ConflictContent, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.ConflictContent{}, err
	}
	return repo.Conflict(context.Background(), path)
}

// MergePreview merges a conflicted path's three stages in memory: the
// working tree is neither read nor written, so the page can show what a
// full three-way merge would be before anything is decided.
func (g *Git) MergePreview(req git.MergePreviewRequest) (git.MergePreview, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.MergePreview{}, err
	}
	return repo.MergePreview(context.Background(), req)
}

// SaveResolution writes the result pane and stages the path when the
// content no longer has conflict markers.
func (g *Git) SaveResolution(path, content string, stage bool) error {
	repo, err := g.c.currentRepo()
	if err != nil {
		return err
	}
	if err := repo.SaveResolution(context.Background(), path, content, stage); err != nil {
		return err
	}
	g.notify()
	return nil
}

// MergeDetails describes the commits both sides of the operation point at.
func (g *Git) MergeDetails() (git.MergeDetails, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.MergeDetails{}, err
	}
	return repo.MergeDetails(context.Background())
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
	started := time.Now()
	out, err := repo.AbortOperation(ctx)
	g.journalOperation(repo, JournalEntry{Action: "abort", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.ContinueOperation(ctx)
	g.journalOperation(repo, JournalEntry{Action: "continue", Commands: *trace, Output: out}, err, started)
	if err != nil {
		return out, err
	}
	g.notify()
	return appendCommands(out, *trace), nil
}

// SkipOperation drops the conflict-blocking commit and continues.
func (g *Git) SkipOperation() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	out, err := repo.SkipOperation(ctx)
	g.journalOperation(repo, JournalEntry{Action: "skip", Commands: *trace, Output: out}, err, started)
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

// LineTexts reads the working-tree lines a usage list wants to preview. It
// answers one entry per readable line, in the order asked.
func (g *Git) LineTexts(refs []git.LineRef) ([]git.LineText, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return []git.LineText{}, err
	}
	return repo.LineTexts(refs), nil
}

// Image reads one version of an image file for the viewer.
func (g *Git) Image(path, revision string) (git.ImageData, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.ImageData{}, err
	}
	return repo.Image(context.Background(), path, revision)
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

// TreeAtRevision lists every file one revision contains.
func (g *Git) TreeAtRevision(revision string) ([]git.RepoFile, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.TreeAtRevision(context.Background(), revision)
}

// Tree lists every file in the working tree, for the source explorer.
func (g *Git) Tree() ([]git.RepoFile, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	files, err := repo.Tree(context.Background())
	if err != nil {
		return nil, err
	}
	if files == nil {
		files = []git.RepoFile{}
	}
	return files, nil
}

// Blame annotates a file at a revision ("" for the working tree, "INDEX" for
// the staged copy).
func (g *Git) Blame(path, revision string, opts git.BlameOptions) (git.BlameResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.BlameResult{}, err
	}
	return repo.Blame(context.Background(), path, revision, opts)
}

// Console runs a command from the Git console and streams its output.
func (g *Git) Console(command string, out *mygo.Channel[string]) (git.ConsoleResult, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.ConsoleResult{}, err
	}
	started := time.Now()
	ctx, cancel := context.WithCancel(context.Background())
	g.c.consoleMu.Lock()
	g.c.consoleGen++
	gen := g.c.consoleGen
	g.c.consoleCancel = cancel
	g.c.consoleMu.Unlock()
	defer func() {
		cancel()
		g.c.consoleMu.Lock()
		if g.c.consoleGen == gen {
			g.c.consoleCancel = nil
		}
		g.c.consoleMu.Unlock()
	}()
	res, err := repo.RunConsole(ctx, command, func(line string) { _ = out.Send(line) })
	g.journalOperation(repo, JournalEntry{
		Action:   "console",
		Source:   "console",
		Command:  command,
		Output:   res.Output,
		ExitCode: res.ExitCode,
	}, err, started)
	g.notify()
	return res, err
}

// CancelConsole stops the console command that is running, if any. It is
// the only way out of a program that waits for input: the console holds
// the write lock while it runs.
func (g *Git) CancelConsole() bool {
	g.c.consoleMu.Lock()
	cancel := g.c.consoleCancel
	g.c.consoleMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel()
	return true
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

// CherryPicked marks the commits that already exist elsewhere by patch.
func (g *Git) CherryPicked(hashes []string) ([]string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	if len(hashes) > 500 {
		hashes = hashes[:500]
	}
	return repo.CherryPicked(context.Background(), hashes)
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
	started := time.Now()
	out, err := preserveLocalChanges(ctx, repo, "rewriting history", func() (string, error) {
		return repo.Rewrite(ctx, onto, steps)
	})
	g.journalOperation(repo, JournalEntry{Action: "rewrite", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.AddWorktree(ctx, path, branch, newBranch)
	g.journalOperation(repo, JournalEntry{Action: "worktree-add", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.RemoveWorktree(ctx, path, force)
	g.journalOperation(repo, JournalEntry{Action: "worktree-remove", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.PruneWorktrees(ctx)
	g.journalOperation(repo, JournalEntry{Action: "worktree-prune", Commands: *trace, Output: out}, err, started)
	return appendCommands(out, *trace), err
}

// ---- stash details ----

// LockWorktree locks a working tree so prune cannot remove it.
func (g *Git) LockWorktree(path, reason string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.LockWorktree(context.Background(), path, reason)
	if err == nil {
		g.notify()
	}
	return out, err
}

// UnlockWorktree unlocks a working tree.
func (g *Git) UnlockWorktree(path string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.UnlockWorktree(context.Background(), path)
	if err == nil {
		g.notify()
	}
	return out, err
}

// AddSubmodule registers a submodule.
func (g *Git) AddSubmodule(url, path, branch string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.AddSubmodule(context.Background(), url, path, branch)
	if err == nil {
		g.notify()
	}
	return out, err
}

// SyncSubmodules copies .gitmodules into the config.
func (g *Git) SyncSubmodules() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.SyncSubmodules(context.Background())
	if err == nil {
		g.notify()
	}
	return out, err
}

// LFSTrack stores files matching the patterns in Git LFS.
func (g *Git) LFSTrack(patterns []string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.LFSTrack(context.Background(), patterns)
	if err == nil {
		g.notify()
	}
	return out, err
}

// LFSUntrack stops tracking files matching the patterns.
func (g *Git) LFSUntrack(patterns []string) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	out, err := repo.LFSUntrack(context.Background(), patterns)
	if err == nil {
		g.notify()
	}
	return out, err
}

// LFSPull downloads LFS objects.
func (g *Git) LFSPull(out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	return repo.LFSPull(context.Background(), func(line string) { _ = out.Send(line) })
}

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
	started := time.Now()
	out, err := repo.StashToBranch(ctx, index, branch)
	g.journalOperation(repo, JournalEntry{Action: "stash-branch", Commands: *trace, Output: out}, err, started)
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
	started := time.Now()
	out, err := repo.UpdateSubmodules(ctx, init)
	g.journalOperation(repo, JournalEntry{Action: "submodules", Commands: *trace, Output: out}, err, started)
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

// Hooks lists the hooks git would run for this repository, so a commit that
// is rejected or rewritten by one is not a mystery.
func (g *Git) Hooks() ([]git.Hook, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return nil, err
	}
	return repo.Hooks(context.Background())
}

// Unshallow fetches the full history of a shallow clone.
func (g *Git) Unshallow(out *mygo.Channel[string]) (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	ctx, trace := git.WithCommandTrace(context.Background())
	started := time.Now()
	text, err := repo.Unshallow(ctx, func(line string) { _ = out.Send(line) })
	g.journalOperation(repo, JournalEntry{Action: "unshallow", Commands: *trace, Output: text}, err, started)
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
//
// The stash is found by its message instead of assuming stash@{0}: another
// stash can appear between the push and the pop, and popping the wrong one
// loses the wrong work. When the operation stops with conflicts or leaves
// a sequencer in progress, the stash is deliberately kept: git cannot pop
// into an unmerged index, and popping later onto the resolved tree is the
// user's call.
func preserveLocalChanges(ctx context.Context, repo *git.Repo, label string, fn func() (string, error)) (string, error) {
	st, err := repo.Status(ctx, false)
	if err != nil || len(st.Changes) == 0 {
		return fn()
	}
	if st.State.Unborn {
		// There is no commit to stash against yet. Git's own checks still
		// refuse a switch that would overwrite work, so the operation runs
		// rather than being rejected by the stash step.
		return fn()
	}
	message := "gitjet: before " + label
	if _, err := repo.StashPush(ctx, git.StashOptions{Message: message, IncludeUntracked: true}); err != nil {
		return "", fmt.Errorf("your local changes could not be saved before %s: %w", label, err)
	}
	out, opErr := fn()
	index, found := findStash(ctx, repo, message)
	if !found {
		kept := "your local changes are no longer in the stash: the entry saved before " + label + " was not found"
		if opErr != nil {
			return appendNote(out, kept), fmt.Errorf("%v; %s", opErr, kept)
		}
		return appendNote(out, kept), errors.New(kept)
	}
	if after, serr := repo.Status(ctx, false); serr == nil && (after.State.Operation != "" || hasUnmerged(after.Changes)) {
		kept := fmt.Sprintf("your local changes are kept in stash@{%d} until %s finishes", index, after.State.Operation)
		if opErr != nil {
			return appendNote(out, kept), opErr
		}
		return appendNote(out, kept), nil
	}
	if _, popErr := repo.StashRestore(ctx, index); popErr != nil {
		kept := fmt.Sprintf("your local changes could not be restored and are in stash@{%d}: %v", index, popErr)
		if opErr != nil {
			return appendNote(out, kept), fmt.Errorf("%v; %s", opErr, kept)
		}
		return appendNote(out, kept), errors.New(kept)
	}
	if opErr != nil {
		return out, opErr
	}
	return appendNote(out, "local changes were stashed before "+label+" and restored after it"), nil
}

// hasUnmerged reports a stopped operation's conflicting paths.
func hasUnmerged(changes []git.Change) bool {
	for _, c := range changes {
		if c.Unmerged {
			return true
		}
	}
	return false
}

// findStash locates the entry preserveLocalChanges pushed, newest first, so
// a stash created in between is never popped in its place.
func findStash(ctx context.Context, repo *git.Repo, message string) (int, bool) {
	stashes, err := repo.Stashes(ctx)
	if err != nil {
		return 0, false
	}
	for _, s := range stashes {
		if strings.Contains(s.Message, message) {
			return s.Index, true
		}
	}
	return 0, false
}
