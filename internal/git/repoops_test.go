package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorktreeLockAndUnlock(t *testing.T) {
	repo, _ := newTestRepo(t)
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "tree")
	if _, err := repo.AddWorktree(ctx, path, "topic", true); err != nil {
		t.Fatalf("AddWorktree: %v", err)
	}
	if _, err := repo.LockWorktree(ctx, path, "on a removable disk"); err != nil {
		t.Fatalf("LockWorktree: %v", err)
	}
	trees, err := repo.Worktrees(ctx)
	if err != nil {
		t.Fatal(err)
	}
	locked := false
	for _, tree := range trees {
		if samePath(tree.Path, path) && tree.Locked {
			locked = true
		}
	}
	if !locked {
		t.Fatalf("worktree is not locked: %+v", trees)
	}
	if _, err := repo.UnlockWorktree(ctx, path); err != nil {
		t.Fatalf("UnlockWorktree: %v", err)
	}
	trees, _ = repo.Worktrees(ctx)
	for _, tree := range trees {
		if samePath(tree.Path, path) && tree.Locked {
			t.Fatal("worktree is still locked")
		}
	}
}

func TestAddWorktreeCopiesTheIncludeFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, ".worktreeinclude", "settings/local.json\n# a comment\n")
	writeFile(t, dir, "settings/local.json", "{\"x\":1}\n")
	path := filepath.Join(t.TempDir(), "tree")
	if _, err := repo.AddWorktree(context.Background(), path, "topic", true); err != nil {
		t.Fatalf("AddWorktree: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(path, "settings", "local.json"))
	if err != nil || string(data) != "{\"x\":1}\n" {
		t.Fatalf("include file = %q (%v)", data, err)
	}
}

func TestAddSubmoduleAndSync(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	source := t.TempDir()
	runGit(t, source, "init", "-q", "-b", "main")
	writeFile(t, source, "lib.txt", "lib\n")
	runGit(t, source, "add", ".")
	runGit(t, source, "commit", "-q", "-m", "lib")
	// A local path is a file transport, which git refuses for submodules
	// unless the repository allows it.
	runGit(t, dir, "config", "--global", "protocol.file.allow", "always")
	if _, err := repo.AddSubmodule(ctx, source, "vendor/lib", ""); err != nil {
		t.Fatalf("AddSubmodule: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, ".gitmodules"))
	if err != nil || !strings.Contains(string(data), "vendor/lib") {
		t.Fatalf(".gitmodules = %q (%v)", data, err)
	}
	if _, err := repo.SyncSubmodules(ctx); err != nil {
		t.Fatalf("SyncSubmodules: %v", err)
	}
}

func TestLFSTrackWritesGitattributes(t *testing.T) {
	repo, dir := newTestRepo(t)
	if _, err := repo.run(context.Background(), "lfs", "version"); err != nil {
		t.Skip("git-lfs is not installed")
	}
	if _, err := repo.LFSTrack(context.Background(), []string{"*.bin"}); err != nil {
		t.Fatalf("LFSTrack: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, ".gitattributes"))
	if err != nil || !strings.Contains(string(data), "*.bin") {
		t.Fatalf(".gitattributes = %q (%v)", data, err)
	}
	if _, err := repo.LFSUntrack(context.Background(), []string{"*.bin"}); err != nil {
		t.Fatalf("LFSUntrack: %v", err)
	}
}
