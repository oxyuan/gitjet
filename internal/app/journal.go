package app

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"gitjet/internal/git"
)

// JournalEntry is one command the app ran for the user: what it did, the git
// invocations behind it, and everything they printed. Entries are
// append-only — clearing a view in the page never removes one.
type JournalEntry struct {
	ID       string   `json:"id"`
	At       int64    `json:"at"` // unix milliseconds
	Repo     string   `json:"repo"`
	Action   string   `json:"action"`  // pull, push, console, ...
	Source   string   `json:"source"`  // operation | console
	Command  string   `json:"command"` // the line typed in the console, "" otherwise
	Commands []string `json:"commands"`
	Output   string   `json:"output"`
	ExitCode int      `json:"exitCode"`
	Duration int64    `json:"duration"` // milliseconds
	Error    string   `json:"error"`
}

const (
	journalDefaultLimit = 500
	journalMaxLimit     = 2000
	// journalReadCap bounds what one page load copies. Older entries stay in
	// the file; the view does not need a year of pushes at once.
	journalReadCap = 8 << 20
)

// journalMu serialises appends: two operations finishing together would
// otherwise interleave a half-written line and lose both.
var (
	journalMu  sync.Mutex
	journalSeq int64
)

// journalFile names the journal after the repository folder, so the file is
// recognisable when the file manager opens it, plus a digest so two clones
// with the same folder name get separate journals.
func journalFile(root string) string {
	root = filepath.Clean(root)
	sum := sha1.Sum([]byte(root))
	name := sanitizeFileName(filepath.Base(root))
	if name == "" || name == "." {
		name = "repo"
	}
	return filepath.Join(configDir(), "logs", fmt.Sprintf("%s-%s.jsonl", name, hex.EncodeToString(sum[:])[:12]))
}

func sanitizeFileName(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	return strings.Trim(b.String(), ".-")
}

// appendJournal writes one entry. The journal is a diagnostic trail, so a
// write that fails is dropped instead of failing the command it records.
func appendJournal(root string, e JournalEntry) {
	path := journalFile(root)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	journalMu.Lock()
	defer journalMu.Unlock()
	journalSeq++
	e.Repo = filepath.Clean(root)
	e.ID = strconv.FormatInt(e.At, 36) + "-" + strconv.Itoa(os.Getpid()) + "-" + strconv.FormatInt(journalSeq, 36)
	line, err := json.Marshal(e)
	if err != nil {
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(line, '\n'))
}

// readJournal returns the newest entries of a repository's journal, oldest
// first. It reads backwards from the end of the file, so a journal that has
// grown for months loads as fast as a fresh one.
func readJournal(path string, limit int) []JournalEntry {
	if limit <= 0 {
		limit = journalDefaultLimit
	}
	if limit > journalMaxLimit {
		limit = journalMaxLimit
	}
	entries := []JournalEntry{}
	f, err := os.Open(path)
	if err != nil {
		return entries
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.Size() == 0 {
		return entries
	}
	return parseJournal(tailLines(f, st.Size(), limit), limit)
}

// tailLines reads the last limit+1 lines of f, or as much as journalReadCap
// allows, working backwards in 64 KiB blocks.
func tailLines(f *os.File, size int64, limit int) []byte {
	const block = 64 << 10
	var chunks [][]byte
	total, newlines := 0, 0
	for pos := size; pos > 0 && newlines <= limit && total < journalReadCap; {
		n := int64(block)
		if n > pos {
			n = pos
		}
		pos -= n
		chunk := make([]byte, n)
		if _, err := f.ReadAt(chunk, pos); err != nil {
			return nil
		}
		chunks = append(chunks, chunk)
		total += int(n)
		newlines += bytes.Count(chunk, []byte{'\n'})
	}
	out := make([]byte, 0, total)
	for i := len(chunks) - 1; i >= 0; i-- {
		out = append(out, chunks[i]...)
	}
	return out
}

func parseJournal(data []byte, limit int) []JournalEntry {
	entries := []JournalEntry{}
	for _, line := range bytes.Split(data, []byte{'\n'}) {
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var e JournalEntry
		// A line cut in half by the read window is not JSON; skipping it is
		// what keeps a truncated first line from hiding everything else.
		if json.Unmarshal(line, &e) != nil {
			continue
		}
		entries = append(entries, e)
	}
	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	return entries
}

// journalOperation records one finished operation. exitCode is what git
// reported; a failure that never ran keeps -1, so the log tells the two
// apart.
func (g *Git) journalOperation(repo *git.Repo, e JournalEntry, err error, started time.Time) {
	e.At = started.UnixMilli()
	e.Duration = time.Since(started).Milliseconds()
	e.Output = strings.TrimRight(e.Output, "\n")
	// The page maps over commands; a nil slice would arrive as null.
	if e.Commands == nil {
		e.Commands = []string{}
	}
	if e.Source == "" {
		e.Source = "operation"
	}
	if err != nil {
		e.Error = err.Error()
		if e.ExitCode == 0 {
			var gerr *git.Error
			if errors.As(err, &gerr) {
				e.ExitCode = gerr.Code
			} else {
				e.ExitCode = -1
			}
		}
	}
	appendJournal(repo.Dir(), e)
}

// Journal returns the newest recorded operations of the open repository,
// oldest first. Clearing a view never shortens this history.
func (g *Git) Journal(limit int) ([]JournalEntry, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return []JournalEntry{}, err
	}
	return readJournal(journalFile(repo.Dir()), limit), nil
}

// JournalFile returns where the journal is stored, creating it so the file
// manager has something to show.
func (g *Git) JournalFile() (string, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return "", err
	}
	path := journalFile(repo.Dir())
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", err
	}
	if f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		f.Close()
	}
	return path, nil
}

// RevealJournal shows the journal in the file manager and returns its path.
func (g *Git) RevealJournal() (string, error) {
	path, err := g.JournalFile()
	if err != nil {
		return "", err
	}
	return path, revealPath(path)
}
