package git

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ApplyDiffLines stages, unstages or rolls back only the selected changed
// lines of one file. lines are line numbers on the side the selection was
// made on: the new side for "stage" and "rollback" (the working tree), the
// old side for "unstage" (the index). A line that belongs to a replacement
// carries its counterpart with it, and a change block whose sides have
// different lengths is applied as a whole, because an arbitrary half of it
// has no meaning.
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
	opts.Path = path
	patch, err := r.patchFor(ctx, opts, path)
	if err != nil {
		return err
	}
	diff := parsePatch(patch, path)
	if len(diff.Hunks) == 0 {
		return errors.New("this file has no changed lines")
	}
	selected := map[int]bool{}
	for _, n := range lines {
		if n <= 0 {
			return errors.New("invalid line number")
		}
		selected[n] = true
	}
	wantNew := action != "unstage"
	body := selectPatchHunks(diff, selected, wantNew)
	if strings.TrimSpace(body) == "" {
		return errors.New("none of the selected lines is a change")
	}
	header := fmt.Sprintf("--- a/%s\n+++ b/%s\n", path, path)
	args := []string{"apply", "--unidiff-zero", "--whitespace=nowarn"}
	switch action {
	case "stage":
		args = append(args, "--cached")
		if !r.isTracked(ctx, path) {
			// An untracked file needs an index entry before a patch can
			// apply to it; intent-to-add provides an empty one.
			if _, err := r.run(ctx, "add", "-N", "--", literalPath(path)); err != nil {
				return err
			}
		}
	case "unstage", "rollback":
		args = append(args, "--reverse")
		if action == "unstage" {
			args = append(args, "--cached")
		}
	}
	args = append(args, "-")
	r.write.Lock()
	defer r.write.Unlock()
	_, err = r.runInput(ctx, header+body, args...)
	return err
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

// selectPatchHunks renders the selected edits of a parsed file diff as
// zero-context hunks. A line number selects an edit: selected holds both
// sides' numbers, so clicking either side of a replacement works.
func selectPatchHunks(diff FileDiff, selected map[int]bool, wantNew bool) string {
	_ = wantNew
	var out strings.Builder
	// A hunk whose line lost its "\ No newline" marker makes git apply
	// reject the whole patch, so every written line carries it along.
	writeLine := func(prefix string, l DiffLine) {
		out.WriteString(prefix)
		out.WriteString(l.Text)
		out.WriteString("\n")
		if l.NoNewline {
			out.WriteString("\\ No newline at end of file\n")
		}
	}
	pickedLine := func(l DiffLine) bool {
		return (l.OldNo > 0 && selected[l.OldNo]) || (l.NewNo > 0 && selected[l.NewNo])
	}
	for _, hunk := range diff.Hunks {
		oldPos := hunk.OldStart
		newPos := hunk.NewStart
		for i := 0; i < len(hunk.Lines); {
			line := hunk.Lines[i]
			if line.Kind == "context" {
				oldPos++
				newPos++
				i++
				continue
			}
			start := i
			for i < len(hunk.Lines) && hunk.Lines[i].Kind != "context" {
				i++
			}
			block := hunk.Lines[start:i]
			var dels, adds []DiffLine
			for _, l := range block {
				if l.Kind == "del" {
					dels = append(dels, l)
				} else {
					adds = append(adds, l)
				}
			}
			blockOld := oldPos
			blockNew := newPos
			oldPos += len(dels)
			newPos += len(adds)

			switch {
			case len(dels) == 0:
				// One insertion hunk keeps the selected lines in order.
				var chosen []DiffLine
				for _, l := range adds {
					if pickedLine(l) {
						chosen = append(chosen, l)
					}
				}
				if len(chosen) == 0 {
					continue
				}
				fmt.Fprintf(&out, "@@ -%d,0 +%d,%d @@\n", max(0, blockOld-1), chosen[0].NewNo, len(chosen))
				for _, l := range chosen {
					writeLine("+", l)
				}
			case len(adds) == 0:
				var chosen []DiffLine
				for _, l := range dels {
					if pickedLine(l) {
						chosen = append(chosen, l)
					}
				}
				if len(chosen) == 0 {
					continue
				}
				fmt.Fprintf(&out, "@@ -%d,%d +%d,0 @@\n", chosen[0].OldNo, len(chosen), max(0, blockNew-1))
				for _, l := range chosen {
					writeLine("-", l)
				}
			case len(dels) == len(adds):
				for k := range dels {
					d, a := dels[k], adds[k]
					if !pickedLine(d) && !pickedLine(a) {
						continue
					}
					fmt.Fprintf(&out, "@@ -%d,1 +%d,1 @@\n", d.OldNo, a.NewNo)
					writeLine("-", d)
					writeLine("+", a)
				}
			default:
				// A block with unequal sides cannot be split line by line.
				picked := false
				for _, l := range block {
					if pickedLine(l) {
						picked = true
						break
					}
				}
				if !picked {
					continue
				}
				fmt.Fprintf(&out, "@@ -%d,%d +%d,%d @@\n", blockOld, len(dels), blockNew, len(adds))
				for _, l := range block {
					if l.Kind == "del" {
						writeLine("-", l)
					} else {
						writeLine("+", l)
					}
				}
			}
		}
	}
	return out.String()
}
