package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// MergePreviewRequest names the conflicted path and the three labels the
// conflict markers should carry.
type MergePreviewRequest struct {
	Path   string `json:"path"`
	Ours   string `json:"ours"`
	Base   string `json:"base"`
	Theirs string `json:"theirs"`
}

// MergePreview is the three-way merge of a conflicted file, computed from
// the index stages alone.
type MergePreview struct {
	Path string `json:"path"`
	// Content is the merged text, with markers around the blocks both
	// sides changed differently.
	Content string `json:"content"`
	// Conflicts counts those marker blocks.
	Conflicts int  `json:"conflicts"`
	HasBase   bool `json:"hasBase"`
	HasOurs   bool `json:"hasOurs"`
	HasTheirs bool `json:"hasTheirs"`
}

// MergePreview merges the three stages of a conflicted path. Nothing is read
// from or written to the working tree and no temporary file is involved: the
// merge is the answer to "what would a full three-way merge of this file be",
// before deciding to keep it.
func (r *Repo) MergePreview(ctx context.Context, req MergePreviewRequest) (MergePreview, error) {
	c, err := r.Conflict(ctx, req.Path)
	if err != nil {
		return MergePreview{}, err
	}
	preview := MergePreview{
		Path:      c.Path,
		HasBase:   c.HasBase,
		HasOurs:   c.HasOurs,
		HasTheirs: c.HasTheirs,
	}
	switch {
	case c.Binary:
		return preview, errors.New("this conflict is binary; choose a side instead")
	case c.Kind != "file":
		return preview, errors.New("only a text file can be merged line by line; choose a side instead")
	}
	content, conflicts := MergeText(c.Base, c.Ours, c.Theirs, MergeLabels{
		Ours:   req.Ours,
		Base:   req.Base,
		Theirs: req.Theirs,
	})
	preview.Content = content
	preview.Conflicts = conflicts
	return preview, nil
}

// ResolveInMemory stages content as the resolution of path without letting
// git read the working tree: the blob is written from the bytes in hand and
// the index entry is replaced directly. The file is written afterwards when
// writeWorktree is true, so git status matches the index; a caller that only
// wants the resolution recorded can leave the markers on disk.
func (r *Repo) ResolveInMemory(ctx context.Context, path, content string, writeWorktree bool) (string, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return "", err
	}
	r.write.Lock()
	defer r.write.Unlock()
	if err := refuseTextTarget(r, clean); err != nil {
		return "", err
	}
	// --path applies the repository's filters: an eol or ident rule must
	// reach the blob exactly as "git add" would have written it.
	oidOut, err := r.runInput(ctx, content, "hash-object", "-w", "--stdin", "--path="+clean)
	if err != nil {
		return "", err
	}
	oid := strings.TrimSpace(oidOut)
	if oid == "" {
		return "", errors.New("git did not return an object for the merge result")
	}
	mode := r.mergeMode(ctx, clean)
	entry := fmt.Sprintf("%s %s\t%s\x00", mode, oid, clean)
	if _, err := r.runInput(ctx, entry, "update-index", "-z", "--index-info"); err != nil {
		return "", err
	}
	if writeWorktree {
		if err := writeWorkingFile(r, clean, content, mode); err != nil {
			return oid, err
		}
	}
	return oid, nil
}

// mergeMode is the mode the resolution should be recorded with: the stage
// git kept for the file, or the mode it already has in the index.
func (r *Repo) mergeMode(ctx context.Context, path string) string {
	if out, err := r.run(ctx, "ls-files", "-u", "-s", "-z", "--", literalPath(path)); err == nil {
		byStage := map[string]string{}
		for _, record := range strings.Split(out, "\x00") {
			meta, _, ok := strings.Cut(record, "\t")
			if !ok {
				continue
			}
			fields := strings.Fields(meta)
			if len(fields) < 3 {
				continue
			}
			byStage[fields[2]] = fields[0]
		}
		for _, stage := range []string{"2", "3", "1"} {
			if mode := byStage[stage]; mode != "" {
				return mode
			}
		}
	}
	if out, err := r.run(ctx, "ls-files", "-s", "-z", "--", literalPath(path)); err == nil {
		for _, record := range strings.Split(out, "\x00") {
			meta, _, ok := strings.Cut(record, "\t")
			if !ok {
				continue
			}
			if fields := strings.Fields(meta); len(fields) >= 3 {
				return fields[0]
			}
		}
	}
	return "100644"
}

// refuseTextTarget rejects the conflict kinds a text resolution cannot
// write: writing through a link changes its target, and a submodule is a
// directory git tracks by commit.
func refuseTextTarget(r *Repo, path string) error {
	fi, err := os.Lstat(r.AbsPath(path))
	if err != nil {
		return nil
	}
	switch {
	case fi.Mode()&os.ModeSymlink != 0:
		return errors.New("this conflict is a symbolic link; choose a side instead")
	case fi.IsDir():
		return errors.New("this conflict is a directory; choose a side instead")
	}
	return nil
}

// writeWorkingFile writes the merged text to the working tree with the mode
// the index records, so a script that became executable stays executable.
func writeWorkingFile(r *Repo, path, content, mode string) error {
	abs := r.AbsPath(path)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	perm := os.FileMode(0o644)
	if mode == "100755" {
		perm = 0o755
	}
	if err := os.WriteFile(abs, []byte(content), perm); err != nil {
		return err
	}
	// os.WriteFile only applies perm to a file it creates; an existing file
	// keeps its mode, so an executable that stays executable needs this.
	if info, err := os.Stat(abs); err == nil && info.Mode().Perm() != perm {
		return os.Chmod(abs, perm)
	}
	return nil
}

// SaveResolution writes the result pane of the merge editor. Staging goes
// through the same bytes the editor holds — the file on disk is never what
// gets staged — so a write that failed halfway cannot stage something else.
func (r *Repo) SaveResolution(ctx context.Context, path, content string, stage bool) error {
	clean, err := cleanPath(path)
	if err != nil {
		return err
	}
	if stage {
		_, err := r.ResolveInMemory(ctx, clean, content, true)
		return err
	}
	r.write.Lock()
	defer r.write.Unlock()
	if err := refuseTextTarget(r, clean); err != nil {
		return err
	}
	return writeWorkingFile(r, clean, content, r.mergeMode(ctx, clean))
}
