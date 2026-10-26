package git

import (
	"context"
	"testing"
)

// withRemote gives the test repository a bare origin that already has main,
// so a preview can compare against something real.
func withRemote(t *testing.T, dir string) {
	t.Helper()
	bare := t.TempDir()
	runGit(t, bare, "init", "-q", "--bare", "-b", "main")
	runGit(t, dir, "remote", "add", "origin", bare)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")
}

func TestPushPreviewListsCommitsAndFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	runGit(t, dir, "commit", "-q", "-am", "second")
	writeFile(t, dir, "b.txt", "new\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "third")

	p, err := repo.PushPreview(context.Background(), "origin", "main")
	if err != nil {
		t.Fatalf("PushPreview: %v", err)
	}
	if p.Creates {
		t.Error("Creates = true, want false: origin/main exists")
	}
	if p.Ahead != 2 {
		t.Errorf("Ahead = %d, want 2", p.Ahead)
	}
	if p.Behind != 0 {
		t.Errorf("Behind = %d, want 0", p.Behind)
	}
	if len(p.Commits) != 2 {
		t.Fatalf("len(Commits) = %d, want 2", len(p.Commits))
	}
	if p.Commits[0].Subject != "third" {
		t.Errorf("first commit = %q, want the newest", p.Commits[0].Subject)
	}
	if len(p.Files) != 2 {
		t.Fatalf("len(Files) = %d, want 2: %+v", len(p.Files), p.Files)
	}
	if p.Files[0].Path != "a.txt" || p.Files[0].Additions != 1 {
		t.Errorf("first file = %+v, want a.txt with one added line", p.Files[0])
	}
}

// A branch the remote has never seen has to report the branch's own work,
// not the history it was cut from, and it has to say that the push creates
// the remote branch.
func TestPushPreviewOfANewBranchComparesWithTheRemoteBranchItCameFrom(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	runGit(t, dir, "switch", "-q", "-c", "feature")
	writeFile(t, dir, "feature.txt", "work\n")
	runGit(t, dir, "add", "feature.txt")
	runGit(t, dir, "commit", "-q", "-m", "feature work")

	p, err := repo.PushPreview(context.Background(), "origin", "feature")
	if err != nil {
		t.Fatalf("PushPreview: %v", err)
	}
	if !p.Creates {
		t.Error("Creates = false, want true: origin/feature does not exist")
	}
	if p.Ahead != 1 {
		t.Errorf("Ahead = %d, want 1: only the branch's own commit is new", p.Ahead)
	}
	if len(p.Commits) != 1 || p.Commits[0].Subject != "feature work" {
		t.Errorf("Commits = %+v, want only the feature commit", p.Commits)
	}
	if len(p.Files) != 1 || p.Files[0].Path != "feature.txt" {
		t.Errorf("Files = %+v, want only feature.txt", p.Files)
	}
	if p.Head == "" {
		t.Error("Head is empty, want the branch tip")
	}
}

func TestPushPreviewRejectsAnUnknownBranch(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	if _, err := repo.PushPreview(context.Background(), "origin", "nope"); err == nil {
		t.Fatal("PushPreview accepted a branch that does not exist")
	}
	if _, err := repo.PushPreview(context.Background(), "origin", "-x"); err == nil {
		t.Fatal("PushPreview accepted a branch name that looks like an option")
	}
}
