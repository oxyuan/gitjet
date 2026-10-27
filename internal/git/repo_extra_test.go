package git

import (
	"context"
	"path/filepath"
	"testing"
)

func TestWorktreesListsTheMainTreeAndNewOnes(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "feature-tree")

	if _, err := repo.AddWorktree(ctx, path, "feature", true); err != nil {
		t.Fatalf("AddWorktree: %v", err)
	}
	trees, err := repo.Worktrees(ctx)
	if err != nil {
		t.Fatalf("Worktrees: %v", err)
	}
	if len(trees) != 2 {
		t.Fatalf("worktrees = %d, want 2", len(trees))
	}
	if !trees[0].Main || !samePath(trees[0].Path, dir) {
		t.Errorf("first worktree = %+v", trees[0])
	}
	if trees[1].Branch != "feature" || !samePath(trees[1].Path, path) {
		t.Errorf("second worktree = %+v", trees[1])
	}

	if _, err := repo.RemoveWorktree(ctx, path, false); err != nil {
		t.Fatalf("RemoveWorktree: %v", err)
	}
	if trees, _ := repo.Worktrees(ctx); len(trees) != 1 {
		t.Errorf("worktrees after remove = %d", len(trees))
	}
}

func TestCleanupCandidatesFindsMergedBranches(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	runGit(t, dir, "checkout", "-q", "-b", "merged-work")
	commitFile(t, dir, "b.txt", "b\n", "work")
	runGit(t, dir, "checkout", "-q", "main")
	runGit(t, dir, "merge", "-q", "--no-ff", "-m", "merge work", "merged-work")

	cleanup, err := repo.CleanupCandidates(ctx)
	if err != nil {
		t.Fatalf("CleanupCandidates: %v", err)
	}
	found := false
	for _, b := range cleanup.Merged {
		if b.Name == "main" {
			t.Error("the current branch was offered for cleanup")
		}
		if b.Name == "merged-work" {
			found = true
		}
	}
	if !found {
		t.Errorf("merged branch missing from %+v", cleanup.Merged)
	}
}

func TestStashFilesListsLineCounts(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	writeFile(t, dir, "a.txt", "one\nchanged\nextra\n")
	writeFile(t, dir, "b.txt", "new\n")
	if _, err := repo.StashPush(ctx, StashOptions{IncludeUntracked: true, Message: "wip"}); err != nil {
		t.Fatalf("StashPush: %v", err)
	}
	files, err := repo.StashFiles(ctx, 0)
	if err != nil {
		t.Fatalf("StashFiles: %v", err)
	}
	if len(files) != 2 {
		t.Fatalf("files = %+v", files)
	}
	for _, f := range files {
		switch f.Path {
		case "a.txt":
			if f.Additions != 2 || f.Deletions != 1 {
				t.Errorf("a.txt counts = +%d -%d", f.Additions, f.Deletions)
			}
		case "b.txt":
			if f.Additions != 1 {
				t.Errorf("b.txt counts = +%d -%d", f.Additions, f.Deletions)
			}
		}
	}
}

func TestStashToBranchRestoresOnItsOwnBranch(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	writeFile(t, dir, "a.txt", "one\nstashed\n")
	if _, err := repo.StashPush(ctx, StashOptions{Message: "wip"}); err != nil {
		t.Fatalf("StashPush: %v", err)
	}
	if _, err := repo.StashToBranch(ctx, 0, "rescue"); err != nil {
		t.Fatalf("StashToBranch: %v", err)
	}
	if branch := runGit(t, dir, "rev-parse", "--abbrev-ref", "HEAD"); branch != "rescue" {
		t.Errorf("branch = %q", branch)
	}
	if st, err := repo.Status(ctx, false); err != nil || len(st.Changes) != 1 {
		t.Errorf("restored changes = %+v, err = %v", st.Changes, err)
	}
	if stashes, _ := repo.Stashes(ctx); len(stashes) != 0 {
		t.Errorf("stash entries left: %+v", stashes)
	}
}

func TestPushPreviewDetectsDivergedRemote(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	origin := t.TempDir()
	runGit(t, origin, "init", "-q", "--bare", "-b", "main")
	runGit(t, dir, "remote", "add", "origin", origin)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")

	other := t.TempDir()
	runGit(t, other, "clone", "-q", origin, ".")
	writeFile(t, other, "remote.txt", "remote\n")
	runGit(t, other, "add", "-A")
	runGit(t, other, "commit", "-q", "-m", "remote work")
	runGit(t, other, "push", "-q", "origin", "main")

	commitFile(t, dir, "local.txt", "local\n", "local work")
	runGit(t, dir, "fetch", "-q", "origin")

	preview, err := repo.PushPreview(ctx, "origin", "main", "")
	if err != nil {
		t.Fatalf("PushPreview: %v", err)
	}
	if !preview.Diverged || preview.Behind != 1 {
		t.Errorf("preview = diverged %v, behind %d", preview.Diverged, preview.Behind)
	}
	if preview.RemoteTip == "" {
		t.Error("the remote tip hash is missing")
	}
}

func TestUnshallowFetchesFullHistory(t *testing.T) {
	_, dir := newTestRepo(t)
	commitFile(t, dir, "b.txt", "b\n", "second")
	commitFile(t, dir, "c.txt", "c\n", "third")
	src := dir
	clone := t.TempDir()
	runGit(t, clone, "clone", "-q", "--depth", "1", "file://"+src, ".")

	repo, err := Open(context.Background(), clone, "")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	ctx := context.Background()
	if !repo.IsShallow(ctx) {
		t.Skip("this git ignores --depth for local clones")
	}
	if _, err := repo.Unshallow(ctx, nil); err != nil {
		t.Fatalf("Unshallow: %v", err)
	}
	if repo.IsShallow(ctx) {
		t.Error("the repository is still shallow")
	}
	if n := runGit(t, clone, "rev-list", "--count", "HEAD"); n != "3" {
		t.Errorf("commits = %s, want 3", n)
	}
}

func TestTreeListsEveryFileIncludingUntracked(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	writeFile(t, dir, "a.txt", "one\n")
	writeFile(t, dir, "src/main.go", "package main\n")
	writeFile(t, dir, "notes/pending.md", "todo\n")
	if out, err := repo.run(ctx, "add", "a.txt", "src/main.go"); err != nil {
		t.Fatalf("add: %v (%s)", err, out)
	}
	writeFile(t, dir, ".gitignore", "ignored/\n")
	writeFile(t, dir, "ignored/hidden.txt", "no\n")
	runGit(t, dir, "add", ".gitignore")

	files, err := repo.Tree(ctx)
	if err != nil {
		t.Fatalf("Tree: %v", err)
	}
	got := map[string]bool{}
	for _, f := range files {
		got[f.Path] = f.Tracked
	}
	if !got["a.txt"] || !got["src/main.go"] || !got[".gitignore"] {
		t.Errorf("tracked files missing from %+v", files)
	}
	if tracked, ok := got["notes/pending.md"]; !ok || tracked {
		t.Errorf("untracked file = %+v", files)
	}
	if _, ok := got["ignored/hidden.txt"]; ok {
		t.Errorf("ignored file listed: %+v", files)
	}
	for i := 1; i < len(files); i++ {
		if files[i-1].Path > files[i].Path {
			t.Fatalf("not sorted: %q before %q", files[i-1].Path, files[i].Path)
		}
	}
}
