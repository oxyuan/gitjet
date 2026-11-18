package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

	p, err := repo.PushPreview(context.Background(), "origin", "main", "")
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

	p, err := repo.PushPreview(context.Background(), "origin", "feature", "")
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
	// Nothing exists on the remote to be behind or to overwrite: a new
	// branch that grew from origin/main must not report itself as diverged.
	if p.Behind != 0 || p.Diverged {
		t.Errorf("Behind = %d, Diverged = %v, want 0 and false", p.Behind, p.Diverged)
	}
}

func TestPushPreviewRejectsAnUnknownBranch(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	if _, err := repo.PushPreview(context.Background(), "origin", "nope", ""); err == nil {
		t.Fatal("PushPreview accepted a branch that does not exist")
	}
	if _, err := repo.PushPreview(context.Background(), "origin", "-x", ""); err == nil {
		t.Fatal("PushPreview accepted a branch name that looks like an option")
	}
}

func TestPushPreviewTargetsAnotherRemoteBranch(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	writeFile(t, dir, "a.txt", "a\n")
	runGit(t, dir, "commit", "-q", "-am", "one")

	p, err := repo.PushPreview(context.Background(), "origin", "main", "release")
	if err != nil {
		t.Fatal(err)
	}
	if p.RemoteBranch != "origin/release" {
		t.Fatalf("remote branch = %q, want origin/release", p.RemoteBranch)
	}
	if !p.Creates {
		t.Fatal("a remote branch that does not exist yet should be reported as created")
	}
	if p.Branch != "main" {
		t.Fatalf("local branch = %q, want main", p.Branch)
	}
	if _, err := repo.PushPreview(context.Background(), "origin", "main", "bad..name"); err == nil {
		t.Fatal("an invalid target branch should be refused")
	}
}

func TestPushToAnotherRemoteBranchPublishesThatRef(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	writeFile(t, dir, "a.txt", "changed\n")
	runGit(t, dir, "commit", "-q", "-am", "work")
	head := runGit(t, dir, "rev-parse", "HEAD")

	if _, err := repo.Push(context.Background(), PushOptions{Remote: "origin", Branch: "main", RemoteBranch: "release"}, func(string) {}); err != nil {
		t.Fatalf("Push: %v", err)
	}
	bare := strings.TrimSpace(runGit(t, dir, "remote", "get-url", "origin"))
	got := strings.TrimSpace(runGit(t, dir, "--git-dir="+bare, "rev-parse", "refs/heads/release"))
	if got != head {
		t.Fatalf("origin release = %s, want %s", got, head)
	}
	if strings.TrimSpace(runGit(t, dir, "--git-dir="+bare, "rev-parse", "refs/heads/main")) == head {
		t.Fatal("main on the remote moved too; the refspec did not name the branch")
	}
}

func TestPushPreviewAndPushWorkFromADetachedHead(t *testing.T) {
	repo, dir := newTestRepo(t)
	remote := t.TempDir()
	runGit(t, remote, "init", "-q", "--bare")
	runGit(t, dir, "remote", "add", "origin", remote)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")

	runGit(t, dir, "checkout", "-q", "--detach")
	writeFile(t, dir, "detached.txt", "one\n")
	runGit(t, dir, "add", "detached.txt")
	runGit(t, dir, "commit", "-q", "-m", "detached work")

	preview, err := repo.PushPreview(context.Background(), "origin", "", "detached-work")
	if err != nil {
		t.Fatalf("PushPreview: %v", err)
	}
	if preview.Head == "" || !preview.Creates {
		t.Fatalf("preview = %+v, want the detached commit and a new branch", preview)
	}
	if _, err := repo.Push(context.Background(), PushOptions{Remote: "origin", RemoteBranch: "detached-work"}, func(string) {}); err != nil {
		t.Fatalf("Push: %v", err)
	}
	if got := runGit(t, remote, "rev-parse", "refs/heads/detached-work"); got == "" {
		t.Fatal("the detached commit was not published")
	}
	if shown := runGit(t, remote, "show", "--format=", "--name-only", "refs/heads/detached-work"); shown != "detached.txt" {
		t.Fatalf("published tree = %q", shown)
	}
}

func TestPushRunsPrePushHooksUnlessSkipped(t *testing.T) {
	repo, dir := newTestRepo(t)
	withRemote(t, dir)
	hook := filepath.Join(dir, ".git", "hooks", "pre-push")
	if err := os.MkdirAll(filepath.Dir(hook), 0o755); err != nil {
		t.Fatalf("mkdir hooks: %v", err)
	}
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatalf("write hook: %v", err)
	}
	writeFile(t, dir, "a.txt", "work\n")
	runGit(t, dir, "commit", "-q", "-am", "work")

	opts := PushOptions{Remote: "origin", Branch: "main"}
	if _, err := repo.Push(context.Background(), opts, func(string) {}); err == nil {
		t.Fatal("Push ignored the failing pre-push hook")
	}
	opts.SkipHooks = true
	if _, err := repo.Push(context.Background(), opts, func(string) {}); err != nil {
		t.Fatalf("Push with SkipHooks: %v", err)
	}
	if got := strings.TrimSpace(runGit(t, dir, "rev-parse", "origin/main")); got != strings.TrimSpace(runGit(t, dir, "rev-parse", "HEAD")) {
		t.Fatalf("origin/main = %s, want HEAD", got)
	}
}

// TestPushStopsAtTheChosenCommit covers the push dialog's unticked commits:
// the branch is sent only up to the newest included commit, and the newer
// ones stay local.
func TestPushStopsAtTheChosenCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	bare := t.TempDir()
	runGit(t, bare, "init", "-q", "--bare", "-b", "main")
	runGit(t, dir, "remote", "add", "origin", bare)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	runGit(t, dir, "commit", "-q", "-am", "second")
	cut := runGit(t, dir, "rev-parse", "HEAD~1")

	if _, err := repo.Push(context.Background(), PushOptions{Remote: "origin", Branch: "main", ToCommit: cut}, func(string) {}); err != nil {
		t.Fatalf("Push: %v", err)
	}
	if got := runGit(t, bare, "rev-parse", "refs/heads/main"); got != cut {
		t.Fatalf("remote main = %s, want the chosen commit %s", got, cut)
	}
	if got := runGit(t, dir, "rev-parse", "HEAD"); got == cut {
		t.Fatal("the local branch moved; the cut only limits the push")
	}
}

// TestPushTagModes covers the push dialog's two tag choices: --follow-tags
// sends the annotated tags the pushed commits reach, --tags sends them all.
func TestPushTagModes(t *testing.T) {
	repo, dir := newTestRepo(t)
	bare := t.TempDir()
	runGit(t, bare, "init", "-q", "--bare", "-b", "main")
	runGit(t, dir, "remote", "add", "origin", bare)
	runGit(t, dir, "tag", "-a", "annotated", "-m", "release")
	runGit(t, dir, "tag", "light")

	ctx := context.Background()
	if _, err := repo.Push(ctx, PushOptions{Remote: "origin", Branch: "main", TagsMode: "follow"}, func(string) {}); err != nil {
		t.Fatalf("Push follow: %v", err)
	}
	if err := runGitNoOut(bare, "rev-parse", "refs/tags/annotated"); err != nil {
		t.Fatal("--follow-tags did not send the annotated tag")
	}
	if err := runGitNoOut(bare, "rev-parse", "refs/tags/light"); err == nil {
		t.Fatal("--follow-tags sent a lightweight tag")
	}
	if _, err := repo.Push(ctx, PushOptions{Remote: "origin", Branch: "main", TagsMode: "all"}, func(string) {}); err != nil {
		t.Fatalf("Push all: %v", err)
	}
	if err := runGitNoOut(bare, "rev-parse", "refs/tags/light"); err != nil {
		t.Fatal("--tags did not send the lightweight tag")
	}
}
