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

// CommitOptions is what the commit dialog selected.
type CommitOptions struct {
	Message     string   `json:"message"`
	Paths       []string `json:"paths"`
	Amend       bool     `json:"amend"`
	SignOff     bool     `json:"signOff"`
	NoVerify    bool     `json:"noVerify"`
	AuthorName  string   `json:"authorName"`
	AuthorEmail string   `json:"authorEmail"`
}

// CommitResult describes the commit that was created.
type CommitResult struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	Output  string `json:"output"`
}

// PushOptions selects a remote, branch and how to push.
type PushOptions struct {
	Remote         string `json:"remote"`
	Branch         string `json:"branch"`
	SetUpstream    bool   `json:"setUpstream"`
	ForceWithLease bool   `json:"forceWithLease"`
	Tags           bool   `json:"tags"`
	DryRun         bool   `json:"dryRun"`
}

// PullOptions selects how to integrate the upstream.
type PullOptions struct {
	Remote    string `json:"remote"`
	Branch    string `json:"branch"`
	Rebase    bool   `json:"rebase"`
	Autostash bool   `json:"autostash"`
	Prune     bool   `json:"prune"`
	Tags      bool   `json:"tags"`
}

// FetchOptions selects what to fetch.
type FetchOptions struct {
	All    bool   `json:"all"`
	Remote string `json:"remote"`
	Prune  bool   `json:"prune"`
	Tags   bool   `json:"tags"`
}

// MergeOptions selects how to merge.
type MergeOptions struct {
	NoFF    bool   `json:"noFF"`
	Squash  bool   `json:"squash"`
	Message string `json:"message"`
}

// StashOptions selects what to stash.
type StashOptions struct {
	Message          string   `json:"message"`
	IncludeUntracked bool     `json:"includeUntracked"`
	KeepIndex        bool     `json:"keepIndex"`
	Paths            []string `json:"paths"`
}

// TagOptions describes a tag to create.
type TagOptions struct {
	Name     string `json:"name"`
	Message  string `json:"message"`
	Revision string `json:"revision"`
	Force    bool   `json:"force"`
}

// Stage adds paths to the index. Deletions are staged too.
func (r *Repo) Stage(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	args := append([]string{"add", "-A", "--"}, clean...)
	_, err = r.writeRun(ctx, args...)
	return err
}

// Unstage removes paths from the index, leaving the working tree alone.
func (r *Repo) Unstage(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	args := append([]string{"reset", "-q", "--"}, clean...)
	_, err = r.writeRun(ctx, args...)
	return err
}

// Rollback discards local changes to paths: the index entry goes back to
// HEAD and the working tree file is restored. Files that HEAD does not
// have are removed. This is the destructive action behind "Rollback" in
// the commit tool window, so the caller must confirm it.
func (r *Repo) Rollback(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	r.write.Lock()
	defer r.write.Unlock()
	// Remember renames: the old path is what HEAD has.
	status, _ := r.Status(ctx, false)
	oldPaths := map[string]string{}
	for _, c := range status.Changes {
		if c.OldPath != "" {
			oldPaths[c.Path] = c.OldPath
		}
	}
	for _, p := range clean {
		_, _ = r.run(ctx, "reset", "-q", "--", p)
		restore := p
		if o := oldPaths[p]; o != "" && o != p {
			restore = o
			if _, err := r.run(ctx, "checkout", "HEAD", "--", p); err == nil {
				_ = os.Remove(r.AbsPath(p))
			}
		}
		if _, err := r.run(ctx, "checkout", "HEAD", "--", restore); err != nil {
			// Not in HEAD: an added file, which rollback deletes.
			if err := os.RemoveAll(r.AbsPath(p)); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

// DeleteUntracked removes untracked files or directories from disk.
func (r *Repo) DeleteUntracked(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	args := append([]string{"clean", "-f", "-d", "--"}, clean...)
	_, err = r.writeRun(ctx, args...)
	return err
}

// Commit stages the selected paths, unstages the selected staged paths
// that were left out, and commits the index.
func (r *Repo) Commit(ctx context.Context, opts CommitOptions) (CommitResult, error) {
	if strings.TrimSpace(opts.Message) == "" && !opts.Amend {
		return CommitResult{}, errors.New("a commit needs a message")
	}
	if opts.AuthorName != "" || opts.AuthorEmail != "" {
		if strings.ContainsAny(opts.AuthorName+opts.AuthorEmail, "<>\n") {
			return CommitResult{}, errors.New("the author name or email contains characters git does not allow")
		}
	}
	r.write.Lock()
	defer r.write.Unlock()
	if len(opts.Paths) > 0 {
		clean, err := cleanPaths(opts.Paths)
		if err != nil {
			return CommitResult{}, err
		}
		selected := map[string]bool{}
		for _, p := range clean {
			selected[p] = true
		}
		// Unstage what is checked out of the selection, so that commit
		// contains exactly what the user checked.
		for _, c := range r.stagedPaths(ctx) {
			if !selected[c] {
				if _, err := r.run(ctx, "reset", "-q", "--", c); err != nil {
					return CommitResult{}, err
				}
			}
		}
		args := append([]string{"add", "-A", "--"}, clean...)
		if _, err := r.run(ctx, args...); err != nil {
			return CommitResult{}, err
		}
	}
	args := []string{"commit"}
	if opts.Amend {
		args = append(args, "--amend")
		if strings.TrimSpace(opts.Message) == "" {
			args = append(args, "--no-edit")
		}
	}
	if opts.SignOff {
		args = append(args, "--signoff")
	}
	if opts.NoVerify {
		args = append(args, "--no-verify")
	}
	if opts.AuthorName != "" || opts.AuthorEmail != "" {
		name := opts.AuthorName
		if name == "" {
			name = "GitJet"
		}
		args = append(args, "--author="+name+" <"+opts.AuthorEmail+">")
	}
	if msg := strings.TrimSpace(opts.Message); msg != "" {
		args = append(args, "-m", msg)
	}
	out, err := r.run(ctx, args...)
	if err != nil {
		return CommitResult{}, err
	}
	res := CommitResult{Output: out}
	if hash, err := r.run(ctx, "rev-parse", "HEAD"); err == nil {
		res.Hash = strings.TrimSpace(hash)
		res.Short = short(res.Hash)
	}
	if subject, err := r.run(ctx, "log", "-1", "--format=%s"); err == nil {
		res.Subject = strings.TrimSpace(subject)
	}
	return res, nil
}

// stagedPaths returns the paths with index changes.
func (r *Repo) stagedPaths(ctx context.Context) []string {
	out, err := r.run(ctx, "diff", "--cached", "--name-only", "-z", "--no-color")
	if err != nil {
		return nil
	}
	var paths []string
	for _, p := range strings.Split(out, "\x00") {
		if p != "" {
			paths = append(paths, p)
		}
	}
	return paths
}

// LastCommitMessage returns HEAD's full message, for the amend dialog.
func (r *Repo) LastCommitMessage(ctx context.Context) (string, error) {
	out, err := r.run(ctx, "log", "-1", "--format=%B")
	return strings.TrimRight(out, "\n"), err
}

// Checkout switches to a branch, tagging a remote branch with a local
// tracking branch, or detaches at a tag or commit.
func (r *Repo) Checkout(ctx context.Context, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "-") {
		return "", errors.New("invalid branch")
	}
	r.write.Lock()
	defer r.write.Unlock()
	if r.hasRef(ctx, "refs/heads/"+ref) {
		return r.run(ctx, "switch", ref)
	}
	if r.hasRef(ctx, "refs/tags/"+ref) {
		return r.run(ctx, "switch", "--detach", ref)
	}
	for _, remote := range r.remoteNames(ctx) {
		if strings.HasPrefix(ref, remote+"/") {
			local := strings.TrimPrefix(ref, remote+"/")
			if local == "HEAD" {
				return "", errors.New("cannot check out a remote HEAD")
			}
			if r.hasRef(ctx, "refs/heads/"+local) {
				return r.run(ctx, "switch", local)
			}
			return r.run(ctx, "switch", "-c", local, "--track", ref)
		}
	}
	return r.run(ctx, "switch", "--detach", ref)
}

func (r *Repo) hasRef(ctx context.Context, full string) bool {
	_, err := r.run(ctx, "show-ref", "--verify", "--quiet", full)
	return err == nil
}

func (r *Repo) remoteNames(ctx context.Context) []string {
	out, err := r.run(ctx, "remote")
	if err != nil {
		return nil
	}
	return strings.Fields(out)
}

// CreateBranch creates a branch at start (HEAD when empty) and checks it
// out when checkout is true.
func (r *Repo) CreateBranch(ctx context.Context, name, start string, checkout bool) error {
	name = strings.TrimSpace(name)
	start = strings.TrimSpace(start)
	if name == "" || strings.HasPrefix(name, "-") {
		return errors.New("a branch needs a name")
	}
	if _, err := r.run(ctx, "check-ref-format", "--branch", name); err != nil {
		return fmt.Errorf("%q is not a valid branch name", name)
	}
	args := []string{}
	if checkout {
		args = append(args, "switch", "-c", name)
	} else {
		args = append(args, "branch", name)
	}
	if start != "" {
		args = append(args, start)
	}
	_, err := r.writeRun(ctx, args...)
	return err
}

// DeleteBranch deletes a local branch, or a remote branch when fullRef is
// "origin/name".
func (r *Repo) DeleteBranch(ctx context.Context, name string, force bool) error {
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, "-") {
		return errors.New("invalid branch")
	}
	if remote, branch, ok := splitRemoteBranch(r, ctx, name); ok {
		_, err := r.writeRun(ctx, "push", remote, "--delete", branch)
		return err
	}
	flag := "-d"
	if force {
		flag = "-D"
	}
	_, err := r.writeRun(ctx, "branch", flag, name)
	return err
}

func splitRemoteBranch(r *Repo, ctx context.Context, name string) (remote, branch string, ok bool) {
	for _, rem := range r.remoteNames(ctx) {
		if strings.HasPrefix(name, rem+"/") {
			return rem, strings.TrimPrefix(name, rem+"/"), true
		}
	}
	return "", "", false
}

// RenameBranch renames a local branch.
func (r *Repo) RenameBranch(ctx context.Context, oldName, newName string) error {
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return errors.New("a branch needs a name")
	}
	if _, err := r.run(ctx, "check-ref-format", "--branch", newName); err != nil {
		return fmt.Errorf("%q is not a valid branch name", newName)
	}
	_, err := r.writeRun(ctx, "branch", "-m", oldName, newName)
	return err
}

// Merge merges a branch into the current one.
func (r *Repo) Merge(ctx context.Context, ref string, opts MergeOptions) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "-") {
		return "", errors.New("invalid branch")
	}
	args := []string{"merge", "--no-edit"}
	if opts.NoFF {
		args = append(args, "--no-ff")
	}
	if opts.Squash {
		args = append(args, "--squash")
	}
	if opts.Message != "" {
		args = append(args, "-m", opts.Message)
	}
	args = append(args, ref)
	return r.writeRun(ctx, args...)
}

// Rebase rebases the current branch onto ref.
func (r *Repo) Rebase(ctx context.Context, onto string, autostash bool) (string, error) {
	onto = strings.TrimSpace(onto)
	if onto == "" || strings.HasPrefix(onto, "-") {
		return "", errors.New("invalid branch")
	}
	args := []string{"rebase"}
	if autostash {
		args = append(args, "--autostash")
	}
	args = append(args, onto)
	return r.writeRun(ctx, args...)
}

// CherryPick applies a commit to the current branch.
func (r *Repo) CherryPick(ctx context.Context, hash string, noCommit bool) (string, error) {
	if strings.TrimSpace(hash) == "" || strings.HasPrefix(hash, "-") {
		return "", errors.New("invalid revision")
	}
	args := []string{"cherry-pick"}
	if noCommit {
		args = append(args, "--no-commit")
	}
	args = append(args, hash)
	return r.writeRun(ctx, args...)
}

// Revert creates a commit that undoes a commit.
func (r *Repo) Revert(ctx context.Context, hash string) (string, error) {
	if strings.TrimSpace(hash) == "" || strings.HasPrefix(hash, "-") {
		return "", errors.New("invalid revision")
	}
	return r.writeRun(ctx, "revert", "--no-edit", hash)
}

// Reset moves the current branch to a commit. mode is soft, mixed or hard.
func (r *Repo) Reset(ctx context.Context, hash, mode string) (string, error) {
	if strings.TrimSpace(hash) == "" || strings.HasPrefix(hash, "-") {
		return "", errors.New("invalid revision")
	}
	flag := "--mixed"
	switch mode {
	case "soft":
		flag = "--soft"
	case "mixed", "":
		flag = "--mixed"
	case "hard":
		flag = "--hard"
	default:
		return "", fmt.Errorf("unknown reset mode %q", mode)
	}
	return r.writeRun(ctx, "reset", flag, hash)
}

// CreateTag creates a lightweight or annotated tag.
func (r *Repo) CreateTag(ctx context.Context, opts TagOptions) error {
	name := strings.TrimSpace(opts.Name)
	if name == "" || strings.HasPrefix(name, "-") {
		return errors.New("a tag needs a name")
	}
	args := []string{"tag"}
	if opts.Force {
		args = append(args, "-f")
	}
	if opts.Message != "" {
		args = append(args, "-a", "-m", opts.Message)
	}
	args = append(args, name)
	if opts.Revision != "" {
		args = append(args, opts.Revision)
	}
	_, err := r.writeRun(ctx, args...)
	return err
}

// DeleteTag deletes a tag, locally and on the remote when remote is set.
func (r *Repo) DeleteTag(ctx context.Context, name, remote string) error {
	if strings.TrimSpace(name) == "" || strings.HasPrefix(name, "-") {
		return errors.New("invalid tag")
	}
	if _, err := r.writeRun(ctx, "tag", "-d", name); err != nil {
		return err
	}
	if remote != "" {
		_, err := r.writeRun(ctx, "push", remote, "--delete", "refs/tags/"+name)
		return err
	}
	return nil
}

// SetUpstream points a local branch at a remote branch.
func (r *Repo) SetUpstream(ctx context.Context, branch, upstream string) error {
	if branch == "" || upstream == "" {
		return errors.New("a branch and an upstream are required")
	}
	_, err := r.writeRun(ctx, "branch", "--set-upstream-to="+upstream, branch)
	return err
}

// Fetch fetches from the remotes, streaming progress.
func (r *Repo) Fetch(ctx context.Context, opts FetchOptions, emit func(string)) (string, error) {
	args := []string{"fetch", "--progress"}
	if opts.All {
		args = append(args, "--all")
	} else if opts.Remote != "" {
		args = append(args, opts.Remote)
	}
	if opts.Prune {
		args = append(args, "--prune")
	}
	if opts.Tags {
		args = append(args, "--tags")
	}
	return r.stream(ctx, emit, args...)
}

// Pull fetches and integrates the upstream, streaming progress.
func (r *Repo) Pull(ctx context.Context, opts PullOptions, emit func(string)) (string, error) {
	args := []string{"pull", "--progress", "--no-edit"}
	if opts.Rebase {
		args = append(args, "--rebase")
	}
	if opts.Autostash {
		args = append(args, "--autostash")
	}
	if opts.Prune {
		args = append(args, "--prune")
	}
	if opts.Tags {
		args = append(args, "--tags")
	}
	if opts.Remote != "" {
		args = append(args, opts.Remote)
		if opts.Branch != "" {
			args = append(args, opts.Branch)
		}
	}
	return r.stream(ctx, emit, args...)
}

// Push pushes the current branch, streaming progress.
func (r *Repo) Push(ctx context.Context, opts PushOptions, emit func(string)) (string, error) {
	args := []string{"push", "--progress"}
	if opts.DryRun {
		args = append(args, "--dry-run")
	}
	if opts.Tags {
		args = append(args, "--tags")
	}
	if opts.ForceWithLease {
		args = append(args, "--force-with-lease")
	}
	if opts.SetUpstream {
		args = append(args, "--set-upstream")
	}
	remote := opts.Remote
	if remote == "" {
		remote = "origin"
	}
	args = append(args, remote)
	branch := opts.Branch
	if branch == "" {
		if st, err := r.Status(ctx, false); err == nil && st.State.Branch != "" {
			branch = st.State.Branch
		}
	}
	if branch != "" {
		args = append(args, branch)
	}
	return r.stream(ctx, emit, args...)
}

// StashPush saves local changes to the stash.
func (r *Repo) StashPush(ctx context.Context, opts StashOptions) (string, error) {
	args := []string{"stash", "push"}
	if opts.IncludeUntracked {
		args = append(args, "-u")
	}
	if opts.KeepIndex {
		args = append(args, "--keep-index")
	}
	if strings.TrimSpace(opts.Message) != "" {
		args = append(args, "-m", opts.Message)
	}
	if len(opts.Paths) > 0 {
		clean, err := cleanPaths(opts.Paths)
		if err != nil {
			return "", err
		}
		args = append(args, "--")
		args = append(args, clean...)
	}
	r.write.Lock()
	defer r.write.Unlock()
	return r.run(ctx, args...)
}

// Stashes lists the stash entries, newest first.
func (r *Repo) Stashes(ctx context.Context) ([]Stash, error) {
	out, err := r.run(ctx, "stash", "list", "--format=%gd%x00%H%x00%ct%x00%s")
	if err != nil {
		return []Stash{}, nil
	}
	stashes := []Stash{}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.SplitN(line, "\x00", 4)
		if len(f) < 4 {
			continue
		}
		stashes = append(stashes, Stash{
			Index: len(stashes), Ref: f[0], Hash: f[1], Time: parseInt64(f[2]), Message: f[3],
		})
	}
	return stashes, nil
}

// StashApply applies a stash, keeping it, or pops it.
func (r *Repo) StashApply(ctx context.Context, index int, pop bool) (string, error) {
	if index < 0 {
		return "", errors.New("invalid stash")
	}
	action := "apply"
	if pop {
		action = "pop"
	}
	return r.writeRun(ctx, "stash", action, "stash@{"+strconv.Itoa(index)+"}")
}

// StashDrop deletes a stash entry.
func (r *Repo) StashDrop(ctx context.Context, index int) (string, error) {
	if index < 0 {
		return "", errors.New("invalid stash")
	}
	return r.writeRun(ctx, "stash", "drop", "stash@{"+strconv.Itoa(index)+"}")
}

// ConflictContent is the three stages git recorded for an unmerged path,
// plus the working tree file with its conflict markers.
type ConflictContent struct {
	Path      string `json:"path"`
	Base      string `json:"base"`
	Ours      string `json:"ours"`
	Theirs    string `json:"theirs"`
	Working   string `json:"working"`
	HasBase   bool   `json:"hasBase"`
	HasOurs   bool   `json:"hasOurs"`
	HasTheirs bool   `json:"hasTheirs"`
	Binary    bool   `json:"binary"`
}

// Conflict reads the three stages and the working tree of an unmerged path.
func (r *Repo) Conflict(ctx context.Context, path string) (ConflictContent, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return ConflictContent{}, err
	}
	const limit = 8 << 20
	read := func(rev string) (string, bool) {
		out, err := r.run(ctx, "show", rev+":"+clean)
		if err != nil {
			return "", false
		}
		if len(out) > limit {
			out = out[:limit]
		}
		return out, true
	}
	c := ConflictContent{Path: clean}
	c.Base, c.HasBase = read(":1")
	c.Ours, c.HasOurs = read(":2")
	c.Theirs, c.HasTheirs = read(":3")
	if b, err := os.ReadFile(r.AbsPath(clean)); err == nil {
		c.Working = string(b)
	}
	c.Binary = looksBinary(c.Base) || looksBinary(c.Ours) || looksBinary(c.Theirs) || looksBinary(c.Working)
	return c, nil
}

// SaveResolution writes a resolved file and stages it.
func (r *Repo) SaveResolution(ctx context.Context, path, content string) error {
	clean, err := cleanPath(path)
	if err != nil {
		return err
	}
	r.write.Lock()
	defer r.write.Unlock()
	if err := os.MkdirAll(filepath.Dir(r.AbsPath(clean)), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(r.AbsPath(clean), []byte(content), 0o644); err != nil {
		return err
	}
	_, err = r.run(ctx, "add", "-A", "--", clean)
	return err
}

// TakeConflictSide checks out ours or theirs for a path and stages it.
func (r *Repo) TakeConflictSide(ctx context.Context, path, side string) error {
	clean, err := cleanPath(path)
	if err != nil {
		return err
	}
	if side != "ours" && side != "theirs" {
		return errors.New("side must be ours or theirs")
	}
	r.write.Lock()
	defer r.write.Unlock()
	if _, err := r.run(ctx, "checkout", "--"+side, "--", clean); err != nil {
		return err
	}
	_, err = r.run(ctx, "add", "--", clean)
	return err
}

// MarkResolved stages paths, which tells git the conflicts are solved.
func (r *Repo) MarkResolved(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	args := append([]string{"add", "-A", "--"}, clean...)
	_, err = r.writeRun(ctx, args...)
	return err
}

// AbortOperation cancels the merge, rebase, cherry-pick, revert, am or
// bisect in progress.
func (r *Repo) AbortOperation(ctx context.Context) (string, error) {
	op, _, _ := r.operation()
	var args []string
	switch op {
	case "merge":
		args = []string{"merge", "--abort"}
	case "rebase", "rebase-interactive", "am":
		args = []string{"rebase", "--abort"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--abort"}
	case "revert":
		args = []string{"revert", "--abort"}
	case "bisect":
		args = []string{"bisect", "reset"}
	default:
		return "", errors.New("no operation to abort")
	}
	return r.writeRun(ctx, args...)
}

// ContinueOperation finishes the operation in progress after conflicts
// were resolved.
func (r *Repo) ContinueOperation(ctx context.Context) (string, error) {
	op, _, _ := r.operation()
	var args []string
	switch op {
	case "merge":
		// A merge is finished by committing the index.
		args = []string{"commit", "--no-edit"}
	case "rebase", "rebase-interactive":
		args = []string{"rebase", "--continue"}
	case "am":
		args = []string{"am", "--continue"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--continue"}
	case "revert":
		args = []string{"revert", "--continue"}
	default:
		return "", errors.New("no operation to continue")
	}
	return r.writeRun(ctx, args...)
}

// Ignore appends paths to the repository's .gitignore.
func (r *Repo) Ignore(ctx context.Context, paths []string) (string, error) {
	clean, err := cleanPaths(paths)
	if err != nil {
		return "", err
	}
	ignorePath := r.AbsPath(".gitignore")
	existing, _ := os.ReadFile(ignorePath)
	lines := map[string]bool{}
	for _, line := range strings.Split(string(existing), "\n") {
		lines[strings.TrimSpace(line)] = true
	}
	var add strings.Builder
	for _, p := range clean {
		pattern := "/" + p
		if lines[pattern] {
			continue
		}
		add.WriteString(pattern)
		add.WriteString("\n")
		lines[pattern] = true
	}
	if add.Len() == 0 {
		return ".gitignore", nil
	}
	f, err := os.OpenFile(ignorePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if len(existing) > 0 && existing[len(existing)-1] != '\n' {
		if _, err := f.WriteString("\n"); err != nil {
			return "", err
		}
	}
	if _, err := f.WriteString(add.String()); err != nil {
		return "", err
	}
	return ".gitignore", nil
}
