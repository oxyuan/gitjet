package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
)

// lineStageLimit caps the text line-level staging reads: the whole file is
// rebuilt to apply a selection, so an unreadable size has to be refused
// instead of loaded.
const lineStageLimit = 8 << 20

// ApplyDiffLines stages, unstages or rolls back only the selected changed
// lines of one file. A selection is a signed line number: positive for the
// new side (the working tree, or the index when the diff is staged),
// negative for the old side. That is what lets a click on a deleted line
// mean that line instead of an unrelated added line with the same number.
//
// The target file is rebuilt from the side it is written to and the
// selection, so scattered lines and insert/delete blocks of unequal length
// apply exactly and in order; a patch with zero-context hunks could not
// express either.
func (r *Repo) ApplyDiffLines(ctx context.Context, opts DiffOptions, lines []int, action string) error {
	path, err := cleanPath(opts.Path)
	if err != nil {
		return err
	}
	if len(lines) == 0 {
		return errors.New("select at least one changed line")
	}
	switch action {
	case "stage", "rollback":
		if opts.Target != "" && opts.Target != "worktree" {
			return errors.New("lines can only be staged from the working tree diff")
		}
	case "unstage":
		if opts.Target != "staged" {
			return errors.New("lines can only be unstaged from the staged diff")
		}
	default:
		return fmt.Errorf("unknown line action %q", action)
	}
	oldSel, newSel, err := splitLineSelection(lines)
	if err != nil {
		return err
	}
	opts.Path = path
	// Three context lines are enough to locate every block; the target is
	// rebuilt whole, so the viewer's whole-file setting cannot collapse
	// unrelated changes into one hunk.
	opts.Context = 3
	patch, err := r.patchFor(ctx, opts, path)
	if err != nil {
		return err
	}
	diff := parsePatch(patch, path)
	if len(diff.Hunks) == 0 {
		return errors.New("this file has no changed lines")
	}
	r.write.Lock()
	defer r.write.Unlock()
	switch action {
	case "stage":
		oldText, _, err := r.revisionText(ctx, ":"+path)
		if err != nil {
			return err
		}
		target := rebuildFromOld(diff, oldText, oldSel, newSel, true)
		if target == oldText {
			return errors.New("none of the selected lines is a change")
		}
		return r.writeIndexText(ctx, path, target)
	case "unstage":
		oldText, exists, err := r.revisionText(ctx, "HEAD:"+path)
		if err != nil {
			return err
		}
		target := rebuildFromOld(diff, oldText, oldSel, newSel, false)
		if target == "" && !exists {
			// Every line of a staged new file was selected: the path goes
			// back to being untracked instead of an empty staged file.
			return r.removeIndexEntry(ctx, path)
		}
		return r.writeIndexText(ctx, path, target)
	default:
		newText, exists, err := r.worktreeText(path)
		if err != nil {
			return err
		}
		target := rebuildFromNew(diff, newText, oldSel, newSel)
		if target == "" && !exists {
			return nil
		}
		return os.WriteFile(r.AbsPath(path), []byte(target), 0o644)
	}
}

// StageIntent marks untracked paths as intent-to-add: git records them
// without content, so their changes can be staged line by line.
func (r *Repo) StageIntent(ctx context.Context, paths []string) error {
	clean, err := cleanPaths(paths)
	if err != nil {
		return err
	}
	if len(clean) == 0 {
		return errors.New("no paths were given")
	}
	args := append([]string{"add", "-N", "--"}, literalPaths(clean)...)
	_, err = r.writeRun(ctx, args...)
	return err
}

// splitLineSelection separates signed line numbers into the old side
// (negative) and the new side (positive).
func splitLineSelection(lines []int) (map[int]bool, map[int]bool, error) {
	oldSel := map[int]bool{}
	newSel := map[int]bool{}
	for _, n := range lines {
		switch {
		case n > 0:
			newSel[n] = true
		case n < 0:
			oldSel[-n] = true
		default:
			return nil, nil, errors.New("invalid line number")
		}
	}
	return oldSel, newSel, nil
}

// rebuildFromOld returns the old file with the chosen changes applied: the
// selected ones for staging, the unselected ones when unstaging.
func rebuildFromOld(diff FileDiff, text string, oldSel, newSel map[int]bool, keepSelected bool) string {
	oldLines, oldFinal := splitText(text)
	out := make([]string, 0, len(oldLines)+16)
	idx := 0
	lastFromNew := false
	lastNoNewline := false
	appendOld := func() {
		if idx < len(oldLines) {
			out = append(out, oldLines[idx])
		}
		idx++
		lastFromNew = false
	}
	appendNew := func(l DiffLine) {
		out = append(out, l.Text)
		lastFromNew = true
		lastNoNewline = l.NoNewline
	}
	applies := func(picked bool) bool { return picked == keepSelected }
	for _, hunk := range diff.Hunks {
		start := hunk.OldStart - 1
		if start < 0 {
			start = 0
		}
		if start > len(oldLines) {
			start = len(oldLines)
		}
		for idx < start {
			appendOld()
		}
		for i := 0; i < len(hunk.Lines); {
			line := hunk.Lines[i]
			if line.Kind == "context" {
				appendOld()
				i++
				continue
			}
			startLine := i
			for i < len(hunk.Lines) && hunk.Lines[i].Kind != "context" {
				i++
			}
			var dels, adds []DiffLine
			for _, l := range hunk.Lines[startLine:i] {
				if l.Kind == "del" {
					dels = append(dels, l)
				} else {
					adds = append(adds, l)
				}
			}
			anyPicked := false
			for _, l := range hunk.Lines[startLine:i] {
				if (l.Kind == "del" && oldSel[l.OldNo]) || (l.Kind == "add" && newSel[l.NewNo]) {
					anyPicked = true
					break
				}
			}
			switch {
			case len(dels) == 0:
				for _, a := range adds {
					if applies(newSel[a.NewNo]) {
						appendNew(a)
					}
				}
			case len(adds) == 0:
				for _, d := range dels {
					if applies(oldSel[d.OldNo]) {
						idx++
						continue
					}
					appendOld()
				}
			case len(dels) == len(adds):
				for k := range dels {
					d, a := dels[k], adds[k]
					if applies(oldSel[d.OldNo] || newSel[a.NewNo]) {
						appendNew(a)
					} else {
						appendOld()
					}
				}
			default:
				if applies(anyPicked) {
					for range dels {
						idx++
					}
					for _, a := range adds {
						appendNew(a)
					}
				} else {
					for range dels {
						appendOld()
					}
				}
			}
		}
	}
	for idx < len(oldLines) {
		appendOld()
	}
	final := oldFinal
	if lastFromNew {
		final = !lastNoNewline
	}
	return joinText(out, final)
}

// rebuildFromNew returns the new file with the selected changes reverted,
// which is what rolling back selected working-tree lines writes.
func rebuildFromNew(diff FileDiff, text string, oldSel, newSel map[int]bool) string {
	newLines, newFinal := splitText(text)
	out := make([]string, 0, len(newLines)+16)
	idx := 0
	lastFromOld := false
	lastNoNewline := false
	appendNew := func() {
		if idx < len(newLines) {
			out = append(out, newLines[idx])
		}
		idx++
		lastFromOld = false
	}
	appendOld := func(l DiffLine) {
		out = append(out, l.Text)
		lastFromOld = true
		lastNoNewline = l.NoNewline
	}
	for _, hunk := range diff.Hunks {
		start := hunk.NewStart - 1
		if start < 0 {
			start = 0
		}
		if start > len(newLines) {
			start = len(newLines)
		}
		for idx < start {
			appendNew()
		}
		for i := 0; i < len(hunk.Lines); {
			line := hunk.Lines[i]
			if line.Kind == "context" {
				appendNew()
				i++
				continue
			}
			startLine := i
			for i < len(hunk.Lines) && hunk.Lines[i].Kind != "context" {
				i++
			}
			var dels, adds []DiffLine
			for _, l := range hunk.Lines[startLine:i] {
				if l.Kind == "del" {
					dels = append(dels, l)
				} else {
					adds = append(adds, l)
				}
			}
			anyPicked := false
			for _, l := range hunk.Lines[startLine:i] {
				if (l.Kind == "del" && oldSel[l.OldNo]) || (l.Kind == "add" && newSel[l.NewNo]) {
					anyPicked = true
					break
				}
			}
			switch {
			case len(dels) == 0:
				for _, a := range adds {
					idx++
					if !newSel[a.NewNo] {
						out = append(out, a.Text)
						lastFromOld = false
					}
				}
			case len(adds) == 0:
				for _, d := range dels {
					if oldSel[d.OldNo] {
						appendOld(d)
					}
				}
			case len(dels) == len(adds):
				for k := range dels {
					d, a := dels[k], adds[k]
					idx++
					if oldSel[d.OldNo] || newSel[a.NewNo] {
						appendOld(d)
					} else {
						out = append(out, a.Text)
						lastFromOld = false
					}
				}
			default:
				for range adds {
					idx++
				}
				if anyPicked {
					for _, d := range dels {
						appendOld(d)
					}
				} else {
					for _, a := range adds {
						out = append(out, a.Text)
					}
					lastFromOld = false
				}
			}
		}
	}
	for idx < len(newLines) {
		appendNew()
	}
	final := newFinal
	if lastFromOld {
		final = !lastNoNewline
	}
	return joinText(out, final)
}

// splitText returns the file's lines and whether it ended in a newline.
func splitText(text string) ([]string, bool) {
	if text == "" {
		return nil, false
	}
	parts := strings.Split(text, "\n")
	if parts[len(parts)-1] == "" {
		return parts[:len(parts)-1], true
	}
	return parts, false
}

func joinText(lines []string, finalNewline bool) string {
	if len(lines) == 0 {
		return ""
	}
	text := strings.Join(lines, "\n")
	if finalNewline {
		text += "\n"
	}
	return text
}

// revisionText reads a blob (":path", "HEAD:path") and reports whether it
// exists. Too large a file is a refusal, not a truncation: the caller is
// about to rewrite the whole file.
func (r *Repo) revisionText(ctx context.Context, rev string) (string, bool, error) {
	out, truncated, err := r.runLimited(ctx, lineStageLimit, "show", rev)
	if err != nil {
		return "", false, nil
	}
	if truncated {
		return "", false, errors.New("the file is too large for line-level staging")
	}
	return out, true, nil
}

// worktreeText reads the file line staging rewrites.
func (r *Repo) worktreeText(path string) (string, bool, error) {
	abs := r.AbsPath(path)
	info, err := os.Stat(abs)
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if info.IsDir() {
		return "", false, errors.New("a directory cannot be staged line by line")
	}
	if info.Size() > lineStageLimit {
		return "", false, errors.New("the file is too large for line-level staging")
	}
	b, err := os.ReadFile(abs)
	if err != nil {
		return "", false, err
	}
	return string(b), true, nil
}

// writeIndexText stores text as the path's index entry, keeping the mode
// the entry already has (or the worktree's mode for a new file). --path
// applies the repository's filters, exactly as git add would.
func (r *Repo) writeIndexText(ctx context.Context, path, text string) error {
	oid, err := r.runInput(ctx, text, "hash-object", "-w", "--stdin", "--path="+path)
	if err != nil {
		return err
	}
	entry := fmt.Sprintf("%s %s\t%s\x00", r.indexMode(ctx, path), strings.TrimSpace(oid), path)
	_, err = r.runInput(ctx, entry, "update-index", "-z", "--index-info")
	return err
}

// removeIndexEntry takes a path out of the index, leaving the file alone.
func (r *Repo) removeIndexEntry(ctx context.Context, path string) error {
	_, err := r.run(ctx, "update-index", "--force-remove", "--", literalPath(path))
	return err
}

// indexMode is the mode an index entry should keep.
func (r *Repo) indexMode(ctx context.Context, path string) string {
	if out, err := r.run(ctx, "ls-files", "-s", "--", literalPath(path)); err == nil {
		if fields := strings.Fields(out); len(fields) > 0 {
			return fields[0]
		}
	}
	if info, err := os.Lstat(r.AbsPath(path)); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return "120000"
		}
		if info.Mode()&0o111 != 0 {
			return "100755"
		}
	}
	return "100644"
}
