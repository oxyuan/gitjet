package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIgnoreUntracksTrackedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "changed\n")

	if _, err := repo.Ignore(context.Background(), []string{"a.txt"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	if got := runGit(t, dir, "ls-files", "--", "a.txt"); got != "" {
		t.Errorf("tracked files = %q, want none", got)
	}
	if got := runGit(t, dir, "status", "--porcelain", "--", "a.txt"); got != "D  a.txt" {
		t.Errorf("status = %q, want staged deletion", got)
	}
	b, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil || string(b) != "changed\n" {
		t.Errorf("worktree file = %q, %v; want it untouched", b, err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != "/a.txt\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
}

func TestIgnoreUntracksTrackedDirectoryAndKeepsWorktree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "src/a.go", "package a\n")
	writeFile(t, dir, "src/b.go", "package b\n")
	runGit(t, dir, "add", "src")
	runGit(t, dir, "commit", "-q", "-m", "add src")
	writeFile(t, dir, "src/keep.txt", "untracked\n")

	if _, err := repo.Ignore(context.Background(), []string{"src"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	if got := runGit(t, dir, "ls-files", "--", "src"); got != "" {
		t.Errorf("tracked files = %q, want none", got)
	}
	for _, name := range []string{"src/a.go", "src/b.go", "src/keep.txt"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s is missing: %v", name, err)
		}
	}
	status := runGit(t, dir, "status", "--porcelain", "--", "src")
	if !strings.Contains(status, "D  src/a.go") || !strings.Contains(status, "D  src/b.go") {
		t.Errorf("status = %q, want both files staged as deleted", status)
	}
	if got := runGit(t, dir, "status", "--porcelain", "--", "src/keep.txt"); got != "" {
		t.Errorf("untracked file status = %q, want it ignored", got)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != "/src\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
}

func TestIgnoreLeavesUntrackedFileOnDisk(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "new\n")

	if _, err := repo.Ignore(context.Background(), []string{"new.txt"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	if got := runGit(t, dir, "ls-files", "--", "new.txt"); got != "" {
		t.Errorf("tracked files = %q, want none", got)
	}
	if got := runGit(t, dir, "status", "--porcelain", "--", "new.txt"); got != "" {
		t.Errorf("status = %q, want the ignored file to be absent", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "new.txt")); err != nil {
		t.Errorf("new.txt is missing: %v", err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != "/new.txt\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
}

func TestIgnoreEscapesGlobCharacters(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a[1].txt", "one\n")
	runGit(t, dir, "add", "a[1].txt")
	runGit(t, dir, "commit", "-q", "-m", "add bracket file")

	if _, err := repo.Ignore(context.Background(), []string{"a[1].txt"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != `/a\[1].txt`+"\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
	runGit(t, dir, "check-ignore", "-q", "a[1].txt")
}
