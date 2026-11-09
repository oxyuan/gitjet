package git

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"gitjet/internal/proc"
)

// Actions of a rewrite plan. They mirror the verbs of an interactive
// rebase, so the dialog can show what git would do.
const (
	PlanPick   = "pick"
	PlanReword = "reword"
	PlanSquash = "squash"
	PlanFixup  = "fixup"
	PlanDrop   = "drop"
	// PlanEdit applies the commit and stops, so its content or message can
	// be amended before the rest of the plan continues.
	PlanEdit = "edit"
	// PlanExec runs a shell command at that point of the replay.
	PlanExec = "exec"
	// PlanBreak stops the replay there, like a rebase "break" line.
	PlanBreak = "break"
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
	// Command is the shell line of an exec step.
	Command string `json:"command,omitempty"`
}

// planState is the plan that is being replayed, saved in the git dir so a
// conflict can be continued without losing the rest of the plan.
type planState struct {
	Onto string `json:"onto"`
	// Branch is the branch whose commits the plan rewrites. A plan left
	// behind by a conflict belongs to that branch and to no other.
	Branch   string     `json:"branch"`
	Original string     `json:"original"`
	Steps    []PlanStep `json:"steps"`
	Index    int        `json:"index"`
	// Message is the message of the commit at the tip, which a squash
	// appends to.
	Message string `json:"message"`
	// Head is the tip the plan last produced. It lets a resumed plan tell
	// its own step from a foreign cherry-pick.
	Head string `json:"head"`
	// Paused is set between an applied "edit" commit and the continue that
	// resumes the plan.
	Paused bool `json:"paused"`
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
	// The plan may reorder commits, so it is matched by hash: every commit
	// of the range appears exactly once, in whatever order the user chose.
	// exec and break carry no commit and may sit anywhere between them.
	byHash := make(map[string]PlanCommit, len(commits))
	for _, c := range commits {
		byHash[c.Hash] = c
	}
	seen := make(map[string]bool, len(commits))
	for _, st := range steps {
		switch st.Action {
		case PlanExec:
			if strings.TrimSpace(st.Command) == "" {
				return "", errors.New("an exec step needs a command")
			}
			continue
		case PlanBreak:
			continue
		}
		commit, ok := byHash[st.Hash]
		if !ok || seen[st.Hash] {
			return "", errors.New("the plan does not match the commits of the range")
		}
		seen[st.Hash] = true
		switch st.Action {
		case PlanPick, PlanReword, PlanSquash, PlanFixup, PlanDrop, PlanEdit:
		default:
			return "", fmt.Errorf("unknown action %q", st.Action)
		}
		if commit.Merge && st.Action != PlanDrop {
			return "", fmt.Errorf("%s is a merge commit, which cannot be rewritten", commit.Short)
		}
	}
	if len(seen) != len(commits) {
		return "", fmt.Errorf("the plan covers %d commits but the range has %d", len(seen), len(commits))
	}
	firstKept := false
	for _, st := range steps {
		if st.Action == PlanDrop || st.Action == PlanExec || st.Action == PlanBreak {
			continue
		}
		if st.Action == PlanSquash || st.Action == PlanFixup {
			return "", errors.New("the first kept commit of the range cannot be squashed")
		}
		firstKept = true
		break
	}
	if !firstKept {
		return "", errors.New("the plan drops every commit")
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
	branch := ""
	if out, err := r.run(ctx, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
		branch = strings.TrimSpace(out)
	}
	state := &planState{Onto: onto, Branch: branch, Original: strings.TrimSpace(original), Steps: steps}
	if _, err := r.run(ctx, "reset", "--hard", onto); err != nil {
		return "", err
	}
	state.Message = r.headMessage(ctx)
	if head, err := r.run(ctx, "rev-parse", "HEAD"); err == nil {
		state.Head = strings.TrimSpace(head)
	}
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
		if step.Action == PlanExec {
			commandOut, err := r.runPlanCommand(ctx, step.Command)
			out.WriteString(commandOut)
			if err != nil {
				// git's rebase stops on a failed exec and continue skips it;
				// record that the plan is stopped so Continue can do the same.
				state.Paused = true
				r.savePlan(state)
				return strings.TrimSpace(out.String()), err
			}
			state.Index++
			r.savePlan(state)
			continue
		}
		if step.Action == PlanBreak {
			state.Paused = true
			r.savePlan(state)
			out.WriteString("\nstopped at break")
			return strings.TrimSpace(out.String()), nil
		}
		if step.Action == PlanDrop {
			state.Index++
			r.savePlan(state)
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
				r.savePlan(state)
				continue
			}
		}
		committed = false
		switch step.Action {
		case PlanReword:
			msg := step.Message
			if strings.TrimSpace(msg) == "" {
				// Keep the message of the commit being replayed; the tip
				// message still belongs to the previous step here.
				msg = r.commitMessage(ctx, step.Hash)
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
		if head, err := r.run(ctx, "rev-parse", "HEAD"); err == nil {
			state.Head = strings.TrimSpace(head)
		}
		if step.Action == PlanEdit {
			state.Paused = true
			r.savePlan(state)
			out.WriteString("\nstopped to edit " + step.Hash)
			return strings.TrimSpace(out.String()), nil
		}
		state.Index++
		r.savePlan(state)
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

// runPlanCommand runs one exec step in the working tree. It is the user's
// own command line, so it gets the process environment and no git
// variables of its own.
func (r *Repo) runPlanCommand(ctx context.Context, command string) (string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return "", errors.New("an exec step needs a command")
	}
	shell, flag := "sh", "-c"
	if runtime.GOOS == "windows" {
		shell, flag = "cmd", "/c"
	}
	cmd := exec.CommandContext(ctx, shell, flag, command)
	cmd.Dir = r.dir
	cmd.Env = os.Environ()
	proc.HideConsole(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	combined := stdout.String()
	if text := strings.TrimSpace(stderr.String()); text != "" {
		if combined != "" && !strings.HasSuffix(combined, "\n") {
			combined += "\n"
		}
		combined += text + "\n"
	}
	if err != nil {
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return combined, fmt.Errorf("exec %q failed: %w", command, err)
	}
	return combined, nil
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
	if !r.planIsCurrent(state) {
		// The plan belongs to another branch, or its step is no longer in
		// git: resetting here would destroy unrelated work.
		r.clearPlan()
		return "", false, nil
	}
	r.clearPlan()
	out, err := r.run(ctx, "reset", "--hard", state.Original)
	return strings.TrimSpace(out), true, err
}

// headBranchName is the checked-out branch, or "" on a detached HEAD. It
// reads HEAD itself, so the answer costs no git process.
func (r *Repo) headBranchName() string {
	if r.gitDir == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(r.gitDir, "HEAD"))
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(b))
	const prefix = "ref: refs/heads/"
	if strings.HasPrefix(line, prefix) {
		return strings.TrimPrefix(line, prefix)
	}
	return ""
}

// pendingPick is the commit git stopped a cherry-pick on.
func (r *Repo) pendingPick() string {
	if r.gitDir == "" {
		return ""
	}
	b, err := os.ReadFile(filepath.Join(r.gitDir, "CHERRY_PICK_HEAD"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// planIsCurrent reports whether the saved plan still describes this
// checkout. A plan outlives a crash or an external abort, so a plan for
// another branch, or one whose step is no longer the commit git stopped
// on, must not be replayed or aborted.
func (r *Repo) planIsCurrent(state *planState) bool {
	if state == nil || state.Index >= len(state.Steps) {
		return false
	}
	if r.headBranchName() != state.Branch {
		return false
	}
	if state.Paused {
		return true
	}
	step := state.Steps[state.Index]
	if step.Action == PlanExec || step.Action == PlanBreak {
		// These steps have no commit git could be stopped on; the branch
		// and the plan position are the identity.
		return r.pendingPick() == ""
	}
	pick := r.pendingPick()
	return pick != "" && strings.EqualFold(pick, step.Hash)
}
