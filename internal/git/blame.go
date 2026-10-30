package git

import (
	"context"
	"errors"
	"strings"
)

// BlameLine is one line of a file with the commit that last changed it.
type BlameLine struct {
	Line        int    `json:"line"`
	OrigLine    int    `json:"origLine"`
	Commit      string `json:"commit"`
	Short       string `json:"short"`
	Author      string `json:"author"`
	Email       string `json:"email"`
	Time        int64  `json:"time"`
	Summary     string `json:"summary"`
	Text        string `json:"text"`
	Boundary    bool   `json:"boundary"`
	Uncommitted bool   `json:"uncommitted"`
}

// BlameResult is a file's annotations.
type BlameResult struct {
	Path  string      `json:"path"`
	Lines []BlameLine `json:"lines"`
	// MaxTime is the newest commit time, which colours the gutter.
	MaxTime int64 `json:"maxTime"`
}

// Blame annotates every line of a file with the commit that last changed
// it, including uncommitted changes. Revision "" blames the working tree,
// "INDEX" the staged copy, and anything else the file as that revision left
// it, so every source view — not only the working tree — can answer who
// wrote a line.
func (r *Repo) Blame(ctx context.Context, path, revision string) (BlameResult, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return BlameResult{}, err
	}
	rev := strings.TrimSpace(revision)
	if rev != "" && rev != "WORKTREE" && rev != "INDEX" {
		if strings.ContainsAny(rev, " \t\n") || strings.HasPrefix(rev, "-") {
			return BlameResult{}, errors.New("invalid revision")
		}
	}
	// --line-porcelain is already colourless; git 2.54 refuses --no-color
	// here because it means either --no-color-lines or --no-color-by-age.
	var out string
	switch rev {
	case "", "WORKTREE":
		out, err = r.run(ctx, "blame", "--line-porcelain", "--", clean)
	case "INDEX":
		// Blame has no --cached: feed the index blob as the contents to
		// annotate, so staged lines still come back uncommitted.
		staged, serr := r.run(ctx, "show", ":"+clean)
		if serr != nil {
			return BlameResult{}, serr
		}
		out, err = r.runInput(ctx, staged, "blame", "--line-porcelain", "--contents", "-", "--", clean)
	default:
		out, err = r.run(ctx, "blame", "--line-porcelain", rev, "--", clean)
	}
	if err != nil {
		return BlameResult{}, err
	}
	result := BlameResult{Path: clean}
	lines := strings.Split(out, "\n")
	for i := 0; i < len(lines); i++ {
		header := lines[i]
		if header == "" {
			continue
		}
		fields := strings.Fields(header)
		if len(fields) < 3 {
			continue
		}
		bl := BlameLine{Commit: strings.TrimPrefix(fields[0], "^"), OrigLine: atoi(fields[1]), Line: atoi(fields[2])}
		bl.Boundary = strings.HasPrefix(fields[0], "^")
		bl.Short = short(bl.Commit)
		for i+1 < len(lines) {
			line := lines[i+1]
			if strings.HasPrefix(line, "\t") {
				bl.Text = strings.TrimPrefix(line, "\t")
				i++
				break
			}
			i++
			if line == "" {
				continue
			}
			tab := strings.IndexByte(line, ' ')
			if tab < 0 {
				continue
			}
			key, value := line[:tab], line[tab+1:]
			switch key {
			case "author":
				bl.Author = value
			case "author-mail":
				bl.Email = strings.Trim(value, "<>")
			case "author-time":
				bl.Time = parseInt64(value)
			case "summary":
				bl.Summary = value
			case "filename":
				// The path blame resolved; keep the requested one.
			}
		}
		if strings.HasPrefix(bl.Commit, "0000000") {
			bl.Uncommitted = true
		}
		if bl.Time > result.MaxTime {
			result.MaxTime = bl.Time
		}
		result.Lines = append(result.Lines, bl)
	}
	return result, nil
}
