package git

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RepoState is the headline of a repository: where it is, what is checked
// out, how it stands against its upstream, and whether an operation such
// as a merge or a rebase is waiting for the user.
type RepoState struct {
	Open       bool   `json:"open"`
	Root       string `json:"root"`
	Name       string `json:"name"`
	GitDir     string `json:"gitDir"`
	Branch     string `json:"branch"`
	Upstream   string `json:"upstream"`
	Head       string `json:"head"`
	ShortHead  string `json:"shortHead"`
	Detached   bool   `json:"detached"`
	Unborn     bool   `json:"unborn"`
	Ahead      int    `json:"ahead"`
	Behind     int    `json:"behind"`
	Operation  string `json:"operation"`
	OpProgress string `json:"opProgress"`
	OpDetail   string `json:"opDetail"`
	OpOurs     string `json:"opOurs"`
	OpTheirs   string `json:"opTheirs"`
	Changed    int    `json:"changed"`
	Staged     int    `json:"staged"`
	Untracked  int    `json:"untracked"`
	Conflicts  int    `json:"conflicts"`
	RemoteURL  string `json:"remoteUrl"`
	GitVersion string `json:"gitVersion"`
	GitExe     string `json:"gitExe"`
	Shallow    bool   `json:"shallow"`
}

// Change is one side of a path's status: its index side or its working
// tree side. A file that is both staged and modified appears twice, once
// in the staged group and once in the local changes.
type Change struct {
	Path         string `json:"path"`
	OldPath      string `json:"oldPath,omitempty"`
	Index        string `json:"index"`    // X: '.', 'M', 'A', 'D', 'R', 'C', 'U', '?', '!'
	WorkTree     string `json:"workTree"` // Y
	Staged       bool   `json:"staged"`   // the index side
	Unmerged     bool   `json:"unmerged"`
	ConflictCode string `json:"conflictCode,omitempty"`
	Kind         string `json:"kind"` // modified, added, deleted, renamed, copied, conflict, untracked, ignored, typechange
	Additions    int    `json:"additions"`
	Deletions    int    `json:"deletions"`
	Binary       bool   `json:"binary"`
}

// Conflict is an unmerged path, with the three stages git recorded.
type Conflict struct {
	Path   string `json:"path"`
	Code   string `json:"code"` // UU, AA, DU, UD, AU, UA, DD
	Ours   bool   `json:"ours"`
	Theirs bool   `json:"theirs"`
	Base   bool   `json:"base"`
	// OursState and TheirsState describe what each side did to the path:
	// "modified", "added" or "deleted". The conflicts dialog shows them.
	OursState   string `json:"oursState"`
	TheirsState string `json:"theirsState"`
	// Markers is the number of conflict blocks still left in the working
	// file, so the dialog can show how much of the file is still unresolved.
	Markers int `json:"markers"`
}

// Stash is one entry of the stash list.
type Stash struct {
	Index   int    `json:"index"`
	Ref     string `json:"ref"`
	Hash    string `json:"hash"`
	Time    int64  `json:"time"`
	Message string `json:"message"`
}

// Changelist is an app-level grouping of local changes. Git knows nothing
// about it: it lives in the app's repository metadata.
type Changelist struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Comment string   `json:"comment"`
	Default bool     `json:"default"`
	Paths   []string `json:"paths"`
}

// Changelists is the grouping of the current local changes.
type Changelists struct {
	Active string       `json:"active"`
	Items  []Changelist `json:"items"`
}

// ChangesSnapshot is everything the Commit tool window shows.
type ChangesSnapshot struct {
	State       RepoState   `json:"state"`
	Changes     []Change    `json:"changes"`
	Conflicts   []Conflict  `json:"conflicts"`
	Stashes     []Stash     `json:"stashes"`
	Changelists Changelists `json:"changelists"`
}

// StatusResult is the parsed output of `git status --porcelain=v2 --branch`.
type StatusResult struct {
	State   RepoState `json:"state"`
	Changes []Change  `json:"changes"`
}

// Status runs git status and returns the state with every change, split
// into its index side and its working tree side.
func (r *Repo) Status(ctx context.Context, includeIgnored bool) (StatusResult, error) {
	args := []string{"status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"}
	if includeIgnored {
		args = append(args, "--ignored=matching")
	}
	out, err := r.run(ctx, args...)
	if err != nil {
		return StatusResult{}, err
	}
	s := parseStatus(out)
	s.State.Open = true
	s.State.Root = r.dir
	s.State.Name = filepath.Base(r.dir)
	s.State.GitDir = r.gitDir
	s.State.GitVersion = r.version
	s.State.GitExe = r.git
	s.State.RemoteURL = r.remoteURL(ctx)
	s.State.Shallow = r.isShallow(ctx)
	s.State.Operation, s.State.OpProgress, s.State.OpDetail = r.operation()
	s.State.OpOurs, s.State.OpTheirs = r.operationLabels(ctx)
	if s.State.Detached && s.State.Head != "" {
		s.State.OpDetail = strings.TrimSpace(s.State.OpDetail)
	}
	for _, c := range s.Changes {
		if c.Staged {
			s.State.Staged++
		}
		switch c.Kind {
		case "untracked":
			s.State.Untracked++
		case "conflict":
			s.State.Conflicts++
		}
		if !c.Staged && !c.Unmerged && c.Kind != "untracked" && c.Kind != "ignored" {
			s.State.Changed++
		}
	}
	// Conflicts also count as local changes.
	s.State.Changed += s.State.Conflicts
	// Annotate line counts, which the commit dialog shows next to files.
	r.annotateNumstat(ctx, s.Changes)
	return s, nil
}

func parseStatus(out string) StatusResult {
	var s StatusResult
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		p := parts[i]
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, "# ") {
			parseStatusHeader(&s.State, p[2:])
			continue
		}
		switch p[0] {
		case '1':
			f := strings.SplitN(p, " ", 9)
			if len(f) < 9 {
				continue
			}
			s.Changes = append(s.Changes, changeSides(f[1], f[8], "")...)
		case '2':
			f := strings.SplitN(p, " ", 10)
			if len(f) < 10 {
				continue
			}
			orig := ""
			if i+1 < len(parts) {
				i++
				orig = parts[i]
			}
			s.Changes = append(s.Changes, changeSides(f[1], f[9], orig)...)
		case 'u':
			f := strings.SplitN(p, " ", 11)
			if len(f) < 11 {
				continue
			}
			c := Change{Path: f[10], Index: f[1][:1], WorkTree: f[1][1:], Unmerged: true, ConflictCode: f[1], Kind: "conflict"}
			s.Changes = append(s.Changes, c)
		case '?':
			path := strings.TrimPrefix(p, "? ")
			s.Changes = append(s.Changes, Change{Path: path, Index: "?", WorkTree: "?", Kind: "untracked"})
		case '!':
			path := strings.TrimPrefix(p, "! ")
			s.Changes = append(s.Changes, Change{Path: path, Index: "!", WorkTree: "!", Kind: "ignored"})
		}
	}
	return s
}

// renamePairs maps a renamed path to the path HEAD still has. Porcelain v2
// reports a rename once, with the new path and its origin beside it.
func (r *Repo) renamePairs(ctx context.Context) map[string]string {
	pairs := map[string]string{}
	out, err := r.run(ctx, "status", "--porcelain=v2", "-z", "--untracked-files=all")
	if err != nil {
		return pairs
	}
	for _, c := range parseStatus(out).Changes {
		if c.OldPath != "" && c.OldPath != c.Path {
			pairs[c.Path] = c.OldPath
		}
	}
	return pairs
}

// expandRenames adds the other half of every rename the caller selected.
// Git records a rename as one path but staging, unstaging or discarding it
// has to name both the new and the old path, or half the change stays
// behind in the index.
func (r *Repo) expandRenames(ctx context.Context, paths []string) []string {
	pairs := r.renamePairs(ctx)
	seen := make(map[string]bool, len(paths)*2)
	out := make([]string, 0, len(paths)*2)
	add := func(p string) {
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, p := range paths {
		add(p)
	}
	for newPath, oldPath := range pairs {
		if seen[newPath] || seen[oldPath] {
			add(newPath)
			add(oldPath)
		}
	}
	sort.Strings(out)
	return out
}

func parseStatusHeader(state *RepoState, line string) {
	switch {
	case strings.HasPrefix(line, "branch.oid "):
		oid := strings.TrimSpace(strings.TrimPrefix(line, "branch.oid "))
		if oid == "(initial)" {
			state.Unborn = true
			return
		}
		state.Head = oid
		if len(oid) >= 8 {
			state.ShortHead = oid[:8]
		} else {
			state.ShortHead = oid
		}
	case strings.HasPrefix(line, "branch.head "):
		head := strings.TrimSpace(strings.TrimPrefix(line, "branch.head "))
		if head == "(detached)" {
			state.Detached = true
			return
		}
		state.Branch = head
	case strings.HasPrefix(line, "branch.upstream "):
		state.Upstream = strings.TrimSpace(strings.TrimPrefix(line, "branch.upstream "))
	case strings.HasPrefix(line, "branch.ab "):
		fields := strings.Fields(strings.TrimPrefix(line, "branch.ab "))
		for _, f := range fields {
			if strings.HasPrefix(f, "+") {
				state.Ahead = atoi(f[1:])
			} else if strings.HasPrefix(f, "-") {
				state.Behind = atoi(f[1:])
			}
		}
	}
}

// changeSides turns porcelain v2's two status letters into the sides that
// changed: the index side, the working tree side, or both. An untracked
// or ignored file has no index side.
func changeSides(xy, path, orig string) []Change {
	var x, y byte = '.', '.'
	if len(xy) > 0 {
		x = xy[0]
	}
	if len(xy) > 1 {
		y = xy[1]
	}
	if x == '?' || x == '!' {
		return []Change{{Path: path, Index: string(x), WorkTree: string(x), Kind: kindOf(x)}}
	}
	out := make([]Change, 0, 2)
	if x != '.' && x != ' ' {
		out = append(out, Change{
			Path: path, OldPath: orig, Index: string(x), WorkTree: ".",
			Staged: true, Kind: kindOf(x),
		})
	}
	if y != '.' && y != ' ' {
		out = append(out, Change{
			Path: path, OldPath: orig, Index: ".", WorkTree: string(y), Kind: kindOf(y),
		})
	}
	return out
}

func kindOf(status byte) string {
	switch status {
	case 'M':
		return "modified"
	case 'T':
		return "typechange"
	case 'A':
		return "added"
	case 'D':
		return "deleted"
	case 'R':
		return "renamed"
	case 'C':
		return "copied"
	case 'U':
		return "conflict"
	case '?':
		return "untracked"
	case '!':
		return "ignored"
	}
	return "modified"
}

// signatureStats caps how many changed files the poll stats on every
// tick; past it the status listing alone is the fingerprint.
const signatureStats = 5000

// Signature is a fingerprint of the working tree and the checked out
// branch. The app polls it to notice changes made outside the app.
//
// The porcelain records name changed paths but not their content, so a
// file edited twice in a row keeps the same status line. Size and
// modification time of each listed path are hashed along with it, which
// is what makes an edit inside one already-changed file visible.
func (r *Repo) Signature(ctx context.Context) string {
	out, err := r.run(ctx, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all")
	if err != nil {
		return ""
	}
	h := sha1.New()
	h.Write([]byte(out))
	paths := signaturePaths(parseStatus(out).Changes)
	if len(paths) <= signatureStats {
		for _, p := range paths {
			info, err := os.Stat(r.AbsPath(p))
			if err != nil {
				continue
			}
			fmt.Fprintf(h, "%s\x00%d\x00%d\x00", p, info.Size(), info.ModTime().UnixNano())
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

// signaturePaths lists each path a status record mentions, the old side
// of a rename included.
func signaturePaths(changes []Change) []string {
	seen := map[string]bool{}
	paths := make([]string, 0, len(changes))
	for _, c := range changes {
		for _, p := range []string{c.Path, c.OldPath} {
			if p != "" && !seen[p] {
				seen[p] = true
				paths = append(paths, p)
			}
		}
	}
	return paths
}
