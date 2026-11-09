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

func newServiceRepo(t *testing.T) (*git.Repo, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(home, "gitconfig"))
	t.Setenv("GIT_CONFIG_SYSTEM", filepath.Join(home, "gitconfig-system"))
	dir := t.TempDir()
	runServiceGit(t, dir, "init", "-q", "-b", "main")
	runServiceGit(t, dir, "config", "user.email", "test@example.com")
	runServiceGit(t, dir, "config", "user.name", "Test")
	writeServiceFile(t, dir, "f.txt", "base\n")
	writeServiceFile(t, dir, "g.txt", "clean\n")
	runServiceGit(t, dir, "add", ".")
	runServiceGit(t, dir, "commit", "-q", "-m", "base")
	repo, err := git.Open(context.Background(), dir, "")
	if err != nil {
		t.Fatalf("git.Open: %v", err)
	}
	return repo, dir
}

func runServiceGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func writeServiceFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPreserveLocalChangesKeepsStashWhenTheMergeConflicts(t *testing.T) {
	repo, dir := newServiceRepo(t)
	runServiceGit(t, dir, "checkout", "-q", "-b", "other")
	writeServiceFile(t, dir, "f.txt", "other\n")
	runServiceGit(t, dir, "commit", "-qam", "other")
	runServiceGit(t, dir, "checkout", "-q", "main")
	writeServiceFile(t, dir, "f.txt", "main\n")
	runServiceGit(t, dir, "commit", "-qam", "main")
	writeServiceFile(t, dir, "g.txt", "dirty\n")

	out, err := preserveLocalChanges(context.Background(), repo, "merging", func() (string, error) {
		return repo.Merge(context.Background(), "other", git.MergeOptions{})
	})
	if err == nil {
		t.Fatalf("merge did not report the conflict (out=%q)", out)
	}
	stashes, serr := repo.Stashes(context.Background())
	if serr != nil || len(stashes) != 1 {
		t.Fatalf("stashes = %+v, %v; want the saved changes kept", stashes, serr)
	}
	if !strings.Contains(stashes[0].Message, "gitjet: before merging") {
		t.Fatalf("stash message = %q", stashes[0].Message)
	}
	b, rerr := os.ReadFile(filepath.Join(dir, "g.txt"))
	if rerr != nil || string(b) != "clean\n" {
		t.Fatalf("g.txt = %q, %v; want the pre-merge content until the stash is applied", b, rerr)
	}
	st, serr := repo.Status(context.Background(), false)
	if serr != nil || !hasUnmerged(st.Changes) {
		t.Fatalf("changes = %v, %v; want the merge left stopped on a conflict", st.Changes, serr)
	}
}

func TestPreserveLocalChangesRestoresItsOwnStash(t *testing.T) {
	repo, dir := newServiceRepo(t)
	writeServiceFile(t, dir, "g.txt", "user stash\n")
	runServiceGit(t, dir, "stash", "push", "-q", "-m", "user stash")
	writeServiceFile(t, dir, "g.txt", "operation dirt\n")

	out, err := preserveLocalChanges(context.Background(), repo, "pulling", func() (string, error) {
		return "done", nil
	})
	if err != nil {
		t.Fatalf("preserveLocalChanges: %v, out=%q", err, out)
	}
	b, rerr := os.ReadFile(filepath.Join(dir, "g.txt"))
	if rerr != nil || string(b) != "operation dirt\n" {
		t.Fatalf("g.txt = %q, %v; want the saved changes restored", b, rerr)
	}
	stashes, serr := repo.Stashes(context.Background())
	if serr != nil || len(stashes) != 1 || !strings.Contains(stashes[0].Message, "user stash") {
		t.Fatalf("stashes = %+v, %v; want the user's own stash untouched", stashes, serr)
	}
	if !strings.Contains(out, "stashed before pulling and restored") {
		t.Fatalf("output = %q, want the restore note", out)
	}
}
