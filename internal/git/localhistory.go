package git

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// LocalHistoryEntry is one saved copy of a file's content.
type LocalHistoryEntry struct {
	Path   string `json:"path"`
	Time   int64  `json:"time"`
	Digest string `json:"digest"`
	Size   int    `json:"size"`
	Label  string `json:"label"`
}

const (
	// historyLimitPerFile keeps the latest copies of one file.
	historyLimitPerFile = 50
	// historyLimit keeps the newest copies of the whole repository.
	historyLimit = 5000
	// historyFileLimit skips files too large to copy every time they
	// change; they are also the ones that would fill the disk.
	historyFileLimit = 4 << 20
)

func (r *Repo) historyDir() string { return filepath.Join(r.gitDir, "gitjet-local-history") }
func (r *Repo) historyIndexPath() string {
	return filepath.Join(r.historyDir(), "index.json")
}

func (r *Repo) readHistory() []LocalHistoryEntry {
	data, err := os.ReadFile(r.historyIndexPath())
	if err != nil {
		return nil
	}
	var entries []LocalHistoryEntry
	if json.Unmarshal(data, &entries) != nil {
		return nil
	}
	return entries
}

func (r *Repo) writeHistory(entries []LocalHistoryEntry) error {
	if err := os.MkdirAll(r.historyDir(), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	tmp := r.historyIndexPath() + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, r.historyIndexPath())
}

// SnapshotLocal records the file's current content unless the newest entry
// already has exactly this content. It is best effort: a file that cannot
// be read is simply not recorded.
func (r *Repo) SnapshotLocal(path, label string) (LocalHistoryEntry, bool, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return LocalHistoryEntry{}, false, err
	}
	abs := r.AbsPath(clean)
	st, err := os.Stat(abs)
	if err != nil || st.IsDir() {
		return LocalHistoryEntry{}, false, nil
	}
	if st.Size() > historyFileLimit {
		return LocalHistoryEntry{}, false, nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return LocalHistoryEntry{}, false, nil
	}
	if bytes.IndexByte(data, 0) >= 0 {
		// A binary copy is not something the history viewer can show.
		return LocalHistoryEntry{}, false, nil
	}
	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])

	r.history.Lock()
	defer r.history.Unlock()
	entries := r.readHistory()
	// Only the newest entry for this path can be the same content. Turning
	// a file back into what it held an hour ago is a new step in its
	// history, not a duplicate of the older one.
	if n := len(entries); n > 0 {
		last := entries[n-1]
		if last.Path == clean && last.Digest == digest {
			if label != "" && last.Label != label {
				entries[n-1].Label = label
				_ = r.writeHistory(entries)
			}
			return last, false, nil
		}
	}
	if err := os.MkdirAll(filepath.Join(r.historyDir(), "blobs"), 0o755); err != nil {
		return LocalHistoryEntry{}, false, err
	}
	blob := filepath.Join(r.historyDir(), "blobs", digest)
	if _, err := os.Stat(blob); err != nil {
		if err := os.WriteFile(blob, data, 0o644); err != nil {
			return LocalHistoryEntry{}, false, err
		}
	}
	entry := LocalHistoryEntry{
		Path:   clean,
		Time:   time.Now().Unix(),
		Digest: digest,
		Size:   len(data),
		Label:  label,
	}
	entries = append(entries, entry)
	entries = pruneHistory(entries)
	if err := r.writeHistory(entries); err != nil {
		return entry, true, err
	}
	r.collectHistoryGarbage(entries)
	return entry, true, nil
}

// collectHistoryGarbage removes the blobs no entry refers to any more:
// pruning the index alone would let the history directory grow without a
// bound. The caller holds r.history.
func (r *Repo) collectHistoryGarbage(entries []LocalHistoryEntry) {
	live := make(map[string]bool, len(entries))
	for _, entry := range entries {
		live[entry.Digest] = true
	}
	dir := filepath.Join(r.historyDir(), "blobs")
	names, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, name := range names {
		if name.IsDir() || live[name.Name()] {
			continue
		}
		_ = os.Remove(filepath.Join(dir, name.Name()))
	}
}

// SnapshotChanged records every file in the working tree that has changes,
// which is how edits made outside the app still get a history.
func (r *Repo) SnapshotChanged(ctx context.Context, limit int) {
	if limit <= 0 {
		limit = 40
	}
	st, err := r.Status(ctx, false)
	if err != nil {
		return
	}
	count := 0
	for _, change := range st.Changes {
		if change.Unmerged || change.Kind == "ignored" {
			continue
		}
		if _, _, err := r.SnapshotLocal(change.Path, "external change"); err != nil {
			continue
		}
		count++
		if count >= limit {
			return
		}
	}
}

func pruneHistory(entries []LocalHistoryEntry) []LocalHistoryEntry {
	byPath := map[string]int{}
	kept := make([]LocalHistoryEntry, 0, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		entry := entries[i]
		byPath[entry.Path]++
		if byPath[entry.Path] > historyLimitPerFile {
			continue
		}
		kept = append(kept, entry)
	}
	// kept is newest first; restore oldest first for the caller.
	for i, j := 0, len(kept)-1; i < j; i, j = i+1, j-1 {
		kept[i], kept[j] = kept[j], kept[i]
	}
	if len(kept) > historyLimit {
		kept = kept[len(kept)-historyLimit:]
	}
	return kept
}

// LocalHistory lists a file's copies, newest first.
func (r *Repo) LocalHistory(path string) ([]LocalHistoryEntry, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return nil, err
	}
	r.history.Lock()
	entries := r.readHistory()
	r.history.Unlock()
	out := []LocalHistoryEntry{}
	for _, entry := range entries {
		if entry.Path == clean {
			out = append(out, entry)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	return out, nil
}

// LocalHistoryAll returns every saved copy in the repository, newest
// first, so the history can be browsed by path instead of one file at a
// time.
func (r *Repo) LocalHistoryAll() []LocalHistoryEntry {
	r.history.Lock()
	entries := r.readHistory()
	r.history.Unlock()
	out := append([]LocalHistoryEntry(nil), entries...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Time != out[j].Time {
			return out[i].Time > out[j].Time
		}
		return out[i].Path < out[j].Path
	})
	if len(out) > 2000 {
		out = out[:2000]
	}
	return out
}

// LocalHistoryContent reads one saved copy.
func (r *Repo) LocalHistoryContent(path, digest string) (string, error) {
	clean, err := cleanPath(path)
	if err != nil {
		return "", err
	}
	if !validDigest(digest) {
		return "", errors.New("invalid history entry")
	}
	r.history.Lock()
	entries := r.readHistory()
	r.history.Unlock()
	found := false
	for _, entry := range entries {
		if entry.Path == clean && entry.Digest == digest {
			found = true
			break
		}
	}
	if !found {
		return "", errors.New("this copy is no longer in the local history")
	}
	data, err := os.ReadFile(filepath.Join(r.historyDir(), "blobs", digest))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// RestoreLocalHistory writes a saved copy back to the working tree.
func (r *Repo) RestoreLocalHistory(path, digest string) error {
	clean, err := cleanPath(path)
	if err != nil {
		return err
	}
	text, err := r.LocalHistoryContent(clean, digest)
	if err != nil {
		return err
	}
	if st, err := os.Stat(r.AbsPath(clean)); err == nil && st.IsDir() {
		return fmt.Errorf("%s is a directory", clean)
	}
	return os.WriteFile(r.AbsPath(clean), []byte(text), 0o644)
}

// LabelLocalHistory names one copy, the way IDEA lets a history entry be
// labelled before a risky change.
func (r *Repo) LabelLocalHistory(path, digest, label string) error {
	clean, err := cleanPath(path)
	if err != nil {
		return err
	}
	if !validDigest(digest) {
		return errors.New("invalid history entry")
	}
	r.history.Lock()
	defer r.history.Unlock()
	entries := r.readHistory()
	found := false
	for i := range entries {
		if entries[i].Path == clean && entries[i].Digest == digest {
			entries[i].Label = strings.TrimSpace(label)
			found = true
		}
	}
	if !found {
		return errors.New("this copy is no longer in the local history")
	}
	return r.writeHistory(entries)
}

func validDigest(digest string) bool {
	if len(digest) != 64 {
		return false
	}
	_, err := hex.DecodeString(digest)
	return err == nil
}
