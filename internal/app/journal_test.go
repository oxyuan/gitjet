package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gitjet/internal/git"
)

// isolateConfig points configDir at a temp folder, so a journal written by a
// test never touches the real one.
func isolateConfig(t *testing.T) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("AppData", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
}

func TestAppendJournalRoundTrips(t *testing.T) {
	isolateConfig(t)
	root := t.TempDir()
	appendJournal(root, JournalEntry{
		At: 1, Action: "push", Source: "operation", Commands: []string{"git push"}, Output: "done\n",
	})
	appendJournal(root, JournalEntry{
		At: 2, Action: "console", Source: "console", Command: "git status", Output: "clean",
	})

	entries := readJournal(journalFile(root), 10)
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	if entries[0].Action != "push" || entries[1].Action != "console" {
		t.Fatalf("order = %q, %q", entries[0].Action, entries[1].Action)
	}
	if entries[0].ID == "" || entries[0].ID == entries[1].ID {
		t.Fatalf("ids = %q, %q", entries[0].ID, entries[1].ID)
	}
	if entries[0].Repo != root || entries[0].Output != "done\n" {
		t.Fatalf("entry = %+v", entries[0])
	}

	// Clearing a view is a page-side watermark; the file only ever grows.
	appendJournal(root, JournalEntry{At: 3, Action: "fetch"})
	if got := readJournal(journalFile(root), 10); len(got) != 3 {
		t.Fatalf("after append: %d entries, want 3", len(got))
	}
	tail := readJournal(journalFile(root), 2)
	if len(tail) != 2 || tail[1].Action != "fetch" {
		t.Fatalf("tail = %+v", tail)
	}
}

func TestReadJournalSkipsATruncatedFirstLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.jsonl")
	body := `{"id":"cut","acti` + "\n" + `{"id":"ok","action":"pull","at":2}` + "\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	got := readJournal(path, 10)
	if len(got) != 1 || got[0].ID != "ok" {
		t.Fatalf("got %+v", got)
	}
}

func TestReadJournalMissingFileIsEmpty(t *testing.T) {
	got := readJournal(filepath.Join(t.TempDir(), "absent.jsonl"), 10)
	if got == nil || len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
}

// TestResetIsJournaled drives a real operation, so the recording in the
// service method and the read path are exercised together.
func TestResetIsJournaled(t *testing.T) {
	isolateConfig(t)
	dir := t.TempDir()
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_CONFIG_GLOBAL="+filepath.Join(dir, ".gitconfig-missing"),
			"GIT_CONFIG_SYSTEM="+filepath.Join(dir, ".gitconfig-missing"),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	runGit("init", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "a.txt")
	runGit("commit", "-m", "one")

	repo, err := git.Open(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	g := &Git{c: &core{repo: repo}}

	out, err := g.Reset("HEAD", "mixed")
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
	if !strings.Contains(out, "$ git reset") {
		t.Fatalf("operation output lost its command echo: %q", out)
	}

	entries, err := g.Journal(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("entries = %+v", entries)
	}
	entry := entries[0]
	if entry.Action != "reset" || entry.Source != "operation" {
		t.Fatalf("entry = %+v", entry)
	}
	if len(entry.Commands) == 0 || !strings.HasPrefix(entry.Commands[0], "git reset") {
		t.Fatalf("commands = %+v", entry.Commands)
	}
}
