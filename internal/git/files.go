package git

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gitjet/internal/lang"
)

// SourceFile is a file's contents at a revision, for the source viewer.
type SourceFile struct {
	Path      string `json:"path"`
	Revision  string `json:"revision"`
	Text      string `json:"text"`
	Binary    bool   `json:"binary"`
	Exists    bool   `json:"exists"`
	Truncated bool   `json:"truncated"`
	Size      int64  `json:"size"`
	Language  string `json:"language"`
	// External marks a read-only file outside the repository, such as a
	// language server's answer in a standard library.
	External bool `json:"external"`
}

// RepoFile is a file in the working tree, tracked or not.
type RepoFile struct {
	Path    string `json:"path"`
	Tracked bool   `json:"tracked"`
}

// LineRef asks for one line of the working tree, for the row of a usage
// list. Line is 1-based.
type LineRef struct {
	Path string `json:"path"`
	Line int    `json:"line"`
}

// LineText is the trimmed text of one requested line. A path that cannot be
// read, a line past the end, and a binary file are simply absent from the
// answer, so the page can lay the hits out by path and line.
type LineText struct {
	Path string `json:"path"`
	Line int    `json:"line"`
	Text string `json:"text"`
}

// maxLineTexts bounds one usage list: a language server can return thousands
// of references, and reading them all would cost more than the list is worth.
const maxLineTexts = 2000

// LineTexts reads the requested lines from the working tree. Each file is
// read once however many of its lines were asked for, and a file over the
// source viewer's 8 MiB cap is skipped rather than loaded.
func (r *Repo) LineTexts(refs []LineRef) []LineText {
	if len(refs) > maxLineTexts {
		refs = refs[:maxLineTexts]
	}
	out := make([]LineText, 0, len(refs))
	lines := make(map[string][]string)
	seen := make(map[string]bool)
	const limit = 8 << 20
	for _, ref := range refs {
		clean, err := cleanPath(ref.Path)
		if err != nil || ref.Line < 1 {
			continue
		}
		if !seen[clean] {
			seen[clean] = true
			st, err := os.Stat(r.AbsPath(clean))
			if err != nil || st.IsDir() || st.Size() > int64(limit) {
				continue
			}
			body, err := os.ReadFile(r.AbsPath(clean))
			if err != nil || looksBinary(string(body)) {
				continue
			}
			lines[clean] = strings.Split(string(body), "\n")
		}
		fileLines := lines[clean]
		if ref.Line > len(fileLines) {
			continue
		}
		text := strings.TrimSpace(strings.TrimSuffix(fileLines[ref.Line-1], "\r"))
		out = append(out, LineText{Path: clean, Line: ref.Line, Text: text})
	}
	return out
}

// FileContent reads a file at a revision. An empty revision or "WORKTREE"
// reads the file on disk, "INDEX" reads the index, and anything else is
// resolved by git, such as HEAD, a branch, a tag or a commit hash. When the
// working tree file is gone, the HEAD version is returned with Exists
// false so a deleted file can still be inspected.
func (r *Repo) FileContent(ctx context.Context, path, revision string) (SourceFile, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return SourceFile{}, err
	}
	const limit = 8 << 20
	rev := strings.TrimSpace(revision)
	out := SourceFile{Path: clean, Revision: rev, Language: languageOf(clean)}
	if rev == "" || rev == "WORKTREE" {
		out.Revision = ""
		st, err := os.Stat(r.AbsPath(clean))
		if err == nil && !st.IsDir() {
			out.Exists = true
			out.Size = st.Size()
			if st.Size() > int64(limit) {
				// Nothing is read: the file is past what this viewer
				// shows, and reading it whole is how a 300 MB blob used to
				// take the app with it.
				out.Truncated = true
				return out, nil
			}
			b, err := os.ReadFile(r.AbsPath(clean))
			if err != nil {
				return SourceFile{}, err
			}
			if looksBinary(string(b)) {
				out.Binary = true
				return out, nil
			}
			out.Text = string(b)
			return out, nil
		}
		// A deleted file still has its committed content.
		if text, truncated, ok := r.blob(ctx, "HEAD", clean, limit); ok {
			out.Text, out.Exists, out.Truncated = text, false, truncated
			return out, nil
		}
		return out, nil
	}
	if rev == "INDEX" {
		out.Revision = "INDEX"
		text, truncated, err := r.runLimited(ctx, limit, "show", ":"+clean)
		if err != nil {
			return out, nil
		}
		out.Exists = true
		out.Truncated = truncated
		if looksBinary(text) {
			out.Binary = true
			return out, nil
		}
		out.Text = text
		return out, nil
	}
	if strings.ContainsAny(rev, " \t\n") || strings.HasPrefix(rev, "-") {
		return SourceFile{}, errors.New("invalid revision")
	}
	text, truncated, ok := r.blob(ctx, rev, clean, limit)
	if !ok {
		return out, nil
	}
	out.Exists = true
	out.Text = text
	out.Truncated = truncated
	return out, nil
}

// PreviewLine is one raw line of a usage preview. Line numbers are 1-based.
type PreviewLine struct {
	Line int    `json:"line"`
	Text string `json:"text"`
}

// UsagePreview is the code around one usage, for the usage panel's preview
// pane. It reads the working tree for a git path and the file itself for an
// absolute path outside the repository; missing and binary files simply have
// no lines.
type UsagePreview struct {
	Path  string        `json:"path"`
	Line  int           `json:"line"`
	Start int           `json:"start"`
	Lines []PreviewLine `json:"lines"`
}

// maxPreviewRadius bounds the context a preview may ask for: the pane shows a
// few lines, and the page must not be able to read a whole file through it.
const maxPreviewRadius = 40

// UsagePreview reads the lines around one usage. A radius of zero keeps a
// small default, and the answer never leaves the source viewer's 8 MiB cap.
func (r *Repo) UsagePreview(path string, line, radius int) UsagePreview {
	if radius <= 0 {
		radius = 4
	}
	if radius > maxPreviewRadius {
		radius = maxPreviewRadius
	}
	out := UsagePreview{Path: path, Line: max(line, 1), Lines: []PreviewLine{}}
	clean := path
	if !filepath.IsAbs(clean) {
		rel, err := cleanPath(path)
		if err != nil {
			return out
		}
		clean = r.AbsPath(rel)
	} else {
		clean = filepath.Clean(clean)
	}
	const limit = 8 << 20
	st, err := os.Stat(clean)
	if err != nil || !st.Mode().IsRegular() || st.Size() > int64(limit) {
		return out
	}
	body, err := os.ReadFile(clean)
	if err != nil || looksBinary(string(body)) {
		return out
	}
	lines := strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n")
	// A final newline is a terminator, not an extra line; keeping it would
	// put a blank row under every preview and shift the clamp.
	if len(lines) > 1 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	out.Line = min(out.Line, len(lines))
	out.Start = max(1, out.Line-radius)
	end := min(len(lines), out.Line+radius)
	for n := out.Start; n <= end; n++ {
		out.Lines = append(out.Lines, PreviewLine{Line: n, Text: lines[n-1]})
	}
	return out
}

// ExternalFile reads one file outside the repository, for a declaration the
// language server reported in a standard library or another dependency. It is
// read-only in the page and never goes through git; only regular files are
// read, and the source viewer's 8 MiB cap applies.
func (r *Repo) ExternalFile(path string) (SourceFile, error) {
	if !filepath.IsAbs(path) {
		return SourceFile{}, errors.New("an external file needs an absolute path")
	}
	clean := filepath.Clean(path)
	out := SourceFile{
		Path:     filepath.ToSlash(clean),
		Revision: "EXTERNAL",
		External: true,
		Language: languageOf(clean),
	}
	const limit = 8 << 20
	st, err := os.Stat(clean)
	if err != nil || !st.Mode().IsRegular() {
		return out, nil
	}
	out.Exists = true
	out.Size = st.Size()
	if st.Size() > int64(limit) {
		out.Truncated = true
		return out, nil
	}
	body, err := os.ReadFile(clean)
	if err != nil {
		return SourceFile{}, err
	}
	if looksBinary(string(body)) {
		out.Binary = true
		return out, nil
	}
	out.Text = string(body)
	return out, nil
}

func (r *Repo) blob(ctx context.Context, rev, path string, limit int) (string, bool, bool) {
	out, truncated, err := r.runLimited(ctx, limit, "show", rev+":"+path)
	if err != nil {
		return "", false, false
	}
	return out, truncated, true
}

// Files lists the files of the working tree, tracked and untracked, whose
// path matches the query. The query is matched as a case-insensitive
// subsequence so "srccom" finds "src/components"; exact, prefix and
// substring matches rank first. A limit of zero keeps 200 files.
func (r *Repo) Files(ctx context.Context, query string, limit int) ([]RepoFile, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	all, err := r.listFiles(ctx)
	if err != nil {
		return nil, err
	}
	query = strings.ToLower(strings.TrimSpace(query))
	type ranked struct {
		file  RepoFile
		score int
	}
	var matches []ranked
	for _, f := range all {
		score, ok := matchScore(f.Path, query)
		if !ok {
			continue
		}
		matches = append(matches, ranked{file: f, score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score < matches[j].score
		}
		return matches[i].file.Path < matches[j].file.Path
	})
	if len(matches) > limit {
		matches = matches[:limit]
	}
	files := make([]RepoFile, len(matches))
	for i, m := range matches {
		files[i] = m.file
	}
	return files, nil
}

// matchScore ranks a path for quick open: 0 exact, 1 prefix, 2 substring,
// 3 subsequence, and a penalty for each skipped character.
func matchScore(path, query string) (int, bool) {
	if query == "" {
		return 2, true
	}
	lower := strings.ToLower(path)
	base := strings.ToLower(filepath.Base(path))
	switch {
	case base == query || lower == query:
		return 0, true
	case strings.HasPrefix(base, query):
		return 1, true
	case strings.HasPrefix(lower, query):
		return 1, true
	case strings.Contains(base, query):
		return 2, true
	case strings.Contains(lower, query):
		return 3, true
	}
	i := 0
	gaps := 0
	for _, c := range lower {
		if i < len(query) && byte(c) == query[i] {
			i++
			continue
		}
		if i > 0 && i < len(query) {
			gaps++
		}
	}
	if i == len(query) {
		return 4 + gaps/8, true
	}
	return 0, false
}

// languageOf names the grammar for a path. The catalog lives in internal/lang
// so the packs, the diff viewer and the explorer cannot drift apart.
func languageOf(path string) string {
	return lang.GrammarForPath(path)
}

// Tree lists every file in the working tree, tracked and untracked, for the
// source explorer. Unlike Files there is no query to rank, only a cap that
// keeps a runaway directory of generated output from being sent to the page.
func (r *Repo) Tree(ctx context.Context) ([]RepoFile, error) {
	files, err := r.listFiles(ctx)
	if err != nil {
		return nil, err
	}
	const limit = 20000
	if len(files) > limit {
		files = files[:limit]
	}
	return files, nil
}

// listFiles reads the working tree once: tracked files from the index and
// untracked ones that are not ignored, deduped and sorted by path.
func (r *Repo) listFiles(ctx context.Context) ([]RepoFile, error) {
	tracked, err := r.run(ctx, "ls-files", "-z", "-c")
	if err != nil {
		return nil, err
	}
	untracked, err := r.run(ctx, "ls-files", "-z", "-o", "--exclude-standard")
	if err != nil {
		return nil, err
	}
	var all []RepoFile
	seen := map[string]bool{}
	for _, group := range []struct {
		out     string
		tracked bool
	}{{tracked, true}, {untracked, false}} {
		for _, rec := range strings.Split(group.out, "\x00") {
			if rec == "" || seen[rec] {
				continue
			}
			seen[rec] = true
			all = append(all, RepoFile{Path: rec, Tracked: group.tracked})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Path < all[j].Path })
	return all, nil
}

// TreeAtRevision lists every file a revision contains, which is what the
// repository browser at that revision shows.
func (r *Repo) TreeAtRevision(ctx context.Context, revision string) ([]RepoFile, error) {
	rev := strings.TrimSpace(revision)
	if rev == "" || strings.HasPrefix(rev, "-") || strings.ContainsAny(rev, " \t\n") {
		return nil, errors.New("invalid revision")
	}
	out, err := r.run(ctx, "ls-tree", "-r", "--name-only", "-z", rev)
	if err != nil {
		return nil, err
	}
	files := []RepoFile{}
	for _, path := range strings.Split(out, "\x00") {
		if path != "" {
			files = append(files, RepoFile{Path: path, Tracked: true})
		}
	}
	return files, nil
}
