package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Worktree is one working tree of the repository: the main one, or one of
// the extra checkouts git worktree creates.
type Worktree struct {
	Path     string `json:"path"`
	Head     string `json:"head"`
	Short    string `json:"short"`
	Branch   string `json:"branch"`
	Detached bool   `json:"detached"`
	Bare     bool   `json:"bare"`
	Locked   bool   `json:"locked"`
	Prunable bool   `json:"prunable"`
	Main     bool   `json:"main"`
}

// Worktrees lists every working tree of the repository, main tree first.
func (r *Repo) Worktrees(ctx context.Context) ([]Worktree, error) {
	out, err := r.run(ctx, "worktree", "list", "--porcelain")
	if err != nil {
		return []Worktree{}, err
	}
	trees := []Worktree{}
	var cur Worktree
	flush := func() {
		if cur.Path != "" {
			cur.Short = short(cur.Head)
			cur.Main = len(trees) == 0 && samePath(cur.Path, r.dir)
			trees = append(trees, cur)
		}
		cur = Worktree{}
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}
		key, value, _ := strings.Cut(line, " ")
		switch key {
		case "worktree":
			cur.Path = value
		case "HEAD":
			cur.Head = value
		case "branch":
			cur.Branch = strings.TrimPrefix(value, "refs/heads/")
		case "detached":
			cur.Detached = true
		case "bare":
			cur.Bare = true
		case "locked":
			cur.Locked = true
		case "prunable":
			cur.Prunable = true
		}
	}
	flush()
	return trees, nil
}

// samePath reports whether two paths name the same folder. git resolves
// symlinks (macOS /var is /private/var), so string equality is not enough.
func samePath(a, b string) bool {
	if filepath.Clean(a) == filepath.Clean(b) {
		return true
	}
	sa, err := os.Stat(a)
	if err != nil {
		return false
	}
	sb, err := os.Stat(b)
	if err != nil {
		return false
	}
	return os.SameFile(sa, sb)
}

// AddWorktree checks a commit out in a new working tree. When newBranch is
// set, branch names a new branch created for that tree.
func (r *Repo) AddWorktree(ctx context.Context, path, branch string, newBranch bool) (string, error) {
	path = strings.TrimSpace(path)
	branch = strings.TrimSpace(branch)
	if path == "" || strings.HasPrefix(path, "-") || !filepath.IsAbs(path) {
		return "", errors.New("a worktree needs an absolute folder path")
	}
	if _, err := os.Stat(path); err == nil {
		return "", errors.New("that folder already exists")
	}
	args := []string{"worktree", "add"}
	if newBranch {
		if branch == "" || strings.HasPrefix(branch, "-") {
			return "", errors.New("the new branch needs a name")
		}
		if _, err := r.run(ctx, "check-ref-format", "--branch", branch); err != nil {
			return "", fmt.Errorf("%q is not a valid branch name", branch)
		}
		args = append(args, "-b", branch)
	}
	args = append(args, path)
	if branch != "" && !newBranch {
		args = append(args, branch)
	}
	return r.writeRun(ctx, args...)
}

// RemoveWorktree deletes a working tree. Uncommitted changes stop it unless
// force is set.
func (r *Repo) RemoveWorktree(ctx context.Context, path string, force bool) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" || strings.HasPrefix(path, "-") || !filepath.IsAbs(path) {
		return "", errors.New("invalid worktree path")
	}
	if filepath.Clean(path) == filepath.Clean(r.dir) {
		return "", errors.New("the repository's own working tree cannot be removed")
	}
	args := []string{"worktree", "remove"}
	if force {
		args = append(args, "--force")
	}
	args = append(args, path)
	return r.writeRun(ctx, args...)
}

// PruneWorktrees forgets working trees whose folder is gone.
func (r *Repo) PruneWorktrees(ctx context.Context) (string, error) {
	return r.writeRun(ctx, "worktree", "prune", "-v")
}

// BranchInfo is a local branch that a cleanup would delete.
type BranchInfo struct {
	Name     string `json:"name"`
	Hash     string `json:"hash"`
	Upstream string `json:"upstream"`
	Subject  string `json:"subject"`
	Time     int64  `json:"time"`
}

// BranchCleanup lists the local branches a cleanup can delete: branches
// already merged into HEAD, and branches whose upstream is gone.
type BranchCleanup struct {
	Merged []BranchInfo `json:"merged"`
	Gone   []BranchInfo `json:"gone"`
}

// CleanupCandidates reports which local branches are safe to delete.
func (r *Repo) CleanupCandidates(ctx context.Context) (BranchCleanup, error) {
	cleanup := BranchCleanup{Merged: []BranchInfo{}, Gone: []BranchInfo{}}
	head, err := r.run(ctx, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return cleanup, err
	}
	current := strings.TrimSpace(head)
	all, err := r.branchList(ctx)
	if err != nil {
		return cleanup, err
	}
	mergedOut, _ := r.run(ctx, "branch", "--merged", "HEAD", "--format=%(refname:short)")
	mergedNames := map[string]bool{}
	for _, line := range strings.Split(mergedOut, "\n") {
		name := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "*"))
		if name != "" {
			mergedNames[name] = true
		}
	}
	for _, b := range all {
		if b.Name == current {
			continue
		}
		if mergedNames[b.Name] {
			cleanup.Merged = append(cleanup.Merged, b.BranchInfo)
			continue
		}
		if b.upstreamGone {
			cleanup.Gone = append(cleanup.Gone, b.BranchInfo)
		}
	}
	return cleanup, nil
}

// branchEntry carries the extra track column branchList parses for the
// cleanup dialog.
type branchEntry struct {
	BranchInfo
	upstreamGone bool
}

// branchList reads every local branch with its upstream tracking state.
func (r *Repo) branchList(ctx context.Context) ([]branchEntry, error) {
	const sep = "%00"
	const track = "%(upstream:track)"
	format := "--format=" + strings.Join([]string{
		"%(refname:short)", "%(objectname:short)", "%(upstream:short)", "%(committerdate:unix)", "%(contents:subject)", track,
	}, sep)
	out, err := r.run(ctx, "branch", format)
	if err != nil {
		return nil, err
	}
	entries := []branchEntry{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "*"))
		if line == "" {
			continue
		}
		f := strings.Split(line, "\x00")
		if len(f) < 6 {
			continue
		}
		entries = append(entries, branchEntry{
			BranchInfo: BranchInfo{
				Name: f[0], Hash: f[1], Upstream: f[2], Time: parseInt64(f[3]), Subject: f[4],
			},
			upstreamGone: strings.Contains(f[5], "gone"),
		})
	}
	return entries, nil
}

// StashFile is one path inside a stash entry.
type StashFile struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath,omitempty"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Binary    bool   `json:"binary"`
}

// StashFiles lists the paths a stash entry touches, with line counts.
func (r *Repo) StashFiles(ctx context.Context, index int) ([]StashFile, error) {
	if index < 0 {
		return nil, errors.New("invalid stash")
	}
	ref := "stash@{" + strconv.Itoa(index) + "}"
	out, err := r.run(ctx, "stash", "show", "-u", "--numstat", "--format=", ref)
	if err != nil {
		return []StashFile{}, err
	}
	files := []StashFile{}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.SplitN(line, "\t", 3)
		if len(f) < 3 {
			continue
		}
		file := StashFile{Path: f[2], Additions: atoi(f[0]), Deletions: atoi(f[1])}
		file.Binary = f[0] == "-" || f[1] == "-"
		// A rename prints "old => new" or "dir/{old => new}".
		if strings.Contains(f[2], "=>") {
			file.OldPath, file.Path = splitRename(f[2])
		}
		files = append(files, file)
	}
	return files, nil
}

// splitRename splits git's compact rename path into its two sides.
func splitRename(path string) (oldPath, newPath string) {
	if open := strings.Index(path, "{"); open >= 0 {
		if closeIdx := strings.Index(path[open:], "}"); closeIdx >= 0 {
			closeIdx += open
			inner := path[open+1 : closeIdx]
			from, to, ok := strings.Cut(inner, " => ")
			if !ok {
				return "", path
			}
			prefix := path[:open]
			suffix := path[closeIdx+1:]
			return prefix + strings.TrimSpace(from) + suffix, prefix + strings.TrimSpace(to) + suffix
		}
	}
	from, to, ok := strings.Cut(path, " => ")
	if !ok {
		return "", path
	}
	return from, to
}

// StashToBranch restores a stash on a new branch cut from the commit the
// stash was made on, then drops the entry. This is how a stash that no
// longer applies cleanly gets rescued.
func (r *Repo) StashToBranch(ctx context.Context, index int, branch string) (string, error) {
	branch = strings.TrimSpace(branch)
	if index < 0 {
		return "", errors.New("invalid stash")
	}
	if branch == "" || strings.HasPrefix(branch, "-") {
		return "", errors.New("the branch needs a name")
	}
	if _, err := r.run(ctx, "check-ref-format", "--branch", branch); err != nil {
		return "", fmt.Errorf("%q is not a valid branch name", branch)
	}
	return r.writeRun(ctx, "stash", "branch", branch, "stash@{"+strconv.Itoa(index)+"}")
}

// Submodule is one entry of .gitmodules as git reports it.
type Submodule struct {
	Path     string `json:"path"`
	Hash     string `json:"hash"`
	Short    string `json:"short"`
	URL      string `json:"url"`
	Branch   string `json:"branch"`
	Describe string `json:"describe"`
	State    string `json:"state"` // clean, uninitialized, modified, conflict
}

// Submodules lists the repository's submodules.
func (r *Repo) Submodules(ctx context.Context) ([]Submodule, error) {
	out, err := r.run(ctx, "submodule", "status")
	if err != nil {
		return []Submodule{}, nil
	}
	type submoduleConfig struct{ path, url, branch string }
	byName := map[string]*submoduleConfig{}
	if cfg, err := r.run(ctx, "config", "--file", ".gitmodules", "--get-regexp", `^submodule\..*\.(path|url|branch)$`); err == nil {
		for _, line := range strings.Split(cfg, "\n") {
			key, value, ok := strings.Cut(line, " ")
			if !ok {
				continue
			}
			parts := strings.Split(key, ".")
			if len(parts) < 3 {
				continue
			}
			name := strings.Join(parts[1:len(parts)-1], ".")
			c := byName[name]
			if c == nil {
				c = &submoduleConfig{}
				byName[name] = c
			}
			switch parts[len(parts)-1] {
			case "path":
				c.path = value
			case "url":
				c.url = value
			case "branch":
				c.branch = value
			}
		}
	}
	byPath := map[string]submoduleConfig{}
	for _, c := range byName {
		if c.path != "" {
			byPath[c.path] = *c
		}
	}
	subs := []Submodule{}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		state := "clean"
		switch line[0] {
		case '-':
			state = "uninitialized"
		case '+':
			state = "modified"
		case 'U':
			state = "conflict"
		}
		rest := strings.TrimLeft(line, "-+U ")
		fields := strings.Fields(rest)
		s := Submodule{State: state}
		if len(fields) >= 2 {
			s.Hash = fields[0]
			s.Short = short(fields[0])
			s.Path = fields[1]
		}
		if len(fields) > 2 {
			s.Describe = strings.Trim(fields[2], "()")
		}
		if c, ok := byPath[s.Path]; ok {
			s.URL = c.url
			s.Branch = c.branch
		}
		subs = append(subs, s)
	}
	return subs, nil
}

// UpdateSubmodules checks the submodules out at the recorded commits.
func (r *Repo) UpdateSubmodules(ctx context.Context, init bool) (string, error) {
	args := []string{"submodule", "update", "--recursive"}
	if init {
		args = append(args, "--init")
	}
	return r.writeRun(ctx, args...)
}

// LFSFile is one file stored in Git LFS.
type LFSFile struct {
	Path string `json:"path"`
	Oid  string `json:"oid"`
}

// LFSStatus reports whether Git LFS is installed and which files it tracks.
type LFSStatus struct {
	Installed bool      `json:"installed"`
	Version   string    `json:"version"`
	Files     []LFSFile `json:"files"`
}

// LFS reports the repository's Git LFS state.
func (r *Repo) LFS(ctx context.Context) LFSStatus {
	status := LFSStatus{Files: []LFSFile{}}
	out, err := r.run(ctx, "lfs", "version")
	if err != nil {
		return status
	}
	status.Installed = true
	if fields := strings.Fields(out); len(fields) > 2 {
		status.Version = strings.TrimSuffix(fields[2], "/")
	}
	if out, err := r.run(ctx, "lfs", "ls-files", "-l"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(line)
			if len(f) >= 3 {
				status.Files = append(status.Files, LFSFile{Path: f[len(f)-1], Oid: f[0]})
			}
		}
	}
	return status
}

// IsShallow reports whether the clone has truncated history.
func (r *Repo) IsShallow(ctx context.Context) bool { return r.isShallow(ctx) }

// Unshallow fetches the full history of a shallow clone.
func (r *Repo) Unshallow(ctx context.Context, emit func(string)) (string, error) {
	if !r.isShallow(ctx) {
		return "", errors.New("this repository already has its full history")
	}
	args := []string{"fetch", "--unshallow", "--progress"}
	if remotes, err := r.Remotes(ctx); err == nil && len(remotes) > 0 {
		// A shallow clone of one branch needs that branch's remote; passing
		// it explicitly is what unshallows a mirror-like clone too.
		args = append(args, remotes[0].Name)
	}
	return r.stream(ctx, emit, args...)
}

// CompareRefs lists the paths that differ between two revisions, as the
// compare dialog shows them.
func (r *Repo) CompareRefs(ctx context.Context, from, to string) ([]Change, error) {
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if from == "" || to == "" || strings.HasPrefix(from, "-") || strings.HasPrefix(to, "-") {
		return []Change{}, errors.New("choose two revisions")
	}
	out, err := r.run(ctx, "diff", "--name-status", "-z", from, to)
	if err != nil {
		return nil, err
	}
	fields := strings.Split(out, "\x00")
	changes := []Change{}
	for i := 0; i < len(fields); i++ {
		status := strings.TrimSpace(fields[i])
		if status == "" || i+1 >= len(fields) {
			continue
		}
		path := fields[i+1]
		i++
		change := Change{Path: path, Kind: diffKind(status)}
		if strings.HasPrefix(status, "R") || strings.HasPrefix(status, "C") {
			if i+1 < len(fields) {
				change.OldPath = path
				change.Path = fields[i+1]
				i++
			}
		}
		changes = append(changes, change)
	}
	return changes, nil
}

func diffKind(status string) string {
	switch status[0] {
	case 'A':
		return "added"
	case 'D':
		return "deleted"
	case 'R':
		return "renamed"
	case 'C':
		return "copied"
	case 'T':
		return "typechange"
	default:
		return "modified"
	}
}
