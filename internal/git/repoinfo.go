package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// operation reports a multi-step git operation waiting to finish, from the
// files git leaves in its directory. The commit panel shows it above the
// change tree, with Continue and Abort actions.
func (r *Repo) operation() (name, progress, detail string) {
	if r.gitDir == "" {
		return "", "", ""
	}
	if state, ok := r.readPlan(); ok && r.planIsCurrent(state) {
		return "rebase-interactive", fmt.Sprintf("%d/%d", state.Index+1, len(state.Steps)), ""
	}
	read := func(rel string) string {
		b, err := os.ReadFile(filepath.Join(r.gitDir, rel))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	firstLine := func(rel string) string {
		s := read(rel)
		if i := strings.IndexByte(s, '\n'); i >= 0 {
			s = s[:i]
		}
		// git prefixes merge messages with "Merge branch ..." and
		// comment lines; keep the first meaningful line.
		for _, line := range strings.Split(s, "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "#") {
				return line
			}
		}
		return ""
	}
	rebaseDir := ""
	for _, d := range []string{"rebase-merge", "rebase-apply"} {
		if st, err := os.Stat(filepath.Join(r.gitDir, d)); err == nil && st.IsDir() {
			rebaseDir = d
			break
		}
	}
	if rebaseDir != "" {
		name := "rebase"
		if _, err := os.Stat(filepath.Join(r.gitDir, rebaseDir, "applying")); err == nil {
			name = "am"
		} else if _, err := os.Stat(filepath.Join(r.gitDir, rebaseDir, "interactive")); err == nil {
			name = "rebase-interactive"
		}
		cur := read(rebaseDir + "/msgnum")
		end := read(rebaseDir + "/end")
		if cur != "" && end != "" {
			progress = cur + "/" + end
		}
		head := strings.TrimPrefix(read(rebaseDir+"/head-name"), "refs/heads/")
		onto := read(rebaseDir + "/onto")
		if len(onto) > 8 {
			onto = onto[:8]
		}
		switch {
		case head != "" && onto != "":
			detail = head + " → " + onto
		case head != "":
			detail = head
		case onto != "":
			detail = onto
		}
		return name, progress, detail
	}
	if _, err := os.Stat(filepath.Join(r.gitDir, "MERGE_HEAD")); err == nil {
		return "merge", "", firstLine("MERGE_MSG")
	}
	if _, err := os.Stat(filepath.Join(r.gitDir, "CHERRY_PICK_HEAD")); err == nil {
		return "cherry-pick", "", short(read("CHERRY_PICK_HEAD"))
	}
	if _, err := os.Stat(filepath.Join(r.gitDir, "REVERT_HEAD")); err == nil {
		return "revert", "", short(read("REVERT_HEAD"))
	}
	if _, err := os.Stat(filepath.Join(r.gitDir, "BISECT_LOG")); err == nil {
		return "bisect", "", ""
	}
	if _, err := os.Stat(filepath.Join(r.gitDir, "sequencer", "todo")); err == nil {
		todo := read("sequencer/todo")
		if strings.Contains(todo, "cherry-pick") {
			return "cherry-pick", "", ""
		}
		if strings.Contains(todo, "revert") {
			return "revert", "", ""
		}
	}
	return "", "", ""
}

func short(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

// refName prefers a local branch that points at rev, then the short hash.
// "dev" tells the user more than "28ccc30".
func (r *Repo) refName(ctx context.Context, rev string) string {
	rev = strings.TrimSpace(rev)
	if rev == "" {
		return ""
	}
	if out, err := r.run(ctx, "for-each-ref", "--points-at", rev, "--format=%(refname:short)", "refs/heads"); err == nil {
		for _, name := range strings.Fields(out) {
			if name != "" {
				return name
			}
		}
	}
	if out, err := r.run(ctx, "rev-parse", "--short", rev); err == nil {
		if name := strings.TrimSpace(out); name != "" {
			return name
		}
	}
	return rev
}

// operationLabels names both sides of the operation in progress, so the
// conflict UI can say "Changes from dev" instead of "Theirs".
func (r *Repo) operationLabels(ctx context.Context) (ours, theirs string) {
	if r.gitDir == "" {
		return "", ""
	}
	read := func(rel string) string {
		b, err := os.ReadFile(filepath.Join(r.gitDir, rel))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	head := func() string {
		if out, err := r.run(ctx, "symbolic-ref", "--short", "-q", "HEAD"); err == nil {
			if name := strings.TrimSpace(out); name != "" {
				return name
			}
		}
		return r.refName(ctx, "HEAD")
	}
	op, _, _ := r.operation()
	switch op {
	case "merge":
		return head(), r.refName(ctx, "MERGE_HEAD")
	case "rebase", "rebase-interactive":
		// A rebase rewrites history the other way round: stage 2 ("ours")
		// is the new base, and stage 3 ("theirs") is the commit being
		// replayed from the branch that is being rebased.
		theirs = strings.TrimPrefix(read("rebase-merge/head-name"), "refs/heads/")
		if theirs == "" {
			theirs = strings.TrimPrefix(read("rebase-apply/head-name"), "refs/heads/")
		}
		onto := read("rebase-merge/onto")
		if onto == "" {
			onto = read("rebase-apply/onto")
		}
		return r.refName(ctx, onto), theirs
	case "cherry-pick":
		return head(), r.refName(ctx, "CHERRY_PICK_HEAD")
	case "revert":
		return head(), r.refName(ctx, "REVERT_HEAD")
	case "am":
		return head(), "mail"
	}
	return "", ""
}

// MergeSide is one revision taking part in a merge, shown by the merge
// editor's "Show details" popup.
type MergeSide struct {
	Branch  string `json:"branch"`
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	Time    int64  `json:"time"`
}

// MergeDetails describes both sides of the operation in progress.
type MergeDetails struct {
	Kind   string    `json:"kind"`
	Ours   MergeSide `json:"ours"`
	Theirs MergeSide `json:"theirs"`
}

// MergeDetails reads the commits both sides of the conflict point at. A
// missing side is left zeroed: rebase and am have no second local commit.
func (r *Repo) MergeDetails(ctx context.Context) (MergeDetails, error) {
	if r.gitDir == "" {
		return MergeDetails{}, errors.New("no repository")
	}
	read := func(rel string) string {
		b, err := os.ReadFile(filepath.Join(r.gitDir, rel))
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	d := MergeDetails{Kind: r.operationName()}
	var oursRev, theirsRev string
	switch d.Kind {
	case "merge":
		oursRev, theirsRev = "HEAD", "MERGE_HEAD"
	case "cherry-pick":
		oursRev, theirsRev = "HEAD", "CHERRY_PICK_HEAD"
	case "revert":
		oursRev, theirsRev = "HEAD", "REVERT_HEAD"
	case "rebase", "rebase-interactive":
		oursRev, theirsRev = read("rebase-merge/onto")+read("rebase-apply/onto"), "HEAD"
	case "am":
		oursRev = "HEAD"
	}
	side := func(rev string) MergeSide {
		if rev == "" {
			return MergeSide{}
		}
		out, err := r.run(ctx, "show", "-s", "--format=%H%x1f%an%x1f%at%x1f%s", rev)
		if err != nil {
			return MergeSide{}
		}
		fields := strings.SplitN(strings.TrimRight(out, "\n"), "\x1f", 4)
		if len(fields) < 4 {
			return MergeSide{}
		}
		s := MergeSide{Branch: r.refName(ctx, rev), Hash: fields[0], Short: short(fields[0]), Author: fields[1], Subject: fields[3]}
		s.Time, _ = strconv.ParseInt(fields[2], 10, 64)
		return s
	}
	d.Ours, d.Theirs = side(oursRev), side(theirsRev)
	return d, nil
}

func (r *Repo) operationName() string {
	name, _, _ := r.operation()
	return name
}

func (r *Repo) remoteURL(ctx context.Context) string {
	for _, remote := range []string{"origin"} {
		if out, err := r.run(ctx, "remote", "get-url", remote); err == nil {
			if u := strings.TrimSpace(out); u != "" {
				return u
			}
		}
	}
	out, err := r.run(ctx, "remote")
	if err != nil {
		return ""
	}
	fields := strings.Fields(out)
	if len(fields) == 0 {
		return ""
	}
	if out, err := r.run(ctx, "remote", "get-url", fields[0]); err == nil {
		return strings.TrimSpace(out)
	}
	return ""
}

func (r *Repo) isShallow(ctx context.Context) bool {
	if _, err := os.Stat(filepath.Join(r.gitDir, "shallow")); err == nil {
		return true
	}
	return false
}

type lineStat struct {
	add, del int
	binary   bool
}

// annotateNumstat adds the number of added and removed lines to each
// change, so the commit dialog can show them without loading a diff.
func (r *Repo) annotateNumstat(ctx context.Context, changes []Change) {
	staged := r.numstat(ctx, true)
	worktree := r.numstat(ctx, false)
	for i := range changes {
		c := &changes[i]
		src := worktree
		if c.Staged {
			src = staged
		}
		if st, ok := src[c.Path]; ok {
			c.Additions, c.Deletions, c.Binary = st.add, st.del, st.binary
		} else if c.Kind == "untracked" {
			add, binary := countLines(r.AbsPath(c.Path))
			c.Additions, c.Binary = add, binary
		}
	}
}

func (r *Repo) numstat(ctx context.Context, cached bool) map[string]lineStat {
	args := []string{"diff", "--numstat", "-z", "--no-color"}
	if cached {
		args = append(args, "--cached")
	}
	out, err := r.run(ctx, args...)
	if err != nil {
		return map[string]lineStat{}
	}
	result := map[string]lineStat{}
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		rec := parts[i]
		if rec == "" {
			continue
		}
		fields := strings.SplitN(rec, "\t", 3)
		if len(fields) < 3 {
			continue
		}
		st := lineStat{binary: fields[0] == "-" || fields[1] == "-"}
		if !st.binary {
			st.add = atoi(fields[0])
			st.del = atoi(fields[1])
		}
		path := fields[2]
		if path == "" {
			if i+2 < len(parts) {
				// Rename: the old path and the new path are separate
				// NUL-terminated fields.
				path = parts[i+2]
				i += 2
			} else {
				continue
			}
		}
		result[path] = st
	}
	return result
}

// countLines counts the lines of a file for untracked files, which git
// diff does not describe. It reports a binary file when it finds a NUL.
func countLines(path string) (int, bool) {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() || st.Size() > 8<<20 {
		return 0, false
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, false
	}
	if bytes.IndexByte(b, 0) >= 0 {
		return 0, true
	}
	if len(b) == 0 {
		return 0, false
	}
	n := bytes.Count(b, []byte{'\n'})
	if b[len(b)-1] != '\n' {
		n++
	}
	return n, false
}
