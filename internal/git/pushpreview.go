package git

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

// PushPreview is what the push confirmation shows before anything leaves
// the machine: the commits and files that would travel, and the branch on
// the other side they would land on.
type PushPreview struct {
	Branch       string       `json:"branch"`
	Remote       string       `json:"remote"`
	RemoteBranch string       `json:"remoteBranch"`
	Upstream     string       `json:"upstream"`
	Creates      bool         `json:"creates"`
	Ahead        int          `json:"ahead"`
	Behind       int          `json:"behind"`
	Base         string       `json:"base"`
	Head         string       `json:"head"`
	Commits      []Commit     `json:"commits"`
	Files        []CommitFile `json:"files"`
	Truncated    bool         `json:"truncated"`
}

// pushPreviewLimit caps the commit list; Ahead still carries the real
// number, so the dialog can say that it is showing a window.
const pushPreviewLimit = 200

// PushPreview reports what pushing branch to remote would publish.
//
// The comparison point is the remote-tracking ref of that branch when it
// exists. A branch the remote does not know yet has no such ref, so the
// closest ref of the same remote stands in: pushing a fresh branch should
// list the branch's own work, not the history it was cut from.
func (r *Repo) PushPreview(ctx context.Context, remote, branch string) (PushPreview, error) {
	remote = strings.TrimSpace(remote)
	branch = strings.TrimSpace(branch)
	if remote == "" {
		remote = "origin"
	}
	if branch == "" {
		return PushPreview{}, errors.New("choose a branch to push")
	}
	if strings.HasPrefix(branch, "-") || strings.ContainsAny(branch, " \t\n") {
		return PushPreview{}, errors.New("that is not a branch name")
	}
	local := "refs/heads/" + branch
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", local); err != nil {
		return PushPreview{}, errors.New("there is no local branch called " + branch)
	}

	p := PushPreview{
		Branch:       branch,
		Remote:       remote,
		RemoteBranch: remote + "/" + branch,
		Commits:      []Commit{},
		Files:        []CommitFile{},
	}
	if out, err := r.run(ctx, "for-each-ref", "--format=%(upstream:short)", local); err == nil {
		p.Upstream = strings.TrimSpace(out)
	}

	other := ""
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "refs/remotes/"+remote+"/"+branch); err == nil {
		other = "refs/remotes/" + remote + "/" + branch
	} else {
		p.Creates = true
		other = r.closestRemoteRef(ctx, remote, p.Upstream)
	}

	if out, err := r.run(ctx, "rev-parse", "--short", local); err == nil {
		p.Head = strings.TrimSpace(out)
	}

	if other != "" {
		p.Ahead = r.countCommits(ctx, other+".."+branch)
		p.Behind = r.countCommits(ctx, branch+".."+other)
		if out, err := r.run(ctx, "merge-base", branch, other); err == nil {
			p.Base = strings.TrimSpace(out)
		}
	} else {
		p.Ahead = r.countCommits(ctx, branch)
	}

	args := []string{"log", "--no-color", "--no-show-signature", "--max-count=" + strconv.Itoa(pushPreviewLimit+1), logFormat}
	if other != "" {
		args = append(args, other+".."+branch)
	} else {
		args = append(args, branch)
	}
	if out, err := r.run(ctx, args...); err == nil {
		p.Commits = parseLogCommits(out)
	}
	if len(p.Commits) > pushPreviewLimit {
		p.Truncated = true
		p.Commits = p.Commits[:pushPreviewLimit]
	}

	from := p.Base
	if from == "" {
		from = emptyTree
	}
	if files, err := r.diffFiles(ctx, from, branch); err == nil {
		p.Files = files
	}
	return p, nil
}

// closestRemoteRef picks the remote-tracking ref a new branch most likely
// grew from: its configured upstream, then the remote's HEAD, then the
// newest ref of that remote.
func (r *Repo) closestRemoteRef(ctx context.Context, remote, upstream string) string {
	if strings.HasPrefix(upstream, remote+"/") {
		if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "refs/remotes/"+upstream); err == nil {
			return "refs/remotes/" + upstream
		}
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "refs/remotes/"+remote+"/HEAD"); err == nil {
		return "refs/remotes/" + remote + "/HEAD"
	}
	out, err := r.run(ctx, "for-each-ref", "--sort=-committerdate", "--count=1", "--format=%(refname)", "refs/remotes/"+remote)
	if err != nil {
		return ""
	}
	ref := strings.TrimSpace(out)
	if ref == "" || strings.HasSuffix(ref, "/HEAD") {
		return ""
	}
	return ref
}

// countCommits counts a revision range, and returns 0 when git cannot
// answer (a range whose ends are unrelated, for one).
func (r *Repo) countCommits(ctx context.Context, revRange string) int {
	out, err := r.run(ctx, "rev-list", "--count", revRange)
	if err != nil {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(out))
	return n
}
