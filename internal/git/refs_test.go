package git

import (
	"context"
	"os"
	"os/exec"
	"testing"
)

func TestRefsAheadWithoutUpstream(t *testing.T) {
	dir := t.TempDir()
	sh := func(args ...string) {
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=a", "GIT_AUTHOR_EMAIL=a@b", "GIT_COMMITTER_NAME=a", "GIT_COMMITTER_EMAIL=a@b",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", args, out)
		}
	}
	sh("init", "-q", "-b", "main")
	sh("commit", "-q", "--allow-empty", "-m", "one")
	remote := t.TempDir()
	sh("clone", "-q", "--bare", dir, remote)
	sh("remote", "add", "origin", remote)
	sh("fetch", "-q", "origin")
	// Push without setting an upstream, then move ahead of the remote.
	sh("push", "-q", "origin", "main:refs/heads/main")
	sh("commit", "-q", "--allow-empty", "-m", "two")
	sh("commit", "-q", "--allow-empty", "-m", "three")
	// Rebuild the remote refs the app sees.
	sh("fetch", "-q", "origin")

	repo, err := Open(context.Background(), dir, "")
	if err != nil {
		t.Fatal(err)
	}
	snap, err := repo.Refs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Local) == 0 {
		t.Fatal("no local branches")
	}
	got := snap.Local[0]
	if got.Upstream != "" {
		t.Fatalf("upstream should be empty, got %q", got.Upstream)
	}
	if got.Ahead != 2 || got.Behind != 0 {
		t.Fatalf("ahead/behind = %d/%d, want 2/0", got.Ahead, got.Behind)
	}
}
