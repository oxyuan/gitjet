package git

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Actions of a rewrite plan. They mirror the verbs of an interactive
// rebase, so the dialog can show what git would do.
const (
	PlanPick   = "pick"
	PlanReword = "reword"
	PlanSquash = "squash"
	PlanFixup  = "fixup"
	PlanDrop   = "drop"
)

// PlanCommit is one commit of a rewrite range, oldest first. The range is
// always the last commits of the current branch, so rewriting keeps a
// linear history without guessing where the branch started.
type PlanCommit struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Author  string `json:"author"`
	Time    int64  `json:"time"`
	Subject string `json:"subject"`
	Message string `json:"message"`
	Merge   bool   `json:"merge"`
}

// PlanStep is one line of the plan: which commit, what to do with it, and
// the replacement message for reword and squash.
type PlanStep struct {
	Hash    string `json:"hash"`
	Action  string `json:"action"`
	Message string `json:"message,omitempty"`
}

// planState is the plan that is being replayed, saved in the git dir so a
// conflict can be continued without losing the rest of the plan.
type planState struct {
	Onto     string     `json:"onto"`
	Original string     `json:"original"`
	Steps    []PlanStep `json:"steps"`
	Index    int        `json:"index"`
	// Message is the message of the commit at the tip, which a squash
	// appends to.
	Message string `json:"message"`
}

const planFile = "gitjet-rewrite-plan.json"

// RewritePlan lists the commits that rewriting the branch onto onto would
// replay, oldest first. onto is what the range ends up on top of, so
// "HEAD~3" lists the last three commits.
func (r *Repo) RewritePlan(ctx context.Context, onto string) ([]PlanCommit, error) {
	onto = strings.TrimSpace(onto)
	if onto == "" || strings.HasPrefix(onto, "-") {
		return nil, errors.New("choose the commit the range starts after")
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", onto+"^{commit}"); err != nil {
		return nil, fmt.Errorf("%s is not a commit", onto)
	}
	const sep = "%x1f"
	format := "--format=" + strings.Join([]string{"%H", "%h", "%an", "%at", "%P", "%s", "%B"}, sep) + "%x1e"
	out, err := r.run(ctx, "log", "--reverse", format, onto+"..HEAD")
	if err != nil {
		return nil, err
	}
	commits := []PlanCommit{}
	for _, record := range strings.Split(out, "\x1e") {
		record = strings.TrimLeft(record, "\n")
		if strings.TrimSpace(record) == "" {
			continue
		}
		f := strings.Split(record, "\x1f")
		if len(f) < 7 {
			continue
		}
		commits = append(commits, PlanCommit{
			Hash:    f[0],
			Short:   f[1],
			Author:  f[2],
			Time:    parseInt64(f[3]),
			Merge:   len(strings.Fields(f[4])) > 1,
			Subject: f[5],
			Message: strings.TrimRight(f[6], "\n"),
		})
	}
	return commits, nil
}

// Rewrite replays the commits of the range with the actions of the plan.
// Every commit of the range must appear exactly once, in order; the plan
// is what RewritePlan returned with the actions changed.
//
// The branch is reset onto onto and the commits are cherry-picked in
// sequence: pick keeps a commit, reword replays it with a new message,
// squash folds it into the commit before it with both messages, fixup
// folds it in and keeps the earlier message, drop leaves it out. A
// conflict stops the replay; the rest of the plan is kept in the git dir,
// so ContinueOperation finishes it and AbortOperation rewinds the branch.
func (r *Repo) Rewrite(ctx context.Context, onto string, steps []PlanStep) (string, error) {
	onto = strings.TrimSpace(onto)
	if onto == "" || strings.HasPrefix(onto, "-") {
		return "", errors.New("choose the commit the range starts after")
	}
	if len(steps) == 0 {
		return "", errors.New("the plan is empty")
	}
	commits, err := r.RewritePlan(ctx, onto)
	if err != nil {
		return "", err
	}
	if len(commits) != len(steps) {
		return "", fmt.Errorf("the plan covers %d commits but the range has %d", len(steps), len(commits))
	}
	for i, st := range steps {
		if st.Hash != commits[i].Hash {
			return "", errors.New("the plan does not match the commits of the range")
		}
		switch st.Action {
		case PlanPick, PlanReword, PlanSquash, PlanFixup, PlanDrop:
		default:
			return "", fmt.Errorf("unknown action %q", st.Action)
		}
		if commits[i].Merge && st.Action != PlanDrop {
			return "", fmt.Errorf("%s is a merge commit, which cannot be rewritten", commits[i].Short)
		}
	}
	for _, st := range steps {
		if st.Action == PlanDrop {
			continue
		}
		if st.Action == PlanSquash || st.Action == PlanFixup {
			return "", errors.New("the first kept commit of the range cannot be squashed")
		}
		break
	}

	r.write.Lock()
	defer r.write.Unlock()

	if st, stErr := r.Status(ctx, false); stErr == nil && len(st.Changes) > 0 {
		return "", errors.New("commit or stash your local changes first")
	}

	original, err := r.run(ctx, "rev-parse", "HEAD")
	if err != nil {
		return "", err
	}
	state := &planState{Onto: onto, Original: strings.TrimSpace(original), Steps: steps}
	if _, err := r.run(ctx, "reset", "--hard", onto); err != nil {
		return "", err
	}
	state.Message = r.headMessage(ctx)
	if err := r.writePlan(state); err != nil {
		return "", err
	}
	return r.runPlan(ctx, state, false)
}

// runPlan replays the remaining steps. It expects r.write to be held.
func (r *Repo) runPlan(ctx context.Context, state *planState, committed bool) (string, error) {
	var out strings.Builder
	for state.Index < len(state.Steps) {
		step := state.Steps[state.Index]
		if step.Action == PlanDrop {
			state.Index++
			continue
		}
		if !committed {
			before, _ := r.run(ctx, "rev-parse", "HEAD")
			if _, err := r.cherryPick(ctx, step.Hash); err != nil {
				r.savePlan(state)
				return out.String(), err
			}
			after, _ := r.run(ctx, "rev-parse", "HEAD")
			if strings.TrimSpace(before) == strings.TrimSpace(after) {
				// The commit became empty and git dropped it, so there is
				// nothing to fold.
				state.Index++
				continue
			}
		}
		committed = false
		switch step.Action {
		case PlanReword:
			msg := step.Message
			if strings.TrimSpace(msg) == "" {
				msg = state.Message
			}
			if _, err := r.amendMessage(ctx, msg); err != nil {
				r.savePlan(state)
				return out.String(), err
			}
		case PlanSquash:
			// Squash folds the commit just replayed into the one before it:
			// rewind the branch and amend the earlier commit with the index
			// the cherry-pick produced.
			msg := strings.TrimSpace(step.Message)
			if msg == "" {
				msg = r.commitMessage(ctx, step.Hash)
			}
			combined := strings.TrimRight(state.Message, "\n")
			if combined != "" && msg != "" {
				combined += "\n\n" + msg
			} else if combined == "" {
				combined = msg
			}
			if _, err := r.run(ctx, "reset", "--soft", "HEAD^"); err != nil {
				r.savePlan(state)
				return out.String(), err
			}
			if _, err := r.amendMessage(ctx, combined); err != nil {
				r.savePlan(state)
				return out.String(), err
			}
		case PlanFixup:
			if _, err := r.run(ctx, "reset", "--soft", "HEAD^"); err != nil {
				r.savePlan(state)
				return out.String(), err
			}
			if _, err := r.run(ctx, "commit", "--amend", "--no-edit"); err != nil {
				r.savePlan(state)
				return out.String(), err
			}
		}
		state.Message = r.headMessage(ctx)
		state.Index++
	}
	r.clearPlan()
	return strings.TrimSpace(out.String()), nil
}

// cherryPick replays one commit. A commit that becomes empty because of a
// drop is skipped instead of stopping the plan.
func (r *Repo) cherryPick(ctx context.Context, hash string) (string, error) {
	out, err := r.run(ctx, "cherry-pick", "--empty=drop", hash)
	if err == nil {
		return out, nil
	}
	var gerr *Error
	if errors.As(err, &gerr) && strings.Contains(gerr.Stderr, "unknown option") {
		return r.run(ctx, "cherry-pick", hash)
	}
	return out, err
}

func (r *Repo) amendMessage(ctx context.Context, msg string) (string, error) {
	return r.runInput(ctx, msg, "commit", "--amend", "--allow-empty", "-F", "-")
}

func (r *Repo) headMessage(ctx context.Context) string {
	out, err := r.run(ctx, "log", "-1", "--format=%B")
	if err != nil {
		return ""
	}
	return strings.TrimRight(out, "\n")
}

func (r *Repo) commitMessage(ctx context.Context, hash string) string {
	out, err := r.run(ctx, "log", "-1", "--format=%B", hash)
	if err != nil {
		return ""
	}
	return strings.TrimRight(out, "\n")
}

// planPath is where the running plan is kept. It sits inside the git dir,
// so it follows worktrees and never shows up in status.
func (r *Repo) planPath() string {
	if r.gitDir == "" {
		return ""
	}
	return filepath.Join(r.gitDir, planFile)
}

func (r *Repo) savePlan(state *planState) {
	path := r.planPath()
	if path == "" {
		return
	}
	data, err := json.Marshal(state)
	if err != nil {
		return
	}
	_ = os.WriteFile(path, data, 0o644)
}

// writePlan records a plan; a failure to write it only costs the ability
// to continue after a conflict, so it is not fatal.
func (r *Repo) writePlan(state *planState) error {
	path := r.planPath()
	if path == "" {
		return nil
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (r *Repo) readPlan() (*planState, bool) {
	path := r.planPath()
	if path == "" {
		return nil, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	var state planState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, false
	}
	return &state, true
}

func (r *Repo) clearPlan() {
	if path := r.planPath(); path != "" {
		_ = os.Remove(path)
	}
}

// resumePlan finishes a plan whose step was just committed by
// ContinueOperation. It expects r.write to be held.
func (r *Repo) resumePlan(ctx context.Context, committed bool) (string, error) {
	state, ok := r.readPlan()
	if !ok {
		return "", nil
	}
	if state.Index >= len(state.Steps) {
		r.clearPlan()
		return "", nil
	}
	return r.runPlan(ctx, state, committed)
}

// abortPlan rewinds the branch to where the rewrite started. It expects
// r.write to be held.
func (r *Repo) abortPlan(ctx context.Context) (string, bool, error) {
	state, ok := r.readPlan()
	if !ok {
		return "", false, nil
	}
	r.clearPlan()
	out, err := r.run(ctx, "reset", "--hard", state.Original)
	return strings.TrimSpace(out), true, err
}
