package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// DiffTarget selects what a file diff compares.
type DiffTarget string

const (
	// DiffWorkingTree compares HEAD with the file on disk.
	DiffWorkingTree DiffTarget = "worktree"
	// DiffStaged compares HEAD with the index.
	DiffStaged DiffTarget = "staged"
	// DiffCommit compares a commit with its first parent.
	DiffCommit DiffTarget = "commit"
	// DiffRange compares two revisions.
	DiffRange DiffTarget = "range"
)

// DiffOptions asks for one file's diff.
type DiffOptions struct {
	Path    string     `json:"path"`
	OldPath string     `json:"oldPath,omitempty"`
	Target  DiffTarget `json:"target"`
	// Revision is the commit for DiffCommit, or the new revision for
	// DiffRange.
	Revision string `json:"revision"`
	// From is the old revision of DiffRange.
	From string `json:"from"`
	// Context is the number of context lines, 3 when zero.
	Context int `json:"context"`
	// IgnoreWhitespace ignores all whitespace changes.
	IgnoreWhitespace bool `json:"ignoreWhitespace"`
	// IgnoreWhitespaceEOL ignores end-of-line whitespace only.
	IgnoreWhitespaceEOL bool `json:"ignoreWhitespaceEol"`
	// NoText asks for the patch only, without the full files.
	NoText bool `json:"noText"`
}

// DiffLine is one line of a hunk.
type DiffLine struct {
	Kind  string `json:"kind"` // context, add, del
	OldNo int    `json:"oldNo"`
	NewNo int    `json:"newNo"`
	Text  string `json:"text"`
}

// DiffHunk is one @@ block.
type DiffHunk struct {
	Header   string     `json:"header"`
	OldStart int        `json:"oldStart"`
	OldLines int        `json:"oldLines"`
	NewStart int        `json:"newStart"`
	NewLines int        `json:"newLines"`
	Lines    []DiffLine `json:"lines"`
	// raw is the patch of this hunk alone, with the file headers git
	// printed; git apply consumes it for staging and rollback.
	raw string
}

// FileDiff is a file compared against another version of itself, in the
// shape the diff viewer draws.
type FileDiff struct {
	Path       string     `json:"path"`
	OldPath    string     `json:"oldPath,omitempty"`
	Status     string     `json:"status"` // added, deleted, modified, renamed, copied, typechange
	Binary     bool       `json:"binary"`
	Additions  int        `json:"additions"`
	Deletions  int        `json:"deletions"`
	Hunks      []DiffHunk `json:"hunks"`
	OldText    string     `json:"oldText"`
	NewText    string     `json:"newText"`
	OldLabel   string     `json:"oldLabel"`
	NewLabel   string     `json:"newLabel"`
	Truncated  bool       `json:"truncated"`
	Patch      string     `json:"patch"`
	HasChanges bool       `json:"hasChanges"`
}

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$`)

// FileDiff returns one file's diff.
func (r *Repo) FileDiff(ctx context.Context, opts DiffOptions) (FileDiff, error) {
	path, err := cleanPath(opts.Path)
	if err != nil {
		return FileDiff{}, err
	}
	if opts.Context <= 0 {
		opts.Context = 3
	}
	if opts.Context > 100 {
		opts.Context = 100
	}
	patch, err := r.patchFor(ctx, opts, path)
	if err != nil {
		return FileDiff{}, err
	}
	d := parsePatch(patch, path)
	d.Path = path
	if opts.OldPath != "" {
		d.OldPath = opts.OldPath
	}
	if d.OldPath == "" {
		d.OldPath = path
	}
	d.Patch = patch
	d.HasChanges = len(d.Hunks) > 0 || d.Binary || d.Status != "modified"
	if d.Binary || opts.NoText || isSynthetic(opts) {
		d.OldLabel, d.NewLabel = labelsFor(opts)
		return d, nil
	}
	r.fillText(ctx, &d, opts, path)
	d.OldLabel, d.NewLabel = labelsFor(opts)
	return d, nil
}

func isSynthetic(opts DiffOptions) bool {
	return opts.Target == DiffWorkingTree && opts.Revision == "" && opts.From == ""
}

func labelsFor(opts DiffOptions) (string, string) {
	switch opts.Target {
	case DiffStaged:
		return "HEAD", "Index"
	case DiffCommit:
		h := short(opts.Revision)
		return h + "^", h
	case DiffRange:
		return short(opts.From), short(opts.Revision)
	default:
		if opts.Revision != "" {
			return short(opts.Revision), "Working Tree"
		}
		return "HEAD", "Working Tree"
	}
}

func (r *Repo) patchFor(ctx context.Context, opts DiffOptions, path string) (string, error) {
	args := []string{"diff", "--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/", "-M"}
	if opts.IgnoreWhitespace {
		args = append(args, "-w")
	} else if opts.IgnoreWhitespaceEOL {
		args = append(args, "--ignore-space-at-eol")
	}
	args = append(args, fmt.Sprintf("-U%d", opts.Context))
	switch opts.Target {
	case DiffStaged:
		args = append(args, "--cached")
	case DiffCommit:
		h := strings.TrimSpace(opts.Revision)
		if h == "" {
			return "", errors.New("no revision given")
		}
		args = append(args, h+"^", h)
	case DiffRange:
		if opts.From == "" || opts.Revision == "" {
			return "", errors.New("a range needs two revisions")
		}
		args = append(args, opts.From, opts.Revision)
	default:
		if opts.Revision != "" {
			args = append(args, opts.Revision)
		}
	}
	args = append(args, "--", path)
	out, err := r.run(ctx, args...)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" && opts.Target == DiffWorkingTree && opts.Revision == "" {
		// An untracked file is not in a diff; show it as a new file.
		if content, rerr := os.ReadFile(r.AbsPath(path)); rerr == nil {
			return syntheticNewFile(path, content), nil
		}
	}
	return out, nil
}

// syntheticNewFile writes the patch git would print for an added file.
func syntheticNewFile(path string, content []byte) string {
	if len(content) == 0 {
		return ""
	}
	text := string(content)
	if strings.IndexByte(text, 0) >= 0 {
		return fmt.Sprintf("diff --git a/%s b/%s\nnew file mode 100644\nBinary files /dev/null and b/%s differ\n", path, path, path)
	}
	lines := strings.SplitAfter(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "diff --git a/%s b/%s\nnew file mode 100644\n--- /dev/null\n+++ b/%s\n", path, path, path)
	fmt.Fprintf(&b, "@@ -0,0 +1,%d @@\n", len(lines))
	for _, line := range lines {
		line = strings.TrimSuffix(line, "\n")
		b.WriteString("+")
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String()
}

// parsePatch parses git's unified diff into hunks. It keeps the metadata
// git printed before the first hunk, which applying a hunk needs.
func parsePatch(patch, path string) FileDiff {
	d := FileDiff{Status: "modified"}
	lines := strings.Split(patch, "\n")
	var current *DiffHunk
	oldNo, newNo := 0, 0
	seenHunk := false
	meta := ""
	for _, line := range lines {
		if strings.HasPrefix(line, "diff --git ") {
			if seenHunk {
				break // another file after this one
			}
			meta = line + "\n"
			continue
		}
		if m := hunkHeader.FindStringSubmatch(line); m != nil {
			oldStart := atoi(m[1])
			oldLines := 1
			if m[2] != "" {
				oldLines = atoi(m[2])
			}
			newStart := atoi(m[3])
			newLines := 1
			if m[4] != "" {
				newLines = atoi(m[4])
			}
			h := DiffHunk{Header: strings.TrimSpace(line), OldStart: oldStart, OldLines: oldLines, NewStart: newStart, NewLines: newLines}
			d.Hunks = append(d.Hunks, h)
			current = &d.Hunks[len(d.Hunks)-1]
			oldNo, newNo = oldStart, newStart
			seenHunk = true
			continue
		}
		if !seenHunk {
			switch {
			case strings.HasPrefix(line, "new file mode"):
				d.Status = "added"
			case strings.HasPrefix(line, "deleted file mode"):
				d.Status = "deleted"
			case strings.HasPrefix(line, "rename from "):
				d.Status = "renamed"
				d.OldPath = strings.TrimPrefix(line, "rename from ")
			case strings.HasPrefix(line, "copy from "):
				d.Status = "copied"
				d.OldPath = strings.TrimPrefix(line, "copy from ")
			case strings.HasPrefix(line, "old mode"), strings.HasPrefix(line, "new mode"):
				if d.Status == "modified" && !seenHunk {
					// A mode change alone is still a modification; leave it.
				}
			case strings.HasPrefix(line, "Binary files "):
				d.Binary = true
			case strings.HasPrefix(line, "GIT binary patch"):
				d.Binary = true
			}
			if strings.HasPrefix(line, "--- ") || strings.HasPrefix(line, "+++ ") || strings.HasPrefix(line, "index ") || strings.HasPrefix(line, "new file mode") || strings.HasPrefix(line, "deleted file mode") || strings.HasPrefix(line, "similarity index") || strings.HasPrefix(line, "rename from") || strings.HasPrefix(line, "rename to") || strings.HasPrefix(line, "old mode") || strings.HasPrefix(line, "new mode") {
				meta += line + "\n"
			}
			continue
		}
		if current == nil {
			continue
		}
		if line == "" || strings.HasPrefix(line, `\`) {
			continue
		}
		switch line[0] {
		case ' ':
			current.Lines = append(current.Lines, DiffLine{Kind: "context", OldNo: oldNo, NewNo: newNo, Text: line[1:]})
			oldNo++
			newNo++
		case '-':
			current.Lines = append(current.Lines, DiffLine{Kind: "del", OldNo: oldNo, Text: line[1:]})
			oldNo++
			d.Deletions++
		case '+':
			current.Lines = append(current.Lines, DiffLine{Kind: "add", NewNo: newNo, Text: line[1:]})
			newNo++
			d.Additions++
		}
	}
	if seenHunk {
		// A line count of zero still reads as one in a hunk header.
		for i := range d.Hunks {
			h := &d.Hunks[i]
			var raw strings.Builder
			raw.WriteString(meta)
			raw.WriteString(h.Header)
			raw.WriteString("\n")
			for _, l := range h.Lines {
				switch l.Kind {
				case "add":
					raw.WriteString("+")
				case "del":
					raw.WriteString("-")
				default:
					raw.WriteString(" ")
				}
				raw.WriteString(l.Text)
				raw.WriteString("\n")
			}
			h.raw = raw.String()
		}
	}
	return d
}

// fillText reads the full old and new files for the side-by-side viewer.
func (r *Repo) fillText(ctx context.Context, d *FileDiff, opts DiffOptions, path string) {
	const limit = 8 << 20
	readBlob := func(rev, p string) (string, bool) {
		if p == "" {
			return "", false
		}
		out, err := r.run(ctx, "show", rev+":"+p)
		if err != nil {
			return "", false
		}
		if len(out) > limit {
			d.Truncated = true
			return out[:limit], true
		}
		return out, true
	}
	readFile := func(p string) (string, bool) {
		b, err := os.ReadFile(r.AbsPath(p))
		if err != nil {
			return "", false
		}
		if len(b) > limit {
			d.Truncated = true
			return string(b[:limit]), true
		}
		return string(b), true
	}
	oldPath := d.OldPath
	if oldPath == "" {
		oldPath = path
	}
	var oldText, newText string
	switch opts.Target {
	case DiffStaged:
		if !opts.NoText {
			oldText, _ = readBlob("HEAD", oldPath)
			out, err := r.run(ctx, "show", ":"+path)
			if err == nil {
				newText = out
			}
		}
	case DiffCommit:
		h := strings.TrimSpace(opts.Revision)
		oldText, _ = readBlob(h+"^", oldPath)
		newText, _ = readBlob(h, path)
	case DiffRange:
		oldText, _ = readBlob(opts.From, oldPath)
		newText, _ = readBlob(opts.Revision, path)
	default:
		if opts.Revision != "" {
			oldText, _ = readBlob(opts.Revision, oldPath)
		} else {
			oldText, _ = readBlob("HEAD", oldPath)
		}
		newText, _ = readFile(path)
		if newText == "" {
			// A deleted file has no working tree content.
			newText = ""
		}
	}
	if looksBinary(oldText) || looksBinary(newText) {
		d.Binary = true
		d.OldText, d.NewText = "", ""
		return
	}
	d.OldText, d.NewText = oldText, newText
}

func looksBinary(s string) bool {
	n := len(s)
	if n > 8000 {
		n = 8000
	}
	return strings.IndexByte(s[:n], 0) >= 0
}

// ApplyDiffHunk stages, unstages or rolls back one hunk of a file diff.
// side is the side the diff was taken from: "worktree" or "staged".
func (r *Repo) ApplyDiffHunk(ctx context.Context, opts DiffOptions, hunkIndex int, action string) error {
	if opts.Target != DiffWorkingTree && opts.Target != DiffStaged {
		return errors.New("hunks can only be applied to local changes")
	}
	path, err := cleanPath(opts.Path)
	if err != nil {
		return err
	}
	if opts.Context <= 0 {
		opts.Context = 3
	}
	patch, err := r.patchFor(ctx, opts, path)
	if err != nil {
		return err
	}
	d := parsePatch(patch, path)
	if hunkIndex < 0 || hunkIndex >= len(d.Hunks) {
		return fmt.Errorf("no hunk %d in %s", hunkIndex, path)
	}
	hunkPatch := d.Hunks[hunkIndex].raw
	if hunkPatch == "" {
		return errors.New("the hunk has no patch")
	}
	args := []string{"apply", "--whitespace=nowarn", "--recount"}
	reverse := false
	switch action {
	case "stage":
		if opts.Target == DiffStaged {
			return nil
		}
		args = append(args, "--cached")
	case "unstage":
		if opts.Target != DiffStaged {
			return errors.New("no staged hunk to unstage")
		}
		args = append(args, "--cached")
		reverse = true
	case "rollback":
		if opts.Target != DiffWorkingTree {
			return errors.New("only working tree hunks can be rolled back")
		}
		reverse = true
	default:
		return fmt.Errorf("unknown action %q", action)
	}
	if reverse {
		args = append(args, "-R")
	}
	args = append(args, "-")
	r.write.Lock()
	defer r.write.Unlock()
	_, err = r.runInput(ctx, hunkPatch, args...)
	return err
}

// ApplyDiffHunkFile stages or unstages the whole file the diff describes,
// for files such as binary files whose hunks cannot be split.
func (r *Repo) ApplyDiffHunkFile(ctx context.Context, opts DiffOptions, action string) error {
	path, err := cleanPath(opts.Path)
	if err != nil {
		return err
	}
	switch action {
	case "stage":
		return r.Stage(ctx, []string{path})
	case "unstage":
		return r.Unstage(ctx, []string{path})
	case "rollback":
		return r.Rollback(ctx, []string{path})
	}
	return fmt.Errorf("unknown action %q", action)
}
