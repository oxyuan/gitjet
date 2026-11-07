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
			base := emptyTree
			if len(parents) > 0 {
				base = parents[0]
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
		args = append(args, clean...)
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
func (r *Repo) SaveShelf(ctx context.Context, name string, opts PatchOptions) (Shelf, error) {
	name = strings.TrimSpace(name)
	file, err := r.shelfFile(name)
	if err != nil {
		return Shelf{}, err
	}
	if _, err := os.Stat(file); err == nil {
		return Shelf{}, fmt.Errorf("a shelf named %q already exists", name)
	}
	patch, err := r.CreatePatch(ctx, opts)
	if err != nil {
		return Shelf{}, err
	}
	if strings.TrimSpace(patch) == "" {
		return Shelf{}, errors.New("there are no changes to shelve")
	}
	if err := os.MkdirAll(r.shelfDir(), 0o755); err != nil {
		return Shelf{}, err
	}
	if err := os.WriteFile(file, []byte(patch), 0o644); err != nil {
		return Shelf{}, err
	}
	// Shelving takes the changes away: keep them only in the patch.
	if len(opts.Paths) > 0 {
		if err := r.Rollback(ctx, opts.Paths); err != nil {
			return Shelf{}, err
		}
	} else if _, err := r.Reset(ctx, "HEAD", "hard"); err != nil {
		return Shelf{}, err
	}
	return shelfFromPatch(name, file, patch)
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
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".patch") {
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
	out, err := r.ApplyPatch(ctx, patch, false, false)
	if err != nil {
		return out, err
	}
	if drop {
		if _, err := r.DropShelf(ctx, name); err != nil {
			return out, err
		}
	}
	return out, nil
}

// DropShelf deletes a shelf.
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
