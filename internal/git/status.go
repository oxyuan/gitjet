package git

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"path/filepath"
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

// Signature is a cheap fingerprint of the working tree and the checked
// out branch. The app polls it to notice changes made outside the app.
func (r *Repo) Signature(ctx context.Context) string {
	out, err := r.run(ctx, "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=normal")
	if err != nil {
		return ""
	}
	sum := sha1.Sum([]byte(out))
	return hex.EncodeToString(sum[:])
}
