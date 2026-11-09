package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CommitSelected is the commit-dialog entry that insists on an explicit
// selection. It shares Commit's semantics: staged changes of the selected
// paths are committed as staged, paths with nothing staged are taken from
// the working tree, and nothing outside the selection is touched.
func (r *Repo) CommitSelected(ctx context.Context, opts CommitOptions) (CommitResult, error) {
	clean, err := cleanCommitOptions(opts)
	if err != nil {
		return CommitResult{}, err
	}
	if len(clean) == 0 {
		return CommitResult{}, errors.New("choose the changes to commit")
	}
	r.write.Lock()
	defer r.write.Unlock()
	return r.commitLocked(ctx, opts, clean)
}

// cleanCommitOptions validates the commit form and returns the selected
// paths. No paths means "commit the index".
func cleanCommitOptions(opts CommitOptions) ([]string, error) {
	if strings.TrimSpace(opts.Message) == "" && !opts.Amend {
		return nil, errors.New("a commit needs a message")
	}
	if opts.AuthorName != "" || opts.AuthorEmail != "" {
		if strings.ContainsAny(opts.AuthorName+opts.AuthorEmail, "<>\n") {
			return nil, errors.New("the author name or email contains characters git does not allow")
		}
	}
	if len(opts.Paths) == 0 {
		return nil, nil
	}
	return cleanPaths(opts.Paths)
}

// commitLocked builds the commit; r.write is held.
//
// The selected paths are the whole story: for every one of them, the
// staged version wins when the index already has a change, and the
// working tree is staged into a temporary index otherwise. A path that
// only has an unstaged edit is therefore still committed by checking it,
// while a partially staged file commits just the staged hunks and leaves
// the rest in the working tree.
func (r *Repo) commitLocked(ctx context.Context, opts CommitOptions, clean []string) (CommitResult, error) {
	if len(clean) > 0 {
		clean = r.expandRenames(ctx, clean)
	}
	if r.sequencerBusy() || len(clean) == 0 {
		// A merge, cherry-pick or revert is finished from the index: git
		// refuses a partial commit while one is in progress, and the
		// index is the operation's result.
		return r.runCommit(ctx, opts, nil)
	}
	staged, worktree := r.splitByStage(ctx, clean)
	env, cleanup, err := r.tempIndexEnv(ctx)
	if err != nil {
		return CommitResult{}, err
	}
	defer cleanup()
	if len(staged) > 0 {
		// The index already holds these changes; copy them into the
		// temporary tree exactly as they are.
		args := append([]string{"diff", "--cached", "--binary", "--no-color", "-M", "HEAD", "--"}, literalPaths(staged)...)
		patch, perr := r.run(ctx, args...)
		if perr != nil {
			return CommitResult{}, perr
		}
		if strings.TrimSpace(patch) != "" {
			if _, aerr := r.runEnvInput(ctx, env, patch, "apply", "--cached", "--whitespace=nowarn", "-"); aerr != nil {
				return CommitResult{}, aerr
			}
		}
	}
	if len(worktree) > 0 {
		args := append([]string{"add", "-A", "--"}, literalPaths(worktree)...)
		if _, aerr := r.runEnv(ctx, env, args...); aerr != nil {
			return CommitResult{}, aerr
		}
	}
	res, err := r.runCommit(ctx, opts, env)
	if err != nil {
		return res, err
	}
	// The real index follows the new HEAD for the selected paths only, so
	// their worktree content that was not committed stays as a change and
	// every other staged path is untouched.
	reset := append([]string{"reset", "-q", "HEAD", "--"}, literalPaths(clean)...)
	if _, rerr := r.run(ctx, reset...); rerr != nil {
		return res, rerr
	}
	return res, nil
}

// splitByStage says which selected paths carry an index-side change. A
// renamed path puts both halves on the staged side, because the deletion
// of the old path belongs to the same change.
func (r *Repo) splitByStage(ctx context.Context, paths []string) (staged, worktree []string) {
	stagedPaths := map[string]bool{}
	out, err := r.run(ctx, "status", "--porcelain=v2", "-z", "--untracked-files=all")
	if err == nil {
		for _, c := range parseStatus(out).Changes {
			if !c.Staged {
				continue
			}
			stagedPaths[c.Path] = true
			if c.OldPath != "" {
				stagedPaths[c.OldPath] = true
			}
		}
	}
	for _, p := range paths {
		if stagedPaths[p] {
			staged = append(staged, p)
		} else {
			worktree = append(worktree, p)
		}
	}
	return staged, worktree
}

// sequencerBusy reports a multi-step operation git has to finish itself.
// A partial commit is impossible while one is in progress.
func (r *Repo) sequencerBusy() bool {
	if r.gitDir == "" {
		return false
	}
	for _, name := range []string{"MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"} {
		if _, err := os.Stat(filepath.Join(r.gitDir, name)); err == nil {
			return true
		}
	}
	return false
}

// tempIndexEnv starts a temporary index at HEAD and returns the
// environment that points git at it, with a cleanup that removes it.
func (r *Repo) tempIndexEnv(ctx context.Context) ([]string, func(), error) {
	index := filepath.Join(r.gitDir, "gitjet-commit-index")
	_ = os.Remove(index)
	cleanup := func() { _ = os.Remove(index) }
	env := []string{"GIT_INDEX_FILE=" + index}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "HEAD"); err == nil {
		if _, rerr := r.runEnv(ctx, env, "read-tree", "HEAD"); rerr != nil {
			cleanup()
			return nil, nil, rerr
		}
	} else if _, rerr := r.runEnv(ctx, env, "read-tree", "--empty"); rerr != nil {
		cleanup()
		return nil, nil, rerr
	}
	return env, cleanup, nil
}

// runCommit runs git commit itself, so hooks, signing and commit.gpgsign
// are the user's own. A nil env uses the repository's real index.
func (r *Repo) runCommit(ctx context.Context, opts CommitOptions, env []string) (CommitResult, error) {
	args := []string{"commit"}
	if opts.Amend {
		args = append(args, "--amend")
		if strings.TrimSpace(opts.Message) == "" {
			args = append(args, "--no-edit")
		}
	}
	if opts.AllowEmpty {
		args = append(args, "--allow-empty")
	}
	if opts.Sign {
		args = append(args, "-S")
	}
	if opts.SignOff {
		args = append(args, "--signoff")
	}
	if opts.NoVerify {
		args = append(args, "--no-verify")
	}
	commitEnv := env
	if opts.AuthorName != "" || opts.AuthorEmail != "" {
		name := opts.AuthorName
		if name == "" {
			name = "GitJet"
		}
		commitEnv = append(append([]string{}, env...), "GIT_AUTHOR_NAME="+name, "GIT_AUTHOR_EMAIL="+opts.AuthorEmail)
		args = append(args, "--author="+name+" <"+opts.AuthorEmail+">")
	}
	if msg := strings.TrimSpace(opts.Message); msg != "" {
		args = append(args, "-m", msg)
	}
	var out string
	var err error
	if commitEnv != nil {
		out, err = r.runEnv(ctx, commitEnv, args...)
	} else {
		out, err = r.run(ctx, args...)
	}
	if err != nil {
		return CommitResult{}, err
	}
	res := CommitResult{Output: strings.TrimSpace(out)}
	if hash, herr := r.run(ctx, "rev-parse", "HEAD"); herr == nil {
		res.Hash = strings.TrimSpace(hash)
		res.Short = short(res.Hash)
	}
	if subject, serr := r.run(ctx, "log", "-1", "--format=%s"); serr == nil {
		res.Subject = strings.TrimSpace(subject)
	}
	if res.Subject != "" {
		res.Output = fmt.Sprintf("%s %s", res.Short, res.Subject)
	}
	return res, nil
}
