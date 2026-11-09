package git

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// PatchOptions selects the changes a patch contains.
type PatchOptions struct {
	// Paths limits the patch to repository-relative paths; empty means all.
	Paths []string `json:"paths"`
	// Staged makes the patch the index against HEAD.
	Staged bool `json:"staged"`
	// Revision, with From empty, diffs that commit against its first
	// parent (or the empty tree for a root commit).
	Revision string `json:"revision"`
	// From and Revision together diff two revisions.
	From string `json:"from"`
	// IncludeUntracked adds files git does not track yet to a shelf and
	// removes them from the working tree after saving, like
	// "git stash --include-untracked".
	IncludeUntracked bool `json:"includeUntracked"`
}

// CreatePatch renders the selected changes as a unified patch.
func (r *Repo) CreatePatch(ctx context.Context, opts PatchOptions) (string, error) {
	args := []string{"diff", "--no-color", "--no-ext-diff", "--binary"}
	from := strings.TrimSpace(opts.From)
	rev := strings.TrimSpace(opts.Revision)
	for _, value := range []string{from, rev} {
		if strings.HasPrefix(value, "-") || strings.ContainsAny(value, " \t\n") {
			return "", errors.New("invalid revision")
		}
	}
	if rev != "" {
		if from != "" {
			args = append(args, from, rev)
		} else {
			parents, err := r.parents(ctx, rev)
			if err != nil {
				return "", err
			}
			base := ""
			if len(parents) > 0 {
				base = parents[0]
			} else {
				empty, err := r.emptyTreeObject(ctx)
				if err != nil {
					return "", err
				}
				base = empty
			}
			args = append(args, base, rev)
		}
	} else if opts.Staged {
		args = append(args, "--cached")
	}
	if len(opts.Paths) > 0 {
		clean, err := cleanPaths(opts.Paths)
		if err != nil {
			return "", err
		}
		args = append(args, "--")
		args = append(args, literalPaths(clean)...)
	}
	return r.run(ctx, args...)
}

// ApplyPatch applies a patch to the working tree. A patch that does not
// apply is reported as it is; nothing is forced.
func (r *Repo) ApplyPatch(ctx context.Context, patch string, reverse, cached bool) (string, error) {
	if strings.TrimSpace(patch) == "" {
		return "", errors.New("the patch is empty")
	}
	args := []string{"apply", "--whitespace=nowarn"}
	if reverse {
		args = append(args, "--reverse")
	}
	if cached {
		args = append(args, "--cached")
	}
	args = append(args, "-")
	return r.writeRunInput(ctx, patch, args...)
}

// writeRunInput serializes a repository change that reads stdin.
func (r *Repo) writeRunInput(ctx context.Context, input string, args ...string) (string, error) {
	r.write.Lock()
	defer r.write.Unlock()
	return r.runInput(ctx, input, args...)
}

// Shelf is one saved patch, alongside the stash but independent of it.
type Shelf struct {
	Name    string `json:"name"`
	Time    int64  `json:"time"`
	Label   string `json:"label"`
	Path    string `json:"path"`
	Size    int    `json:"size"`
	Files   int    `json:"files"`
	Preview string `json:"preview"`
	// Staged reports that applying the shelf also restores its index
	// state, not just the working tree.
	Staged bool `json:"staged"`
	// Untracked counts the new files the shelf removes and restores.
	Untracked int `json:"untracked"`
}

// shelfDir is where shelves live inside the git directory, so they belong
// to this repository and are never committed.
func (r *Repo) shelfDir() string { return filepath.Join(r.gitDir, "gitjet-shelf") }

func (r *Repo) shelfFile(name string) (string, error) {
	if name == "" || name != filepath.Base(name) || strings.HasPrefix(name, ".") || strings.ContainsAny(name, `/\`) {
		return "", errors.New("invalid shelf name")
	}
	return filepath.Join(r.shelfDir(), name+".patch"), nil
}

// SaveShelf saves the selected changes as a patch and then discards them
// from the working tree, which is what "Shelve Changes" does.
//
// The patch is HEAD against the working tree, so it also holds what is
// staged: "git diff" alone skips the index, and the reset that follows
// would throw that work away for good. Before anything is removed the
// patch is checked to reproduce exactly the current changes in reverse,
// so a patch that cannot be restored never costs the user their tree.
func (r *Repo) SaveShelf(ctx context.Context, name string, opts PatchOptions) (Shelf, error) {
	name = strings.TrimSpace(name)
	file, err := r.shelfFile(name)
	if err != nil {
		return Shelf{}, err
	}
	if _, err := os.Stat(file); err == nil {
		return Shelf{}, fmt.Errorf("a shelf named %q already exists", name)
	}
	r.write.Lock()
	defer r.write.Unlock()
	var clean []string
	if len(opts.Paths) > 0 {
		clean, err = cleanPaths(opts.Paths)
		if err != nil {
			return Shelf{}, err
		}
	}
	// Capture the index before touching it: the shelf has to restore which
	// hunks were staged, not just the combined working-tree content.
	indexArgs := []string{"diff", "--cached", "--binary", "--no-color"}
	if len(clean) > 0 {
		indexArgs = append(indexArgs, "--")
		indexArgs = append(indexArgs, literalPaths(clean)...)
	}
	indexPatch, err := r.run(ctx, indexArgs...)
	if err != nil {
		return Shelf{}, err
	}
	// git diff cannot see files git does not track. Intent-to-add makes
	// them visible for one diff without changing their content in the
	// index, and the markers are removed again before anything is saved.
	untracked := []string{}
	if opts.IncludeUntracked {
		untracked, err = r.untrackedUnder(ctx, clean)
		if err != nil {
			return Shelf{}, err
		}
		if len(untracked) > 0 {
			if _, err := r.run(ctx, append([]string{"add", "-N", "--"}, literalPaths(untracked)...)...); err != nil {
				return Shelf{}, err
			}
		}
	}
	args := []string{"diff", "--no-color", "--no-ext-diff", "--binary", "HEAD"}
	if len(clean) > 0 {
		args = append(args, "--")
		args = append(args, literalPaths(clean)...)
	}
	patch, err := r.run(ctx, args...)
	if len(untracked) > 0 {
		// Resetting the intent-to-add entries keeps the files on disk and
		// leaves the index exactly as it was.
		_, _ = r.run(ctx, append([]string{"reset", "-q", "--"}, literalPaths(untracked)...)...)
	}
	if err != nil {
		return Shelf{}, err
	}
	if strings.TrimSpace(patch) == "" {
		return Shelf{}, errors.New("there are no changes to shelve")
	}
	// The patch has to describe the working tree exactly, or restoring it
	// later would fail after the changes are already gone.
	if _, err := r.runInput(ctx, patch, "apply", "--check", "--reverse", "--whitespace=nowarn", "-"); err != nil {
		return Shelf{}, errors.New("these changes cannot be shelved safely: the patch does not restore them exactly")
	}
	if err := os.MkdirAll(r.shelfDir(), 0o755); err != nil {
		return Shelf{}, err
	}
	if err := os.WriteFile(file, []byte(patch), 0o644); err != nil {
		return Shelf{}, err
	}
	indexFile := file + ".index.patch"
	if strings.TrimSpace(indexPatch) != "" {
		if err := os.WriteFile(indexFile, []byte(indexPatch), 0o644); err != nil {
			_ = os.Remove(file)
			return Shelf{}, err
		}
	}
	// Shelving takes the changes away: keep them only in the patch.
	if len(clean) > 0 {
		targets := append(append([]string{}, clean...), untracked...)
		if err := r.rollbackLocked(ctx, targets); err != nil {
			_ = os.Remove(file)
			_ = os.Remove(indexFile)
			return Shelf{}, err
		}
	} else if _, err := r.run(ctx, "reset", "--hard", "HEAD"); err != nil {
		_ = os.Remove(file)
		_ = os.Remove(indexFile)
		return Shelf{}, err
	} else {
		for _, path := range untracked {
			if err := os.RemoveAll(r.AbsPath(path)); err != nil && !os.IsNotExist(err) {
				_ = os.Remove(file)
				_ = os.Remove(indexFile)
				return Shelf{}, err
			}
		}
	}
	shelf, err := shelfFromPatch(name, file, patch)
	if err != nil {
		return Shelf{}, err
	}
	shelf.Staged = strings.TrimSpace(indexPatch) != ""
	shelf.Untracked = len(untracked)
	return shelf, nil
}

// untrackedUnder lists the files git does not track, limited to paths
// under clean when it is not empty.
func (r *Repo) untrackedUnder(ctx context.Context, clean []string) ([]string, error) {
	st, err := r.Status(ctx, false)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, c := range st.Changes {
		if c.Kind != "untracked" {
			continue
		}
		if len(clean) > 0 && !pathUnderAny(c.Path, clean) {
			continue
		}
		out = append(out, c.Path)
	}
	sort.Strings(out)
	return out, nil
}

func pathUnderAny(path string, clean []string) bool {
	for _, p := range clean {
		if path == p || strings.HasPrefix(path, strings.TrimSuffix(p, "/")+"/") {
			return true
		}
	}
	return false
}

func shelfFromPatch(name, file, patch string) (Shelf, error) {
	st, err := os.Stat(file)
	if err != nil {
		return Shelf{}, err
	}
	files := strings.Count(patch, "\ndiff --git ")
	if strings.HasPrefix(patch, "diff --git ") {
		files++
	}
	preview := ""
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, "+++ b/") {
			preview = strings.TrimPrefix(line, "+++ b/")
			break
		}
	}
	return Shelf{
		Name:    name,
		Time:    st.ModTime().Unix(),
		Path:    file,
		Size:    len(patch),
		Files:   files,
		Preview: preview,
	}, nil
}

// Shelves lists the saved patches, newest first.
func (r *Repo) Shelves(ctx context.Context) ([]Shelf, error) {
	entries, err := os.ReadDir(r.shelfDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []Shelf{}, nil
		}
		return nil, err
	}
	shelves := []Shelf{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".patch") || strings.HasSuffix(entry.Name(), ".index.patch") {
			continue
		}
		file := filepath.Join(r.shelfDir(), entry.Name())
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".patch")
		shelf, err := shelfFromPatch(name, file, string(data))
		if err != nil {
			continue
		}
		shelf.Label = readShelfLabel(file)
		if _, err := os.Stat(file + ".index.patch"); err == nil {
			shelf.Staged = true
		}
		shelves = append(shelves, shelf)
	}
	sort.Slice(shelves, func(i, j int) bool {
		if shelves[i].Time != shelves[j].Time {
			return shelves[i].Time > shelves[j].Time
		}
		return shelves[i].Name < shelves[j].Name
	})
	return shelves, nil
}

func readShelfLabel(file string) string {
	data, err := os.ReadFile(file + ".json")
	if err != nil {
		return ""
	}
	var meta struct {
		Label string `json:"label"`
	}
	if json.Unmarshal(data, &meta) != nil {
		return ""
	}
	return meta.Label
}

// ShelfPatch reads one shelf's patch.
func (r *Repo) ShelfPatch(ctx context.Context, name string) (string, error) {
	file, err := r.shelfFile(name)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(file)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("no shelf named %q", name)
		}
		return "", err
	}
	return string(data), nil
}

// ApplyShelf applies a shelf to the working tree and, when drop is true,
// removes it.
func (r *Repo) ApplyShelf(ctx context.Context, name string, drop bool) (string, error) {
	patch, err := r.ShelfPatch(ctx, name)
	if err != nil {
		return "", err
	}
	file, err := r.shelfFile(name)
	if err != nil {
		return "", err
	}
	out, err := r.ApplyPatch(ctx, patch, false, false)
	if err != nil {
		return out, err
	}
	indexFile := file + ".index.patch"
	if data, ierr := os.ReadFile(indexFile); ierr == nil && strings.TrimSpace(string(data)) != "" {
		paths := patchPaths(string(data))
		if len(paths) > 0 {
			if _, herr := r.run(ctx, "symbolic-ref", "-q", "HEAD"); herr == nil {
				// Put the index back at HEAD for the shelf's paths before
				// replaying the saved staged state; the working tree is
				// already the shelf's content.
				if _, rerr := r.run(ctx, append([]string{"reset", "-q", "HEAD", "--"}, literalPaths(paths)...)...); rerr != nil {
					return out, rerr
				}
			}
		}
		if _, aerr := r.runInput(ctx, string(data), "apply", "--cached", "--whitespace=nowarn", "-"); aerr != nil {
			return out, fmt.Errorf("the working tree was restored but the staged state could not be: %w", aerr)
		}
	}
	if drop {
		if _, err := r.DropShelf(ctx, name); err != nil {
			return out, err
		}
	}
	return out, nil
}

// patchPaths lists the new-side path of every file a patch touches. It is
// only used to scope an index reset, so an unusual quoted path is skipped
// rather than guessed at.
func patchPaths(patch string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, line := range strings.Split(patch, "\n") {
		var raw string
		switch {
		case strings.HasPrefix(line, "+++ b/"):
			raw = strings.TrimPrefix(line, "+++ b/")
		case strings.HasPrefix(line, "--- a/"):
			raw = strings.TrimPrefix(line, "--- a/")
		default:
			continue
		}
		if raw == "" || strings.HasPrefix(raw, `"`) {
			continue
		}
		if !seen[raw] {
			seen[raw] = true
			out = append(out, raw)
		}
	}
	return out
}

// DropShelf deletes a shelf and the metadata that belongs to it.
func (r *Repo) DropShelf(ctx context.Context, name string) (string, error) {
	file, err := r.shelfFile(name)
	if err != nil {
		return "", err
	}
	if err := os.Remove(file); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("no shelf named %q", name)
		}
		return "", err
	}
	_ = os.Remove(file + ".index.patch")
	_ = os.Remove(file + ".json")
	return "dropped " + name, nil
}

// RenameShelf renames a shelf.
func (r *Repo) RenameShelf(ctx context.Context, name, newName string) error {
	from, err := r.shelfFile(name)
	if err != nil {
		return err
	}
	to, err := r.shelfFile(strings.TrimSpace(newName))
	if err != nil {
		return err
	}
	if _, err := os.Stat(to); err == nil {
		return fmt.Errorf("a shelf named %q already exists", newName)
	}
	if err := os.Rename(from, to); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("no shelf named %q", name)
		}
		return err
	}
	for _, suffix := range []string{".index.patch", ".json"} {
		if _, err := os.Stat(from + suffix); err == nil {
			if err := os.Rename(from+suffix, to+suffix); err != nil {
				return err
			}
		}
	}
	return nil
}

// LabelShelf stores a note beside a shelf.
func (r *Repo) LabelShelf(ctx context.Context, name, label string) error {
	file, err := r.shelfFile(name)
	if err != nil {
		return err
	}
	if _, err := os.Stat(file); err != nil {
		return fmt.Errorf("no shelf named %q", name)
	}
	meta := file + ".json"
	if strings.TrimSpace(label) == "" {
		_ = os.Remove(meta)
		return nil
	}
	data, err := json.Marshal(map[string]any{"label": label, "time": time.Now().Unix()})
	if err != nil {
		return err
	}
	return os.WriteFile(meta, data, 0o644)
}

// ClearStashes drops every stash entry.
func (r *Repo) ClearStashes(ctx context.Context) (string, error) {
	return r.writeRun(ctx, "stash", "clear")
}
