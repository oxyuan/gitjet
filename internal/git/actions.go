package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

// CommitOptions is what the commit dialog selected.
type CommitOptions struct {
	Message    string   `json:"message"`
	Paths      []string `json:"paths"`
	Amend      bool     `json:"amend"`
	SignOff    bool     `json:"signOff"`
	NoVerify   bool     `json:"noVerify"`
	AllowEmpty bool     `json:"allowEmpty"`
	// Sign adds -S, signing this commit with the configured GPG key.
	Sign        bool   `json:"sign"`
	AuthorName  string `json:"authorName"`
	AuthorEmail string `json:"authorEmail"`
	// StagedOnly commits exactly the index and ignores the path selection,
	// the way a staging-area workflow's "Commit Staged" does. Without it a
	// checked path with nothing staged is taken from the working tree.
	StagedOnly bool `json:"stagedOnly"`
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
	Remote string `json:"remote"`
	Branch string `json:"branch"`
	// RemoteBranch is the branch on the other side, when it is not the same
	// name as the local branch. Empty means "same name".
	RemoteBranch   string `json:"remoteBranch"`
	SetUpstream    bool   `json:"setUpstream"`
	ForceWithLease bool   `json:"forceWithLease"`
	// ForceIfIncludes adds --force-if-includes, which refuses the forced
	// update when the remote moved since the last fetch.
	ForceIfIncludes bool `json:"forceIfIncludes"`
	Tags            bool `json:"tags"`
	DryRun          bool `json:"dryRun"`
}

// PullOptions selects how to integrate the upstream.
type PullOptions struct {
	Remote    string `json:"remote"`
	Branch    string `json:"branch"`
	Rebase    bool   `json:"rebase"`
	Autostash bool   `json:"autostash"`
	Prune     bool   `json:"prune"`
	Tags      bool   `json:"tags"`
	// FFOnly refuses a merge commit; NoFF always creates one.
	FFOnly bool `json:"ffOnly"`
	NoFF   bool `json:"noFF"`
	// Squash applies the incoming changes without integrating the history.
	Squash bool `json:"squash"`
	// NoCommit leaves the merge result in the index.
	NoCommit bool `json:"noCommit"`
	// TagsMode mirrors FetchOptions.TagsMode for the implicit fetch.
	TagsMode string `json:"tagsMode"`
}

// FetchOptions selects what to fetch.
type FetchOptions struct {
	All    bool   `json:"all"`
	Remote string `json:"remote"`
	Prune  bool   `json:"prune"`
	Tags   bool   `json:"tags"`
	// TagsMode is the setting's policy when Tags is false: "always" adds
	// --tags, "never" adds --no-tags, and anything else leaves git's
	// default (tags that point into fetched history).
	TagsMode string `json:"tagsMode"`
}

// MergeOptions selects how to merge.
type MergeOptions struct {
	NoFF    bool   `json:"noFF"`
	FFOnly  bool   `json:"ffOnly"`
	Squash  bool   `json:"squash"`
	Message string `json:"message"`
	// NoCommit leaves the merge result in the index.
	NoCommit bool `json:"noCommit"`
	// NoVerify skips the pre-merge and commit-message hooks.
	NoVerify bool `json:"noVerify"`
	// AllowUnrelatedHistories merges a branch that shares no ancestor.
	AllowUnrelatedHistories bool `json:"allowUnrelatedHistories"`
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

// Stage adds paths to the index. Deletions are staged too, and half of a
// rename is completed with its other half.
func (r *Repo) Stage(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	r.write.Lock()
	defer r.write.Unlock()
	clean = r.expandRenames(ctx, clean)
	args := append([]string{"add", "-A", "--"}, literalPaths(clean)...)
	_, err = r.run(ctx, args...)
	return err
}

// Unstage removes paths from the index, leaving the working tree alone. A
// rename is unstaged as one change, so the old path's deletion does not
// stay behind in the index.
func (r *Repo) Unstage(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	r.write.Lock()
	defer r.write.Unlock()
	clean = r.expandRenames(ctx, clean)
	args := append([]string{"reset", "-q", "--"}, literalPaths(clean)...)
	_, err = r.run(ctx, args...)
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
	return r.rollbackLocked(ctx, clean)
}

// rollbackLocked is Rollback for a caller that already holds the write
// lock; paths must be clean.
func (r *Repo) rollbackLocked(ctx context.Context, clean []string) error {
	pairs := r.renamePairs(ctx)
	expanded := r.expandRenames(ctx, clean)
	for _, p := range expanded {
		_, _ = r.run(ctx, "reset", "-q", "--", literalPath(p))
	}
	for _, p := range clean {
		if old := pairs[p]; old != "" {
			// A rename: HEAD has the old path, and the renamed file on
			// disk is a leftover that rollback has to remove. Checking
			// out the new path cannot work here, so deleting it is the
			// only way back to HEAD.
			if _, err := r.run(ctx, "checkout", "HEAD", "--", literalPath(old)); err != nil {
				return err
			}
			if err := os.RemoveAll(r.AbsPath(p)); err != nil && !os.IsNotExist(err) {
				return err
			}
			continue
		}
		if _, err := r.run(ctx, "checkout", "HEAD", "--", literalPath(p)); err != nil {
			// Not in HEAD: an added file, which rollback deletes.
			if err := os.RemoveAll(r.AbsPath(p)); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return nil
}

// Commit creates the commit the commit dialog described. Paths that have
// staged changes are committed exactly as the index holds them; a path
// with nothing staged is staged from the working tree into a temporary
// index, so checking a file still means "commit this file" without
// dragging along hunks the user left unstaged. Nothing outside the
// checked paths is touched, and git commit runs, so hooks, signing and
// commit.gpgsign behave as they do in a terminal.
func (r *Repo) Commit(ctx context.Context, opts CommitOptions) (CommitResult, error) {
	clean, err := cleanCommitOptions(opts)
	if err != nil {
		return CommitResult{}, err
	}
	r.write.Lock()
	defer r.write.Unlock()
	return r.commitLocked(ctx, opts, clean)
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
		if err := r.refuseIgnoredOverwrites(ctx, ref); err != nil {
			return "", err
		}
		return r.run(ctx, "switch", ref)
	}
	if r.hasRef(ctx, "refs/tags/"+ref) {
		if err := r.refuseIgnoredOverwrites(ctx, ref); err != nil {
			return "", err
		}
		return r.run(ctx, "switch", "--detach", ref)
	}
	for _, remote := range r.remoteNames(ctx) {
		if strings.HasPrefix(ref, remote+"/") {
			local := strings.TrimPrefix(ref, remote+"/")
			if local == "HEAD" {
				return "", errors.New("cannot check out a remote HEAD")
			}
			if err := r.refuseIgnoredOverwrites(ctx, ref); err != nil {
				return "", err
			}
			if r.hasRef(ctx, "refs/heads/"+local) {
				return r.run(ctx, "switch", local)
			}
			return r.run(ctx, "switch", "-c", local, "--track", ref)
		}
	}
	if err := r.refuseIgnoredOverwrites(ctx, ref); err != nil {
		return "", err
	}
	return r.run(ctx, "switch", "--detach", ref)
}

func (r *Repo) hasRef(ctx context.Context, full string) bool {
	_, err := r.run(ctx, "show-ref", "--verify", "--quiet", full)
	return err == nil
}

// ignoredOverwrites lists the paths a checkout of rev would silently
// write over: tracked in rev, ignored by the working tree's rules, and
// therefore untracked right now. Git replaces those files without saying
// anything, which loses whatever the user keeps there.
func (r *Repo) ignoredOverwrites(ctx context.Context, rev string) []string {
	if strings.TrimSpace(rev) == "" {
		return nil
	}
	ignoredOut, err := r.run(ctx, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")
	if err != nil {
		return nil
	}
	ignored := map[string]bool{}
	for _, p := range strings.Split(ignoredOut, "\x00") {
		if p != "" {
			ignored[p] = true
		}
	}
	if len(ignored) == 0 {
		return nil
	}
	treeOut, err := r.run(ctx, "ls-tree", "-r", "--name-only", "-z", rev)
	if err != nil {
		return nil
	}
	var hits []string
	for _, p := range strings.Split(treeOut, "\x00") {
		if p != "" && ignored[p] {
			hits = append(hits, p)
		}
	}
	sort.Strings(hits)
	return hits
}

// refuseIgnoredOverwrites stops an operation that would replace files the
// ignore rules keep out of git but that the target still tracks.
func (r *Repo) refuseIgnoredOverwrites(ctx context.Context, rev string) error {
	hits := r.ignoredOverwrites(ctx, rev)
	if len(hits) == 0 {
		return nil
	}
	const shown = 5
	list := strings.Join(hits[:min(len(hits), shown)], ", ")
	if len(hits) > shown {
		list += ", ..."
	}
	return fmt.Errorf("%s would be overwritten by files this branch keeps ignored: %s", rev, list)
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
	if opts.NoFF && opts.FFOnly {
		return "", errors.New("a merge cannot both require and forbid a fast-forward")
	}
	args := []string{"merge", "--no-edit"}
	if opts.NoFF {
		args = append(args, "--no-ff")
	}
	if opts.FFOnly {
		args = append(args, "--ff-only")
	}
	if opts.Squash {
		args = append(args, "--squash")
	}
	if opts.NoCommit {
		args = append(args, "--no-commit")
	}
	if opts.NoVerify {
		args = append(args, "--no-verify")
	}
	if opts.AllowUnrelatedHistories {
		args = append(args, "--allow-unrelated-histories")
	}
	if opts.Message != "" {
		args = append(args, "-m", opts.Message)
	}
	if err := r.refuseIgnoredOverwrites(ctx, ref); err != nil {
		return "", err
	}
	args = append(args, ref)
	return r.writeRun(ctx, args...)
}

// RebaseOptions selects how a rebase replays commits.
type RebaseOptions struct {
	// Onto is the new base: a branch, a commit, or the range to replay.
	Onto string `json:"onto"`
	// Branch rebases another branch instead of the checked-out one.
	Branch    string `json:"branch"`
	Autostash bool   `json:"autostash"`
	// Empty decides what happens to a commit that becomes empty while it
	// is replayed: "keep" keeps it, "drop" removes it and "stop" pauses on
	// it. Empty leaves git's default, which is "drop". This replaces the
	// older --keep-empty switch, which only restated that default.
	Empty string `json:"empty"`
	// UpdateRefs moves branches that point into the rebased range.
	UpdateRefs bool `json:"updateRefs"`
	// RebaseMerges recreates merge commits instead of flattening them.
	RebaseMerges bool `json:"rebaseMerges"`
	// Root rebases every commit of the branch, not only those after onto.
	Root bool `json:"root"`
	// AutoSquash is tri-state: "" leaves the git config in charge, "true"
	// adds --autosquash and "false" adds --no-autosquash.
	AutoSquash string `json:"autoSquash"`
}

// Rebase replays the current branch (or opts.Branch) onto a new base.
func (r *Repo) Rebase(ctx context.Context, opts RebaseOptions) (string, error) {
	onto := strings.TrimSpace(opts.Onto)
	if opts.Root {
		onto = ""
	}
	if opts.Branch != "" {
		if onto == "" && !opts.Root {
			return "", errors.New("a rebase needs a new base")
		}
	} else if onto == "" && !opts.Root {
		return "", errors.New("a rebase needs a new base")
	}
	for _, value := range []string{onto, opts.Branch} {
		if strings.HasPrefix(value, "-") {
			return "", errors.New("invalid branch")
		}
	}
	switch opts.AutoSquash {
	case "", "true", "false":
	default:
		return "", errors.New("autosquash must be true, false or unset")
	}
	switch opts.Empty {
	case "", "keep", "drop", "stop":
	default:
		return "", errors.New("empty commits must be kept, dropped or stopped at")
	}
	args := []string{"rebase"}
	if opts.Root {
		args = append(args, "--root")
	}
	if opts.Autostash {
		args = append(args, "--autostash")
	}
	if opts.UpdateRefs {
		args = append(args, "--update-refs")
	}
	if opts.RebaseMerges {
		args = append(args, "--rebase-merges")
	}
	if opts.Empty != "" {
		args = append(args, "--empty="+opts.Empty)
	}
	if opts.AutoSquash != "" {
		// --autosquash only rewrites a todo list, which exists only in an
		// interactive rebase; without -i git accepts the flag and does
		// nothing, leaving fixup!/squash! commits in place.
		args = append(args, "-i")
		if opts.AutoSquash == "true" {
			args = append(args, "--autosquash")
		} else {
			args = append(args, "--no-autosquash")
		}
	}
	if onto != "" {
		if err := r.refuseIgnoredOverwrites(ctx, onto); err != nil {
			return "", err
		}
		args = append(args, onto)
	}
	if opts.Branch != "" {
		args = append(args, opts.Branch)
	}
	return r.writeRun(ctx, args...)
}

// CherryPick applies commits to the current branch, oldest first. A merge
// commit needs a mainline to apply, which this app does not ask for, so it
// is refused with the reason instead of git's bare "no -m option" error.
func (r *Repo) CherryPick(ctx context.Context, hashes []string, noCommit bool) (string, error) {
	args := []string{"cherry-pick"}
	if noCommit {
		args = append(args, "--no-commit")
	}
	clean, err := cleanRevisions(hashes)
	if err != nil {
		return "", err
	}
	for _, hash := range clean {
		if parents, perr := r.parents(ctx, hash); perr == nil && len(parents) > 1 {
			return "", fmt.Errorf("%s is a merge commit: pick the branch it was merged into instead", short(hash))
		}
	}
	args = append(args, clean...)
	return r.writeRun(ctx, args...)
}

// Revert creates commits that undo commits. The page hands commits oldest
// first, as cherry-pick needs them; a revert has to run newest first, or
// undoing a parent removes the lines its child changed and the run stops
// on a conflict that a terminal user never sees.
func (r *Repo) Revert(ctx context.Context, hashes []string) (string, error) {
	clean, err := cleanRevisions(hashes)
	if err != nil {
		return "", err
	}
	for i, j := 0, len(clean)-1; i < j; i, j = i+1, j-1 {
		clean[i], clean[j] = clean[j], clean[i]
	}
	for _, hash := range clean {
		if parents, perr := r.parents(ctx, hash); perr == nil && len(parents) > 1 {
			return "", fmt.Errorf("%s is a merge commit: revert the commits it brought in instead", short(hash))
		}
	}
	return r.writeRun(ctx, append([]string{"revert", "--no-edit"}, clean...)...)
}

// cleanRevisions validates a list of commits to apply, keeping the order
// the page sent and rejecting anything that could be read as a flag.
func cleanRevisions(hashes []string) ([]string, error) {
	clean := make([]string, 0, len(hashes))
	for _, h := range hashes {
		h = strings.TrimSpace(h)
		if h == "" || strings.HasPrefix(h, "-") {
			return nil, errors.New("invalid revision")
		}
		clean = append(clean, h)
	}
	if len(clean) == 0 {
		return nil, errors.New("choose a commit first")
	}
	return clean, nil
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
	case "keep":
		flag = "--keep"
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
	} else if opts.TagsMode == "always" {
		args = append(args, "--tags")
	} else if opts.TagsMode == "never" {
		args = append(args, "--no-tags")
	}
	return r.stream(ctx, emit, args...)
}

// Pull fetches and integrates the upstream, streaming progress. It holds
// the write lock: a pull rewrites the index and the working tree, and a
// stage or commit running beside it would race for index.lock.
func (r *Repo) Pull(ctx context.Context, opts PullOptions, emit func(string)) (string, error) {
	if opts.FFOnly && opts.NoFF {
		return "", errors.New("a pull cannot both require and forbid a fast-forward")
	}
	args := []string{"pull", "--progress", "--no-edit"}
	if opts.Rebase {
		args = append(args, "--rebase")
	}
	if opts.FFOnly {
		args = append(args, "--ff-only")
	}
	if opts.NoFF {
		args = append(args, "--no-ff")
	}
	if opts.Squash {
		args = append(args, "--squash")
	}
	if opts.NoCommit {
		args = append(args, "--no-commit")
	}
	if opts.Autostash {
		args = append(args, "--autostash")
	}
	if opts.Prune {
		args = append(args, "--prune")
	}
	if opts.Tags {
		args = append(args, "--tags")
	} else if opts.TagsMode == "always" {
		args = append(args, "--tags")
	} else if opts.TagsMode == "never" {
		args = append(args, "--no-tags")
	}
	if opts.Remote != "" {
		args = append(args, opts.Remote)
		if opts.Branch != "" {
			args = append(args, opts.Branch)
		}
	}
	r.write.Lock()
	defer r.write.Unlock()
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
	if opts.ForceIfIncludes {
		args = append(args, "--force-if-includes")
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
	target := strings.TrimSpace(opts.RemoteBranch)
	if branch == "" {
		// Detached HEAD: the commit is the source, and the target branch
		// has to be named explicitly.
		if target == "" {
			return "", errors.New("choose the remote branch to push HEAD to")
		}
		if _, err := r.run(ctx, "check-ref-format", "--branch", target); err != nil {
			return "", errors.New("that is not a branch name")
		}
		args = append(args, "HEAD:refs/heads/"+target)
		return r.stream(ctx, emit, args...)
	}
	if target != "" && target != branch {
		// A fully qualified refspec pushes this branch to a different name
		// on the remote, which is how a local branch takes over one that is
		// already there under another name.
		if _, err := r.run(ctx, "check-ref-format", "--branch", target); err != nil {
			return "", errors.New("that is not a branch name")
		}
		args = append(args, "refs/heads/"+branch+":refs/heads/"+target)
	} else {
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
		args = append(args, literalPaths(clean)...)
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
func (r *Repo) StashApply(ctx context.Context, index int, pop, restoreIndex bool) (string, error) {
	if index < 0 {
		return "", errors.New("invalid stash")
	}
	action := "apply"
	if pop {
		action = "pop"
	}
	args := []string{"stash", action}
	if restoreIndex {
		args = append(args, "--index")
	}
	args = append(args, "stash@{"+strconv.Itoa(index)+"}")
	return r.writeRun(ctx, args...)
}

// StashRestore pops a stash and restores what was staged, which is how the
// app puts back the local changes it saved before an operation.
func (r *Repo) StashRestore(ctx context.Context, index int) (string, error) {
	if index < 0 {
		return "", errors.New("invalid stash")
	}
	return r.writeRun(ctx, "stash", "pop", "--index", "stash@{"+strconv.Itoa(index)+"}")
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
	Path     string `json:"path"`
	Language string `json:"language"`
	// Kind is what the path is: a regular "file", a "symlink" or a
	// "submodule". Only a file merges as text; the other two can be resolved
	// by choosing a side but must never be written through.
	Kind      string `json:"kind"`
	Base      string `json:"base"`
	Ours      string `json:"ours"`
	Theirs    string `json:"theirs"`
	Working   string `json:"working"`
	HasBase   bool   `json:"hasBase"`
	HasOurs   bool   `json:"hasOurs"`
	HasTheirs bool   `json:"hasTheirs"`
	Binary    bool   `json:"binary"`
}

// conflictKind reads the index mode of the stages, which is the only place a
// link or a submodule is distinguishable from a text file before the tree is
// checked out. Without stages the working tree decides.
func (r *Repo) conflictKind(ctx context.Context, path string) string {
	if out, err := r.run(ctx, "ls-files", "-u", "-z", "--", literalPath(path)); err == nil {
		for _, record := range strings.Split(out, "\x00") {
			meta, _, ok := strings.Cut(record, "\t")
			if !ok {
				continue
			}
			fields := strings.Fields(meta)
			if len(fields) < 3 {
				continue
			}
			switch fields[0] {
			case "160000":
				return "submodule"
			case "120000":
				return "symlink"
			}
		}
	}
	fi, err := os.Lstat(r.AbsPath(path))
	if err != nil {
		return "file"
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	if fi.IsDir() {
		return "submodule"
	}
	return "file"
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
	c := ConflictContent{Path: clean, Language: languageOf(clean), Kind: r.conflictKind(ctx, clean)}
	c.Base, c.HasBase = read(":1")
	c.Ours, c.HasOurs = read(":2")
	c.Theirs, c.HasTheirs = read(":3")
	// Reading a link follows it, so only a regular file is read as text: the
	// panes show what a merge could write, not the link's target.
	if c.Kind == "file" {
		if b, err := os.ReadFile(r.AbsPath(clean)); err == nil {
			c.Working = string(b)
		}
	}
	c.Binary = looksBinary(c.Base) || looksBinary(c.Ours) || looksBinary(c.Theirs) || looksBinary(c.Working)
	return c, nil
}

// CountConflictMarkers counts the conflict blocks a working file still
// carries, so the conflicts dialog can show 0/3 for an untouched file.
func CountConflictMarkers(content string) int {
	n := 0
	for _, line := range strings.Split(content, "\n") {
		if strings.HasPrefix(line, "<<<<<<< ") || line == "<<<<<<<" {
			n++
		}
	}
	return n
}

// TakeConflictSide checks out ours or theirs for a path and stages it. A
// side stage can be missing (add/delete and modify/delete conflicts), in
// which case "take this side" means the file does not exist.
func (r *Repo) TakeConflictSide(ctx context.Context, path, side string) error {
	clean, err := cleanPath(path)
	if err != nil {
		return err
	}
	if side != "ours" && side != "theirs" {
		return errors.New("side must be ours or theirs")
	}
	stage := ":2"
	if side == "theirs" {
		stage = ":3"
	}
	r.write.Lock()
	defer r.write.Unlock()
	if _, err := r.run(ctx, "cat-file", "-e", stage+":"+clean); err != nil {
		if err := os.Remove(r.AbsPath(clean)); err != nil && !os.IsNotExist(err) {
			return err
		}
		_, err = r.run(ctx, "add", "-A", "--", literalPath(clean))
		return err
	}
	if _, err := r.run(ctx, "checkout", "--"+side, "--", literalPath(clean)); err != nil {
		return err
	}
	_, err = r.run(ctx, "add", "--", literalPath(clean))
	return err
}

// MarkResolved stages paths, which tells git the conflicts are solved.
func (r *Repo) MarkResolved(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	// Git reads an unescaped path as a glob: marking web/[slug]/page.tsx
	// resolved must not stage web/s/page.tsx as well.
	args := append([]string{"add", "-A", "--"}, literalPaths(clean)...)
	_, err = r.writeRun(ctx, args...)
	return err
}

// AbortOperation cancels the merge, rebase, cherry-pick, revert, am or
// bisect in progress.
func (r *Repo) AbortOperation(ctx context.Context) (string, error) {
	r.write.Lock()
	defer r.write.Unlock()
	// A rewrite plan is aborted by rewinding to where it started, which
	// is what rebase --abort would do for an interactive rebase.
	if out, ok, err := r.abortPlan(ctx); ok {
		return out, err
	}
	op, _, _ := r.operation()
	var args []string
	switch op {
	case "merge":
		args = []string{"merge", "--abort"}
	case "rebase", "rebase-interactive":
		args = []string{"rebase", "--abort"}
	case "am":
		args = []string{"am", "--abort"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--abort"}
	case "revert":
		args = []string{"revert", "--abort"}
	case "bisect":
		args = []string{"bisect", "reset"}
	default:
		return "", errors.New("no operation to abort")
	}
	return r.run(ctx, args...)
}

// ContinueOperation finishes the operation in progress after conflicts
// were resolved. When a rewrite plan is running, the rest of the plan
// follows the commit the user just resolved.
func (r *Repo) ContinueOperation(ctx context.Context) (string, error) {
	r.write.Lock()
	defer r.write.Unlock()
	// A plan always stops on a conflicting cherry-pick, so continue that
	// step and replay the rest.
	plan, hasPlan := r.readPlan()
	if hasPlan && plan != nil && !r.planIsCurrent(plan) {
		// Stale plan: the rewrite it records is not what this checkout is
		// doing any more, and replaying it would cherry-pick onto an
		// unrelated branch.
		r.clearPlan()
		hasPlan = false
	}
	if hasPlan && plan != nil {
		out := ""
		committed := false
		if plan.Paused {
			// An "edit" step stopped after applying its commit; the user
			// has amended it and asks for the rest of the plan.
			plan.Paused = false
			plan.Index++
			if err := r.writePlan(plan); err != nil {
				return "", err
			}
			rest, err := r.resumePlan(ctx, false)
			return strings.TrimSpace(rest), err
		}
		if r.pendingPick() != "" {
			res, err := r.run(ctx, "cherry-pick", "--continue")
			if err != nil {
				return res, err
			}
			out = res
			committed = true
		}
		rest, err := r.resumePlan(ctx, committed)
		return strings.TrimSpace(strings.TrimSpace(out) + "\n" + rest), err
	}
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
	return r.run(ctx, args...)
}

// SkipOperation drops the commit an operation is stopped on and continues
// with the next one, which is what "Skip Commit" offers during a rebase,
// an am, a cherry-pick or a revert.
func (r *Repo) SkipOperation(ctx context.Context) (string, error) {
	r.write.Lock()
	defer r.write.Unlock()
	plan, hasPlan := r.readPlan()
	if hasPlan && plan != nil && r.planIsCurrent(plan) {
		if r.pendingPick() == "" {
			return "", errors.New("nothing to skip")
		}
		out, err := r.run(ctx, "cherry-pick", "--skip")
		if err != nil {
			return out, err
		}
		// The step was dropped, so the plan moves past it.
		plan.Index++
		r.savePlan(plan)
		rest, err := r.resumePlan(ctx, false)
		return strings.TrimSpace(out + "\n" + rest), err
	}
	if hasPlan {
		r.clearPlan()
	}
	op, _, _ := r.operation()
	var args []string
	switch op {
	case "rebase", "rebase-interactive":
		args = []string{"rebase", "--skip"}
	case "am":
		args = []string{"am", "--skip"}
	case "cherry-pick":
		args = []string{"cherry-pick", "--skip"}
	case "revert":
		args = []string{"revert", "--skip"}
	default:
		return "", errors.New("nothing to skip")
	}
	return r.run(ctx, args...)
}

// Ignore adds paths to the repository's .gitignore. Tracked files under a
// path are removed from the index first, so Git stops following their
// changes; the files on disk are left alone.
func (r *Repo) Ignore(ctx context.Context, paths []string) (string, error) {
	clean, err := cleanPaths(paths)
	if err != nil {
		return "", err
	}
	r.write.Lock()
	defer r.write.Unlock()

	pathspec := append([]string{"--"}, literalPaths(clean)...)
	unmerged, err := r.run(ctx, append([]string{"ls-files", "-u", "-z"}, pathspec...)...)
	if err != nil {
		return "", err
	}
	if unmerged != "" {
		return "", errors.New("cannot ignore a path with unresolved conflicts")
	}
	trackedOut, err := r.run(ctx, append([]string{"ls-files", "-z"}, pathspec...)...)
	if err != nil {
		return "", err
	}
	tracked := strings.Split(trackedOut, "\x00")
	var roots []string
	for _, p := range clean {
		prefix := p + "/"
		for _, file := range tracked {
			if file == p || strings.HasPrefix(file, prefix) {
				roots = append(roots, p)
				break
			}
		}
	}
	if len(roots) > 0 {
		rmArgs := append([]string{"rm", "-r", "--cached", "--quiet", "-f", "--"}, literalPaths(roots)...)
		if _, err := r.run(ctx, rmArgs...); err != nil {
			return "", err
		}
	}

	ignorePath := r.AbsPath(".gitignore")
	existing, _ := os.ReadFile(ignorePath)
	lines := map[string]bool{}
	for _, line := range strings.Split(string(existing), "\n") {
		lines[strings.TrimSpace(line)] = true
	}
	var add strings.Builder
	for _, p := range clean {
		pattern := ignorePattern(p)
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

// ignorePattern renders one repository path as an anchored .gitignore line.
func ignorePattern(p string) string {
	var b strings.Builder
	b.WriteByte('/')
	for _, c := range p {
		if strings.ContainsRune(`\*?[`, c) {
			b.WriteByte('\\')
		}
		b.WriteRune(c)
	}
	return b.String()
}
