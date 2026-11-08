package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
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
	out, err := r.writeRun(ctx, args...)
	if err == nil {
		// .worktreeinclude lists the folders a new worktree copies from
		// this one, which is how an IDE keeps its per-project settings.
		copyWorktreeIncludes(r.dir, path)
	}
	return out, err
}

// copyWorktreeIncludes copies the paths named in .worktreeinclude into a
// new working tree, best effort: a missing source or a read-only target
// leaves the worktree usable.
func copyWorktreeIncludes(from, to string) {
	data, err := os.ReadFile(filepath.Join(from, ".worktreeinclude"))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		rel := strings.TrimSpace(line)
		if rel == "" || strings.HasPrefix(rel, "#") {
			continue
		}
		rel = filepath.Clean(rel)
		if filepath.IsAbs(rel) || rel == "." || strings.HasPrefix(rel, "..") {
			continue
		}
		src := filepath.Join(from, rel)
		dst := filepath.Join(to, rel)
		if _, err := os.Stat(dst); err == nil {
			continue
		}
		budget := worktreeCopyBudget
		_ = copyTree(src, dst, &budget)
	}
}

// worktreeCopyBudget bounds one .worktreeinclude entry. Copying follows
// no link and no directory twice, but a listed folder can still hold a
// whole toolchain, and this runs inside a call the page is waiting for.
const worktreeCopyBudget = 20000

func copyTree(src, dst string, budget *int) error {
	if *budget <= 0 {
		return nil
	}
	*budget--
	// Lstat, not Stat: a link is copied as a link. Following it can copy a
	// whole disk, and following a link to an ancestor never ends.
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.Symlink(target, dst)
	case !info.IsDir():
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		return os.WriteFile(dst, data, info.Mode().Perm())
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dst, info.Mode().Perm()); err != nil {
		return err
	}
	for _, entry := range entries {
		if err := copyTree(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name()), budget); err != nil {
			return err
		}
	}
	return nil
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

// LockWorktree marks a working tree as not removable, with a reason that
// `git worktree list` shows. It is how a worktree on a removable disk is
// protected from prune.
func (r *Repo) LockWorktree(ctx context.Context, path, reason string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" || strings.HasPrefix(path, "-") || !filepath.IsAbs(path) {
		return "", errors.New("invalid worktree path")
	}
	args := []string{"worktree", "lock"}
	if reason = strings.TrimSpace(reason); reason != "" {
		if strings.ContainsAny(reason, "\n\r") {
			return "", errors.New("the reason cannot contain a line break")
		}
		args = append(args, "--reason", reason)
	}
	args = append(args, path)
	return r.writeRun(ctx, args...)
}

// UnlockWorktree makes a locked working tree removable again.
func (r *Repo) UnlockWorktree(ctx context.Context, path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" || strings.HasPrefix(path, "-") || !filepath.IsAbs(path) {
		return "", errors.New("invalid worktree path")
	}
	return r.writeRun(ctx, "worktree", "unlock", path)
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
	// -z keeps git from C-quoting paths: a stash of "dir with space/é.txt"
	// arrives as the name it is, not as "dir with space/\303\251.txt".
	out, err := r.run(ctx, "stash", "show", "-u", "--numstat", "-z", "--format=", ref)
	if err != nil {
		return []StashFile{}, err
	}
	records := strings.Split(out, "\x00")
	files := []StashFile{}
	for i := 0; i < len(records); i++ {
		record := strings.TrimPrefix(records[i], "\n")
		if strings.TrimSpace(record) == "" {
			continue
		}
		f := strings.SplitN(record, "\t", 3)
		if len(f) < 3 {
			continue
		}
		file := StashFile{Path: f[2], Additions: atoi(f[0]), Deletions: atoi(f[1])}
		file.Binary = f[0] == "-" || f[1] == "-"
		if file.Path == "" && i+2 < len(records) {
			// With -z a rename names its two sides as separate records.
			file.OldPath = records[i+1]
			file.Path = records[i+2]
			i += 2
		}
		files = append(files, file)
	}
	return files, nil
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
		s := Submodule{State: state}
		// "<hash> <path> (<describe>)": the path may contain spaces, so it
		// runs to the describe suffix rather than to the next field.
		if hash, tail, ok := strings.Cut(rest, " "); ok {
			s.Hash = hash
			s.Short = short(hash)
			s.Path = tail
			if i := strings.LastIndex(tail, " ("); i >= 0 && strings.HasSuffix(tail, ")") {
				s.Path = tail[:i]
				s.Describe = tail[i+2 : len(tail)-1]
			}
		}
		if c, ok := byPath[s.Path]; ok {
			s.URL = c.url
			s.Branch = c.branch
		}
		subs = append(subs, s)
	}
	return subs, nil
}

// AddSubmodule registers a submodule at path, optionally following branch.
func (r *Repo) AddSubmodule(ctx context.Context, url, path, branch string) (string, error) {
	url = strings.TrimSpace(url)
	path = strings.TrimSpace(path)
	branch = strings.TrimSpace(branch)
	if url == "" || strings.HasPrefix(url, "-") {
		return "", errors.New("a submodule needs a URL")
	}
	if path == "" || filepath.IsAbs(path) {
		return "", errors.New("a submodule needs a repository-relative path")
	}
	clean, err := cleanPath(path)
	if err != nil {
		return "", err
	}
	args := []string{"submodule", "add"}
	if branch != "" {
		if strings.HasPrefix(branch, "-") {
			return "", errors.New("invalid branch")
		}
		args = append(args, "-b", branch)
	}
	args = append(args, "--", url, clean)
	return r.writeRun(ctx, args...)
}

// SyncSubmodules copies the URLs from .gitmodules into the config, which is
// what changes when a submodule moves to another host.
func (r *Repo) SyncSubmodules(ctx context.Context) (string, error) {
	return r.writeRun(ctx, "submodule", "sync", "--recursive")
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
	// "git-lfs/3.5.1 (GitHub.com; darwin arm64; go 1.21)" — the version is
	// the part after the slash of the first word, not the third word.
	if fields := strings.Fields(out); len(fields) > 0 {
		status.Version = strings.TrimPrefix(strings.TrimSuffix(fields[0], "/"), "git-lfs/")
	}
	if out, err := r.run(ctx, "lfs", "ls-files", "-l"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			// "<oid> <*|-> <path>": the path may contain spaces.
			oid, rest, ok := strings.Cut(strings.TrimSpace(line), " ")
			if !ok {
				continue
			}
			_, path, ok := strings.Cut(strings.TrimSpace(rest), " ")
			if !ok || path == "" {
				continue
			}
			status.Files = append(status.Files, LFSFile{Path: path, Oid: oid})
		}
	}
	return status
}

// LFSTrack tells Git LFS to store files matching the patterns.
func (r *Repo) LFSTrack(ctx context.Context, patterns []string) (string, error) {
	args, err := lfsPatternArgs("track", patterns)
	if err != nil {
		return "", err
	}
	return r.writeRun(ctx, args...)
}

// LFSUntrack stops tracking files matching the patterns.
func (r *Repo) LFSUntrack(ctx context.Context, patterns []string) (string, error) {
	args, err := lfsPatternArgs("untrack", patterns)
	if err != nil {
		return "", err
	}
	return r.writeRun(ctx, args...)
}

func lfsPatternArgs(verb string, patterns []string) ([]string, error) {
	clean := make([]string, 0, len(patterns))
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" || strings.HasPrefix(pattern, "-") {
			continue
		}
		clean = append(clean, pattern)
	}
	if len(clean) == 0 {
		return nil, errors.New("a pattern is required")
	}
	return append([]string{"lfs", verb}, clean...), nil
}

// LFSPull downloads the LFS objects the checkout refers to.
func (r *Repo) LFSPull(ctx context.Context, emit func(string)) (string, error) {
	return r.stream(ctx, emit, "lfs", "pull")
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

// Hook is one executable in the repository's hooks directory.
type Hook struct {
	Name string `json:"name"`
	Path string `json:"path"`
	// Executable is false for a hook git would refuse to run.
	Executable bool `json:"executable"`
	// Sample marks the ".sample" files git ships, which do not run.
	Sample bool `json:"sample"`
}

// Hooks lists the hooks this repository would actually run. Git keeps them
// outside the working tree, so a hook that reformats or rejects a commit is
// invisible in the app unless it is named here.
func (r *Repo) Hooks(ctx context.Context) ([]Hook, error) {
	dir := ""
	if out, err := r.run(ctx, "config", "--get", "core.hooksPath"); err == nil {
		dir = strings.TrimSpace(out)
	}
	if dir == "" {
		dir = filepath.Join(r.gitDir, "hooks")
	} else if !filepath.IsAbs(dir) {
		dir = filepath.Join(r.dir, dir)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Hook{}, nil
		}
		return nil, err
	}
	hooks := []Hook{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		name := entry.Name()
		// Git runs a hook only under its plain name: a ".sample" file is a
		// template even when the template directory made it executable.
		sample := strings.HasSuffix(name, ".sample")
		if sample {
			// The sample keeps its full name: it is the file the reader
			// has to rename, and two rows must not claim the same name.
			hooks = append(hooks, Hook{Name: name, Path: filepath.Join(dir, name), Executable: false, Sample: true})
			continue
		}
		hooks = append(hooks, Hook{
			Name:       name,
			Path:       filepath.Join(dir, entry.Name()),
			Executable: info.Mode().Perm()&0o111 != 0,
			Sample:     sample,
		})
	}
	sort.Slice(hooks, func(i, j int) bool {
		if hooks[i].Sample != hooks[j].Sample {
			return !hooks[i].Sample
		}
		return hooks[i].Name < hooks[j].Name
	})
	return hooks, nil
}
