package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCloneCopiesTheRepositoryIntoAnEmptyFolder(t *testing.T) {
	_, src := newTestRepo(t)
	dest := filepath.Join(t.TempDir(), "copy")
	var lines []string
	if _, err := Clone(context.Background(), "", src, dest, func(line string) { lines = append(lines, line) }); err != nil {
		t.Fatalf("Clone: %v", err)
	}
	if text, err := os.ReadFile(filepath.Join(dest, "a.txt")); err != nil || string(text) != "one\ntwo\n" {
		t.Fatalf("a.txt = %q (%v)", text, err)
	}
	if len(lines) == 0 || !strings.HasPrefix(lines[0], "$ git clone") {
		t.Fatalf("progress did not start with the command: %v", lines)
	}
	repo, err := Open(context.Background(), dest, "")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	want, _ := filepath.EvalSymlinks(dest)
	if repo.Dir() != want {
		t.Fatalf("Dir = %q, want %q", repo.Dir(), want)
	}
}

func TestCloneRefusesANonEmptyTarget(t *testing.T) {
	_, src := newTestRepo(t)
	dest := t.TempDir()
	writeFile(t, dest, "leftover.txt", "x\n")
	if _, err := Clone(context.Background(), "", src, dest, nil); err == nil || !strings.Contains(err.Error(), "not empty") {
		t.Fatalf("Clone = %v, want a non-empty target error", err)
	}
}

func TestInitRepoNamesTheInitialBranch(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "made")
	if _, err := InitRepo(context.Background(), "", dir, "trunk"); err != nil {
		t.Fatalf("InitRepo: %v", err)
	}
	repo, err := Open(context.Background(), dir, "")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if branch := strings.TrimSpace(runGit(t, repo.Dir(), "symbolic-ref", "--short", "HEAD")); branch != "trunk" {
		t.Fatalf("HEAD = %q, want trunk", branch)
	}
}

func TestInitRepoRejectsAPathInsideARepository(t *testing.T) {
	_, dir := newTestRepo(t)
	if _, err := InitRepo(context.Background(), "", filepath.Join(dir, "sub"), "main"); err == nil {
		t.Fatal("InitRepo accepted a path inside a working tree")
	}
}
