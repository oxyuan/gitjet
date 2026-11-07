package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// runGitFail runs git and returns its combined output without failing the
// test, for commands that are expected to stop on a conflict.
func runGitFail(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = gitEnv()
	out, _ := cmd.CombinedOutput()
	return string(out)
}

// startAmConflict makes an `am` stop on a patch that does not apply,
// leaving .git/rebase-apply/applying behind.
func startAmConflict(t *testing.T, dir string) {
	t.Helper()
	runGit(t, dir, "switch", "-q", "-c", "side")
	writeFile(t, dir, "a.txt", "side\n")
	runGit(t, dir, "commit", "-q", "-am", "side")
	patch := filepath.Join(t.TempDir(), "p.patch")
	out := runGit(t, dir, "format-patch", "-1", "--stdout")
	if err := os.WriteFile(patch, []byte(out), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "a.txt", "main\n")
	runGit(t, dir, "commit", "-q", "-am", "main")
	if text := runGitFail(t, dir, "am", patch); !strings.Contains(text, "patch failed") {
		t.Fatalf("am did not conflict: %s", text)
	}
}

func TestAbortOperationEndsAnAmConflict(t *testing.T) {
	repo, dir := newTestRepo(t)
	startAmConflict(t, dir)
	if op, _, _ := repo.operation(); op != "am" {
		t.Fatalf("operation = %q, want am", op)
	}
	if _, err := repo.AbortOperation(context.Background()); err != nil {
		t.Fatalf("AbortOperation: %v", err)
	}
	if op, _, _ := repo.operation(); op != "" {
		t.Fatalf("operation = %q after abort, want none", op)
	}
	if text, err := os.ReadFile(filepath.Join(dir, "a.txt")); err != nil || string(text) != "main\n" {
		t.Fatalf("a.txt = %q (%v), want the pre-am content", text, err)
	}
}

func TestContinueOperationFinishesAnAmConflict(t *testing.T) {
	repo, dir := newTestRepo(t)
	startAmConflict(t, dir)
	writeFile(t, dir, "a.txt", "resolved\n")
	runGit(t, dir, "add", "a.txt")
	if _, err := repo.ContinueOperation(context.Background()); err != nil {
		t.Fatalf("ContinueOperation: %v", err)
	}
	if op, _, _ := repo.operation(); op != "" {
		t.Fatalf("operation = %q after continue, want none", op)
	}
	if subject := runGit(t, dir, "log", "-1", "--format=%s"); subject != "side" {
		t.Fatalf("tip = %q, want the applied patch", subject)
	}
}

func TestSkipOperationDropsAConflictingCherryPick(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "switch", "-q", "-c", "side")
	writeFile(t, dir, "a.txt", "side\n")
	runGit(t, dir, "commit", "-q", "-am", "side")
	side := runGit(t, dir, "rev-parse", "HEAD")
	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "a.txt", "main\n")
	runGit(t, dir, "commit", "-q", "-am", "main")
	head := runGit(t, dir, "rev-parse", "HEAD")
	if out := runGitFail(t, dir, "cherry-pick", side); !strings.Contains(out, "conflict") {
		t.Fatalf("cherry-pick did not conflict: %s", out)
	}
	if op, _, _ := repo.operation(); op != "cherry-pick" {
		t.Fatalf("operation = %q, want cherry-pick", op)
	}
	if _, err := repo.SkipOperation(context.Background()); err != nil {
		t.Fatalf("SkipOperation: %v", err)
	}
	if op, _, _ := repo.operation(); op != "" {
		t.Fatalf("operation = %q after skip, want none", op)
	}
	if tip := runGit(t, dir, "rev-parse", "HEAD"); tip != head {
		t.Fatalf("tip = %s, want %s (the skipped commit must not be replayed)", tip, head)
	}
}
