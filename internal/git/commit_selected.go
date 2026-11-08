package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// signoffTrailer is the line "git commit --signoff" would append.
func (r *Repo) signoffTrailer(ctx context.Context) string {
	out, err := r.run(ctx, "var", "GIT_COMMITTER_IDENT")
	if err != nil {
		return ""
	}
	ident := strings.TrimSpace(out)
	open := strings.IndexByte(ident, '<')
	close := strings.IndexByte(ident, '>')
	if open < 0 || close < open {
		return ""
	}
	name := strings.TrimSpace(ident[:open])
	email := strings.TrimSpace(ident[open+1 : close])
	if name == "" || email == "" {
		return ""
	}
	return "Signed-off-by: " + name + " <" + email + ">"
}

// CommitSelected commits exactly the selected paths as they are on disk,
// without touching the staging of anything else. The commit is built on a
// temporary index, so partially staged files elsewhere keep their state —
// this is IDEA's in-memory "extract changes into a commit".
func (r *Repo) CommitSelected(ctx context.Context, opts CommitOptions) (CommitResult, error) {
	msg := strings.TrimSpace(opts.Message)
	if msg == "" && !opts.Amend {
		return CommitResult{}, errors.New("a commit needs a message")
	}
	clean, err := cleanPaths(opts.Paths)
	if err != nil {
		return CommitResult{}, err
	}
	if len(clean) == 0 {
		return CommitResult{}, errors.New("choose the changes to commit")
	}
	r.write.Lock()
	defer r.write.Unlock()

	head := ""
	if out, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "HEAD"); err == nil {
		head = strings.TrimSpace(out)
	}
	if opts.Amend {
		if head == "" {
			return CommitResult{}, errors.New("there is no commit to amend")
		}
		if msg == "" {
			if out, err := r.run(ctx, "log", "-1", "--format=%B"); err == nil {
				msg = strings.TrimRight(out, "\n")
			}
		}
	}
	tempIndex := filepath.Join(r.gitDir, "gitjet-selected-index")
	_ = os.Remove(tempIndex)
	defer os.Remove(tempIndex)
	env := []string{"GIT_INDEX_FILE=" + tempIndex}

	if head == "" {
		if _, err := r.runEnv(ctx, env, "read-tree", "--empty"); err != nil {
			return CommitResult{}, err
		}
	} else if _, err := r.runEnv(ctx, env, "read-tree", head); err != nil {
		return CommitResult{}, err
	}

	// Tracked paths: one patch from HEAD to the working tree.
	var tracked []string
	var untracked []string
	for _, path := range clean {
		if r.isTracked(ctx, path) {
			tracked = append(tracked, path)
		} else if _, err := os.Stat(r.AbsPath(path)); err == nil {
			untracked = append(untracked, path)
		}
	}
	if len(tracked) > 0 {
		args := []string{"diff", "--no-color", "--no-ext-diff", "--binary"}
		if head != "" {
			args = append(args, head)
		}
		args = append(args, "--")
		args = append(args, literalPaths(tracked)...)
		patch, err := r.run(ctx, args...)
		if err != nil {
			return CommitResult{}, err
		}
		if strings.TrimSpace(patch) != "" {
			if _, err := r.runEnvInput(ctx, env, patch, "apply", "--cached", "--whitespace=nowarn", "-"); err != nil {
				return CommitResult{}, err
			}
		}
	}
	for _, path := range untracked {
		content, err := os.ReadFile(r.AbsPath(path))
		if err != nil {
			return CommitResult{}, err
		}
		if looksBinary(string(content)) {
			// A binary file cannot be expressed by syntheticNewFile's text
			// patch; stage it whole in the temporary index instead.
			if _, err := r.runEnv(ctx, env, "add", "--", literalPath(path)); err != nil {
				return CommitResult{}, err
			}
			continue
		}
		patch := syntheticNewFile(path, content)
		if strings.TrimSpace(patch) == "" {
			continue
		}
		if _, err := r.runEnvInput(ctx, env, patch, "apply", "--cached", "--whitespace=nowarn", "-"); err != nil {
			return CommitResult{}, err
		}
	}

	tree, err := r.runEnv(ctx, env, "write-tree")
	if err != nil {
		return CommitResult{}, err
	}
	tree = strings.TrimSpace(tree)
	args := []string{"commit-tree", tree}
	if opts.Amend {
		// Amending replaces the commit: its parents are inherited, not
		// the commit itself.
		parents, perr := r.parents(ctx, head)
		if perr != nil {
			return CommitResult{}, perr
		}
		for _, parent := range parents {
			args = append(args, "-p", parent)
		}
	} else if head != "" {
		args = append(args, "-p", head)
	}
	if opts.SignOff {
		if trailer := r.signoffTrailer(ctx); trailer != "" && !strings.Contains(msg, "Signed-off-by:") {
			msg += "\n\n" + trailer
		}
	}
	if opts.Sign {
		args = append(args, "-S")
	}
	args = append(args, "-m", msg)
	commitEnv := append([]string{}, env...)
	if opts.AuthorName != "" || opts.AuthorEmail != "" {
		name := opts.AuthorName
		if name == "" {
			name = "GitJet"
		}
		commitEnv = append(commitEnv,
			"GIT_AUTHOR_NAME="+name,
			"GIT_AUTHOR_EMAIL="+opts.AuthorEmail,
		)
	}
	out, err := r.runEnv(ctx, commitEnv, args...)
	if err != nil {
		return CommitResult{}, err
	}
	hash := strings.TrimSpace(out)
	reason := "commit selected changes"
	if opts.Amend {
		reason = "amend with selected changes"
	}
	if _, err := r.run(ctx, "update-ref", "-m", reason, "HEAD", hash); err != nil {
		return CommitResult{}, err
	}
	// The real index now follows the new HEAD for those paths only, so the
	// selected changes are committed and everything else stays as staged
	// (or unstaged) as it was.
	if _, err := r.run(ctx, append([]string{"reset", "-q", "HEAD", "--"}, literalPaths(clean)...)...); err != nil {
		return CommitResult{}, err
	}
	res := CommitResult{Hash: hash, Short: short(hash), Subject: msg}
	if first := strings.Split(msg, "\n")[0]; first != "" {
		res.Subject = first
	}
	res.Output = fmt.Sprintf("%s %s", short(hash), res.Subject)
	return res, nil
}
