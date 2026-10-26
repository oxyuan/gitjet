package git

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

// Commit is one commit of the log.
type Commit struct {
	Hash           string      `json:"hash"`
	Short          string      `json:"short"`
	Parents        []string    `json:"parents"`
	Author         string      `json:"author"`
	AuthorEmail    string      `json:"authorEmail"`
	AuthorTime     int64       `json:"authorTime"`
	Committer      string      `json:"committer"`
	CommitterEmail string      `json:"committerEmail"`
	CommitTime     int64       `json:"commitTime"`
	Subject        string      `json:"subject"`
	Body           string      `json:"body"`
	Message        string      `json:"message"`
	Refs           []CommitRef `json:"refs"`
}

// CommitRef is a branch or tag pointing at a commit.
type CommitRef struct {
	Name string `json:"name"`
	Type string `json:"type"` // local, remote, tag, head
	Head bool   `json:"head"`
}

// LogOptions selects commits.
type LogOptions struct {
	All         bool     `json:"all"`
	Refs        []string `json:"refs"`
	Path        string   `json:"path"`
	Search      string   `json:"search"`
	Author      string   `json:"author"`
	Since       int64    `json:"since"`
	Limit       int      `json:"limit"`
	Skip        int      `json:"skip"`
	FirstParent bool     `json:"firstParent"`
}

// LogResult is a page of commits.
type LogResult struct {
	Commits []Commit  `json:"commits"`
	HasMore bool      `json:"hasMore"`
	Refs    []RepoRef `json:"refs"`
	// Head is the current branch, so the graph can mark it.
	Head     string `json:"head"`
	Detached bool   `json:"detached"`
}

// RepoRef is a branch or tag, with where it points and how it stands
// against its upstream.
type RepoRef struct {
	Name     string `json:"name"`
	FullName string `json:"fullName"`
	Type     string `json:"type"` // local, remote, tag
	Hash     string `json:"hash"`
	Short    string `json:"short"`
	Subject  string `json:"subject"`
	Time     int64  `json:"time"`
	Upstream string `json:"upstream"`
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	Head     bool   `json:"head"`
	Symbolic bool   `json:"symbolic"`
	Remote   string `json:"remote"`
}

// RefsSnapshot is every branch and tag of the repository.
type RefsSnapshot struct {
	Local    []RepoRef `json:"local"`
	Remote   []RepoRef `json:"remote"`
	Tags     []RepoRef `json:"tags"`
	Current  string    `json:"current"`
	Detached bool      `json:"detached"`
	Head     string    `json:"head"`
}

// Remote is a configured remote.
type Remote struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	PushURL string `json:"pushUrl"`
}

// Log returns a page of commits, newest first.
func (r *Repo) Log(ctx context.Context, opts LogOptions) (LogResult, error) {
	if opts.Limit <= 0 || opts.Limit > 2000 {
		opts.Limit = 300
	}
	args := []string{"log", "--topo-order", "--no-color", "--no-show-signature"}
	if opts.FirstParent {
		args = append(args, "--first-parent")
	}
	if opts.All {
		// Every local and remote branch: work that was never merged or
		// pushed still has to show up in the history.
		args = append(args, "--branches", "--remotes")
	}
	if opts.Search != "" {
		args = append(args, "-i", "--grep="+opts.Search)
	}
	if opts.Author != "" {
		args = append(args, "--author="+opts.Author)
	}
	if opts.Since > 0 {
		args = append(args, "--since=@"+strconv.FormatInt(opts.Since, 10))
	}
	args = append(args, "--max-count="+strconv.Itoa(opts.Limit+1))
	if opts.Skip > 0 {
		args = append(args, "--skip="+strconv.Itoa(opts.Skip))
	}
	args = append(args, "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s%x1f%b%x1e")
	if len(opts.Refs) > 0 && !opts.All {
		args = append(args, opts.Refs...)
	}
	if opts.Path != "" {
		path, err := cleanPath(opts.Path)
		if err != nil {
			return LogResult{}, err
		}
		args = append(args, "--", path)
	}
	out, err := r.run(ctx, args...)
	if err != nil {
		return LogResult{}, err
	}
	result := LogResult{}
	for _, rec := range strings.Split(out, "\x1e") {
		rec = strings.TrimLeft(rec, "\n")
		if strings.TrimSpace(rec) == "" {
			continue
		}
		fields := strings.SplitN(rec, "\x1f", 11)
		if len(fields) < 10 {
			continue
		}
		c := Commit{
			Hash:           fields[0],
			Short:          short(fields[0]),
			Parents:        strings.Fields(fields[1]),
			Author:         fields[2],
			AuthorEmail:    fields[3],
			AuthorTime:     parseInt64(fields[4]),
			Committer:      fields[5],
			CommitterEmail: fields[6],
			CommitTime:     parseInt64(fields[7]),
			Subject:        fields[9],
		}
		if c.Parents == nil {
			c.Parents = []string{}
		}
		if len(fields) > 10 {
			c.Body = strings.TrimRight(fields[10], "\n")
		}
		c.Message = c.Subject
		if c.Body != "" {
			c.Message += "\n\n" + c.Body
		}
		c.Refs = parseRefDecorations(fields[8])
		result.Commits = append(result.Commits, c)
	}
	if len(result.Commits) > opts.Limit {
		result.HasMore = true
		result.Commits = result.Commits[:opts.Limit]
	}
	refs, err := r.Refs(ctx)
	if err == nil {
		result.Refs = append(append(append([]RepoRef{}, refs.Local...), refs.Remote...), refs.Tags...)
		result.Head = refs.Current
		result.Detached = refs.Detached
	}
	return result, nil
}

func parseInt64(s string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n
}

func parseRefDecorations(s string) []CommitRef {
	s = strings.TrimSpace(s)
	if s == "" {
		return []CommitRef{}
	}
	out := []CommitRef{}
	for _, part := range strings.Split(s, ", ") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		ref := CommitRef{}
		switch {
		case strings.HasPrefix(part, "HEAD -> "):
			ref.Name = strings.TrimPrefix(part, "HEAD -> ")
			ref.Type = "head"
			ref.Head = true
		case part == "HEAD":
			ref.Name = "HEAD"
			ref.Type = "head"
			ref.Head = true
		case strings.HasPrefix(part, "tag: "):
			ref.Name = strings.TrimPrefix(part, "tag: ")
			ref.Type = "tag"
		case strings.HasPrefix(part, "refs/heads/"):
			ref.Name = strings.TrimPrefix(part, "refs/heads/")
			ref.Type = "local"
		case strings.HasPrefix(part, "refs/remotes/"):
			ref.Name = strings.TrimPrefix(part, "refs/remotes/")
			ref.Type = "remote"
		default:
			if strings.Contains(part, "/") {
				ref.Type = "remote"
			} else {
				ref.Type = "local"
			}
			ref.Name = part
		}
		out = append(out, ref)
	}
	return out
}

// Refs lists local branches, remote branches and tags.
func (r *Repo) Refs(ctx context.Context) (RefsSnapshot, error) {
	format := strings.Join([]string{
		"%(refname)", "%(objectname)", "%(upstream)", "%(upstream:track)",
		"%(HEAD)", "%(committerdate:unix)", "%(subject)", "%(symref)",
		"%(refname:short)", "%(*objectname)",
	}, "%00")
	out, err := r.run(ctx, "for-each-ref", "--format="+format, "refs/heads", "refs/remotes", "refs/tags")
	if err != nil {
		return RefsSnapshot{}, err
	}
	var snap RefsSnapshot
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		f := strings.Split(line, "\x00")
		if len(f) < 10 {
			continue
		}
		full := f[0]
		ref := RepoRef{
			FullName: full,
			Name:     f[8],
			Hash:     f[1],
			Short:    short(f[1]),
			Upstream: strings.TrimPrefix(f[2], "refs/remotes/"),
			Subject:  f[6],
			Time:     parseInt64(f[5]),
			Head:     f[4] == "*",
			Symbolic: f[7] != "",
		}
		if ref.Upstream == "" {
			ref.Upstream = strings.TrimPrefix(f[2], "refs/heads/")
		}
		ref.Ahead, ref.Behind = parseTrack(f[3])
		switch {
		case strings.HasPrefix(full, "refs/heads/"):
			ref.Type = "local"
			snap.Local = append(snap.Local, ref)
			if ref.Head {
				snap.Current = ref.Name
			}
		case strings.HasPrefix(full, "refs/remotes/"):
			ref.Type = "remote"
			if i := strings.IndexByte(ref.Name, '/'); i > 0 {
				ref.Remote = ref.Name[:i]
			}
			snap.Remote = append(snap.Remote, ref)
		case strings.HasPrefix(full, "refs/tags/"):
			ref.Type = "tag"
			snap.Tags = append(snap.Tags, ref)
		}
	}
	if out, err := r.run(ctx, "rev-parse", "--verify", "--short", "HEAD"); err == nil {
		snap.Head = strings.TrimSpace(out)
	}
	if snap.Current == "" {
		snap.Detached = snap.Head != ""
		if snap.Detached {
			snap.Current = snap.Head
		}
	}
	return snap, nil
}

func parseTrack(s string) (ahead, behind int) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		switch {
		case strings.HasPrefix(part, "ahead "):
			ahead = atoi(strings.TrimPrefix(part, "ahead "))
		case strings.HasPrefix(part, "behind "):
			behind = atoi(strings.TrimPrefix(part, "behind "))
		case strings.HasPrefix(part, "gone"):
			ahead, behind = -1, -1
		}
	}
	return ahead, behind
}

// CommitDetail is everything the log's details pane shows about a commit.
type CommitDetail struct {
	Commit
	Files []CommitFile `json:"files"`
	Stats CommitStats  `json:"stats"`
	// Branches lists the local and remote branches whose history contains
	// this commit, the current branch first.
	Branches []string `json:"branches"`
}

// CommitFile is a path a commit changed.
type CommitFile struct {
	Path      string `json:"path"`
	OldPath   string `json:"oldPath,omitempty"`
	Status    string `json:"status"` // added, modified, deleted, renamed, copied, typechange
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Binary    bool   `json:"binary"`
}

// CommitStats sums a commit's changes.
type CommitStats struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
	Files     int `json:"files"`
}

// ShowCommit returns a commit with its changed files.
func (r *Repo) ShowCommit(ctx context.Context, hash string) (CommitDetail, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" || strings.ContainsAny(hash, " \t\n") {
		return CommitDetail{}, errors.New("invalid revision")
	}
	out, err := r.run(ctx, "show", "-s", "--no-color", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s%x1f%b", hash)
	if err != nil {
		return CommitDetail{}, err
	}
	fields := strings.SplitN(strings.TrimRight(out, "\n"), "\x1f", 11)
	if len(fields) < 10 {
		return CommitDetail{}, errors.New("cannot read the commit")
	}
	c := Commit{
		Hash: fields[0], Short: short(fields[0]), Parents: strings.Fields(fields[1]),
		Author: fields[2], AuthorEmail: fields[3], AuthorTime: parseInt64(fields[4]),
		Committer: fields[5], CommitterEmail: fields[6], CommitTime: parseInt64(fields[7]),
		Subject: fields[9],
	}
	if c.Parents == nil {
		c.Parents = []string{}
	}
	if len(fields) > 10 {
		c.Body = strings.TrimRight(fields[10], "\n")
	}
	c.Message = c.Subject
	if c.Body != "" {
		c.Message += "\n\n" + c.Body
	}
	c.Refs = parseRefDecorations(fields[8])
	detail := CommitDetail{Commit: c}
	files, err := r.commitFiles(ctx, c)
	if err != nil {
		return detail, err
	}
	detail.Files = files
	for _, f := range files {
		detail.Stats.Additions += f.Additions
		detail.Stats.Deletions += f.Deletions
	}
	detail.Stats.Files = len(files)
	detail.Branches = r.branchesContaining(ctx, c.Hash)
	return detail, nil
}

// branchesContaining names the branches that contain a commit. It is a
// best-effort detail: a failure leaves the list empty rather than failing
// the whole commit.
func (r *Repo) branchesContaining(ctx context.Context, hash string) []string {
	out, err := r.run(ctx, "branch", "-a", "--contains", hash, "--format=%(HEAD)%(refname)")
	if err != nil {
		return []string{}
	}
	names := []string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		current := strings.HasPrefix(line, "*")
		full := strings.TrimSpace(strings.TrimPrefix(line, "*"))
		var name string
		switch {
		case strings.HasPrefix(full, "refs/heads/"):
			name = strings.TrimPrefix(full, "refs/heads/")
		case strings.HasPrefix(full, "refs/remotes/"):
			name = strings.TrimPrefix(full, "refs/remotes/")
			// A remote's HEAD is a symbolic alias, not a branch.
			if strings.HasSuffix(name, "/HEAD") {
				continue
			}
		default:
			continue
		}
		if current {
			names = append([]string{name}, names...)
			continue
		}
		names = append(names, name)
	}
	return names
}

// commitFiles lists the files a commit changed against its first parent
// and counts their lines with numstat.
func (r *Repo) commitFiles(ctx context.Context, c Commit) ([]CommitFile, error) {
	args := []string{"diff", "--name-status", "-z", "-M", "--no-color"}
	if len(c.Parents) == 0 {
		args = append(args, "4b825dc642cb6eb9a060e54bf8d69288fbee4904", c.Hash)
	} else {
		args = append(args, c.Parents[0], c.Hash)
	}
	out, err := r.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	var files []CommitFile
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		status := parts[i]
		if status == "" {
			continue
		}
		code := status[0]
		switch code {
		case 'R', 'C':
			if i+2 >= len(parts) {
				continue
			}
			oldPath, newPath := parts[i+1], parts[i+2]
			i += 2
			files = append(files, CommitFile{Path: newPath, OldPath: oldPath, Status: statusName(code)})
		case 'A', 'D', 'M', 'T':
			if i+1 >= len(parts) {
				continue
			}
			files = append(files, CommitFile{Path: parts[i+1], Status: statusName(code)})
			i++
		}
	}
	numArgs := []string{"diff", "--numstat", "-z", "--no-color"}
	if len(c.Parents) == 0 {
		numArgs = append(numArgs, "4b825dc642cb6eb9a060e54bf8d69288fbee4904", c.Hash)
	} else {
		numArgs = append(numArgs, c.Parents[0], c.Hash)
	}
	if statOut, err := r.run(ctx, numArgs...); err == nil {
		stats := parseNumstat(statOut)
		for i := range files {
			if st, ok := stats[files[i].Path]; ok {
				files[i].Additions, files[i].Deletions, files[i].Binary = st.add, st.del, st.binary
			}
		}
	}
	return files, nil
}

func statusName(code byte) string {
	switch code {
	case 'A':
		return "added"
	case 'D':
		return "deleted"
	case 'R':
		return "renamed"
	case 'C':
		return "copied"
	case 'T':
		return "typechange"
	}
	return "modified"
}

func parseNumstat(out string) map[string]lineStat {
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
			st.add, st.del = atoi(fields[0]), atoi(fields[1])
		}
		path := fields[2]
		if path == "" {
			if i+2 >= len(parts) {
				continue
			}
			path = parts[i+2]
			i += 2
		}
		result[path] = st
	}
	return result
}

// Remotes lists configured remotes.
func (r *Repo) Remotes(ctx context.Context) ([]Remote, error) {
	out, err := r.run(ctx, "remote")
	if err != nil {
		return nil, err
	}
	var remotes []Remote
	for _, name := range strings.Fields(out) {
		rem := Remote{Name: name}
		if u, err := r.run(ctx, "remote", "get-url", name); err == nil {
			rem.URL = strings.TrimSpace(u)
		}
		if u, err := r.run(ctx, "remote", "get-url", "--push", name); err == nil {
			rem.PushURL = strings.TrimSpace(u)
		}
		remotes = append(remotes, rem)
	}
	return remotes, nil
}
