package git

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
}

// RepoFile is a file in the working tree, tracked or not.
type RepoFile struct {
	Path    string `json:"path"`
	Tracked bool   `json:"tracked"`
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
			b, err := os.ReadFile(r.AbsPath(clean))
			if err != nil {
				return SourceFile{}, err
			}
			out.Exists = true
			out.Size = st.Size()
			if len(b) > limit {
				b = b[:limit]
				out.Truncated = true
			}
			if looksBinary(string(b)) {
				out.Binary = true
				return out, nil
			}
			out.Text = string(b)
			return out, nil
		}
		// A deleted file still has its committed content.
		if text, ok := r.blob(ctx, "HEAD", clean, limit); ok {
			out.Text, out.Exists = text, false
			return out, nil
		}
		return out, nil
	}
	if rev == "INDEX" {
		out.Revision = "INDEX"
		text, err := r.run(ctx, "show", ":"+clean)
		if err != nil {
			return out, nil
		}
		out.Exists = true
		if len(text) > limit {
			text = text[:limit]
			out.Truncated = true
		}
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
	text, ok := r.blob(ctx, rev, clean, limit)
	if !ok {
		return out, nil
	}
	out.Exists = true
	out.Text = text
	return out, nil
}

func (r *Repo) blob(ctx context.Context, rev, path string, limit int) (string, bool) {
	out, err := r.run(ctx, "show", rev+":"+path)
	if err != nil {
		return "", false
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, true
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

func languageOf(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".go":
		return "go"
	case ".ts", ".mts", ".cts":
		return "typescript"
	case ".tsx":
		return "tsx"
	case ".js", ".mjs", ".cjs":
		return "javascript"
	case ".jsx":
		return "jsx"
	case ".json", ".jsonc":
		return "json"
	case ".css":
		return "css"
	case ".scss":
		return "scss"
	case ".html", ".htm":
		return "markup"
	case ".xml", ".svg":
		return "markup"
	case ".md", ".markdown":
		return "markdown"
	case ".py":
		return "python"
	case ".sh", ".bash", ".zsh":
		return "bash"
	case ".yml", ".yaml":
		return "yaml"
	case ".java":
		return "java"
	case ".kt", ".kts":
		return "kotlin"
	case ".rs":
		return "rust"
	case ".c", ".h":
		return "c"
	case ".cc", ".cpp", ".hpp", ".cxx":
		return "cpp"
	case ".sql":
		return "sql"
	case ".toml":
		return "toml"
	case ".rb":
		return "ruby"
	case ".php":
		return "php"
	case ".swift":
		return "swift"
	case ".dockerfile":
		return "docker"
	}
	if filepath.Base(path) == "Dockerfile" {
		return "docker"
	}
	if filepath.Base(path) == "Makefile" {
		return "makefile"
	}
	return "plain"
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
