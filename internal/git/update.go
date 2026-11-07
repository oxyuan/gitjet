package git

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// UpstreamOf returns the remote-tracking branch a local branch follows,
// such as "origin/main", or "" when it follows none.
func (r *Repo) UpstreamOf(ctx context.Context, branch string) string {
	name := strings.TrimSpace(branch)
	if name == "" || strings.HasPrefix(name, "-") {
		return ""
	}
	out, err := r.run(ctx, "rev-parse", "--abbrev-ref", name+"@{upstream}")
	if err != nil {
		return ""
	}
	upstream := strings.TrimSpace(out)
	if upstream == "" || upstream == name+"@{upstream}" {
		return ""
	}
	return upstream
}

// UpdateSelected fast-forwards a branch to its upstream without checking
// it out, which is IDEA's "Update Selected". A branch that would need a
// merge is refused: updating in the background must not create commits.
func (r *Repo) UpdateSelected(ctx context.Context, branch string) (string, error) {
	name := strings.TrimSpace(branch)
	if name == "" || strings.HasPrefix(name, "-") {
		return "", errors.New("invalid branch")
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "refs/heads/"+name); err != nil {
		return "", fmt.Errorf("no local branch named %q", name)
	}
	upstream := r.UpstreamOf(ctx, name)
	if upstream == "" {
		return "", fmt.Errorf("%s has no upstream to update from", name)
	}
	remote, _, ok := splitRemoteBranch(r, ctx, upstream)
	if ok {
		if out, err := r.run(ctx, "fetch", "--quiet", remote); err != nil {
			return out, err
		}
	}
	r.write.Lock()
	defer r.write.Unlock()
	if _, err := r.run(ctx, "merge-base", "--is-ancestor", "refs/heads/"+name, upstream); err != nil {
		return "", fmt.Errorf("%s cannot be fast-forwarded to %s: it has local commits", name, upstream)
	}
	if r.currentBranch(ctx) == name {
		out, err := r.run(ctx, "merge", "--ff-only", upstream)
		return out + "\n$ git merge --ff-only " + upstream, err
	}
	if _, err := r.run(ctx, "update-ref", "refs/heads/"+name, upstream); err != nil {
		return "", err
	}
	return "$ git update-ref refs/heads/" + name + " " + upstream, nil
}

// ResetToRemote resets a local branch to its upstream, which is the repair
// for a force-pushed remote branch. The working tree follows when the
// branch is checked out.
func (r *Repo) ResetToRemote(ctx context.Context, branch string) (string, error) {
	name := strings.TrimSpace(branch)
	if name == "" || strings.HasPrefix(name, "-") {
		return "", errors.New("invalid branch")
	}
	upstream := r.UpstreamOf(ctx, name)
	if upstream == "" {
		return "", fmt.Errorf("%s has no upstream", name)
	}
	remote, _, ok := splitRemoteBranch(r, ctx, upstream)
	if ok {
		if out, err := r.run(ctx, "fetch", "--quiet", remote); err != nil {
			return out, err
		}
	}
	r.write.Lock()
	defer r.write.Unlock()
	if r.currentBranch(ctx) == name {
		return r.run(ctx, "reset", "--hard", upstream)
	}
	if _, err := r.run(ctx, "update-ref", "refs/heads/"+name, upstream); err != nil {
		return "", err
	}
	return "$ git update-ref refs/heads/" + name + " " + upstream, nil
}

// PushCommits publishes one commit, and everything below it, to a remote
// branch without checking anything out: "Push commits up to here".
func (r *Repo) PushCommits(ctx context.Context, remote, remoteBranch, hash string) (string, error) {
	hash = strings.TrimSpace(hash)
	remote = strings.TrimSpace(remote)
	remoteBranch = strings.TrimSpace(remoteBranch)
	if hash == "" || strings.HasPrefix(hash, "-") || strings.ContainsAny(hash, " \t\n") {
		return "", errors.New("invalid revision")
	}
	if remote == "" || strings.HasPrefix(remote, "-") {
		return "", errors.New("choose a remote")
	}
	if remoteBranch == "" || strings.HasPrefix(remoteBranch, "-") {
		return "", errors.New("choose the remote branch")
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", hash+"^{commit}"); err != nil {
		return "", fmt.Errorf("%s is not a commit", hash)
	}
	r.write.Lock()
	defer r.write.Unlock()
	return r.run(ctx, "push", remote, hash+":refs/heads/"+remoteBranch)
}

// PushTag publishes one tag.
func (r *Repo) PushTag(ctx context.Context, remote, tag string) (string, error) {
	remote = strings.TrimSpace(remote)
	tag = strings.TrimSpace(tag)
	if remote == "" || remote == "-" || strings.HasPrefix(remote, "-") {
		return "", errors.New("choose a remote")
	}
	if tag == "" || strings.HasPrefix(tag, "-") {
		return "", errors.New("invalid tag")
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "refs/tags/"+tag); err != nil {
		return "", fmt.Errorf("no tag named %q", tag)
	}
	r.write.Lock()
	defer r.write.Unlock()
	out, err := r.run(ctx, "push", remote, "refs/tags/"+tag)
	if err != nil && strings.Contains(err.Error(), "already exists") {
		return out, fmt.Errorf("the tag %q already exists on %s with another value", tag, remote)
	}
	return out, err
}

// currentBranch is the checked-out branch, or "" on a detached HEAD.
func (r *Repo) currentBranch(ctx context.Context) string {
	out, err := r.run(ctx, "symbolic-ref", "-q", "--short", "HEAD")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}
