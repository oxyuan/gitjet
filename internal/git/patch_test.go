package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPatchRoundTripsTheWorkingTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\npatched\n")
	patch, err := repo.CreatePatch(context.Background(), PatchOptions{})
	if err != nil {
		t.Fatalf("CreatePatch: %v", err)
	}
	if !strings.Contains(patch, "+patched") {
		t.Fatalf("patch does not contain the change:\n%s", patch)
	}
	if err := repo.Rollback(context.Background(), []string{"a.txt"}, true); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ApplyPatch(context.Background(), patch, false, false); err != nil {
		t.Fatalf("ApplyPatch: %v", err)
	}
	text, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(text) != "one\npatched\n" {
		t.Fatalf("a.txt = %q", text)
	}
}

func TestCreatePatchOfACommitUsesItsParent(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "add b")
	head := runGit(t, dir, "rev-parse", "HEAD")
	patch, err := repo.CreatePatch(context.Background(), PatchOptions{Revision: head})
	if err != nil {
		t.Fatalf("CreatePatch: %v", err)
	}
	if !strings.Contains(patch, "+++ b/b.txt") || strings.Contains(patch, "a.txt") {
		t.Fatalf("commit patch has the wrong files:\n%s", patch)
	}
}

func TestShelfSavesRestoresAndDrops(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nshelved\n")
	shelf, err := repo.SaveShelf(context.Background(), "work in progress", PatchOptions{Paths: []string{"a.txt"}})
	if err != nil {
		t.Fatalf("SaveShelf: %v", err)
	}
	if shelf.Name != "work in progress" || shelf.Files != 1 {
		t.Fatalf("shelf = %+v", shelf)
	}
	if text, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(text) != "one\ntwo\n" {
		t.Fatalf("a.txt = %q after shelving, want the committed content", text)
	}
	shelves, err := repo.Shelves(context.Background())
	if err != nil {
		t.Fatalf("Shelves: %v", err)
	}
	if len(shelves) != 1 {
		t.Fatalf("shelves = %+v, want one", shelves)
	}
	if _, err := repo.ApplyShelf(context.Background(), shelf.Name, false); err != nil {
		t.Fatalf("ApplyShelf: %v", err)
	}
	if text, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(text) != "one\nshelved\n" {
		t.Fatalf("a.txt = %q after applying the shelf", text)
	}
	if _, err := repo.DropShelf(context.Background(), shelf.Name); err != nil {
		t.Fatalf("DropShelf: %v", err)
	}
	shelves, _ = repo.Shelves(context.Background())
	if len(shelves) != 0 {
		t.Fatalf("shelves = %+v after dropping", shelves)
	}
}

func TestSaveShelfRefusesADuplicateName(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nshelved\n")
	if _, err := repo.SaveShelf(context.Background(), "x", PatchOptions{Paths: []string{"a.txt"}}); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "a.txt", "one\nagain\n")
	if _, err := repo.SaveShelf(context.Background(), "x", PatchOptions{Paths: []string{"a.txt"}}); err == nil {
		t.Fatal("SaveShelf accepted a duplicate name")
	}
}

func TestStashApplyRestoresTheIndexWhenAsked(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "b.txt", "untracked by the index\n")
	runGit(t, dir, "stash", "push", "-u", "-q", "-m", "mixed")
	if _, err := repo.StashApply(context.Background(), 0, true, true); err != nil {
		t.Fatalf("StashApply: %v", err)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); !strings.Contains(staged, "a.txt") {
		t.Fatalf("the index was not restored:\n%s", staged)
	}
}

func TestClearStashesDropsEveryEntry(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nfirst\n")
	runGit(t, dir, "stash", "push", "-q")
	writeFile(t, dir, "a.txt", "one\nsecond\n")
	runGit(t, dir, "stash", "push", "-q")
	if _, err := repo.ClearStashes(context.Background()); err != nil {
		t.Fatalf("ClearStashes: %v", err)
	}
	stashes, err := repo.Stashes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(stashes) != 0 {
		t.Fatalf("stashes = %+v after clear", stashes)
	}
}

func TestSaveShelfKeepsStagedWorkAndStagedNewFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "a.txt", "one\nstaged\nunstaged\n")
	writeFile(t, dir, "fresh.txt", "brand new\n")
	runGit(t, dir, "add", "fresh.txt")

	if _, err := repo.SaveShelf(context.Background(), "all", PatchOptions{}); err != nil {
		t.Fatalf("SaveShelf: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "fresh.txt")); !os.IsNotExist(err) {
		t.Fatalf("the staged new file survived the shelve: %v", err)
	}
	text, _ := os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(text) != "one\ntwo\n" {
		t.Fatalf("the working tree was not cleaned: %q", text)
	}
	if _, err := repo.ApplyShelf(context.Background(), "all", false); err != nil {
		t.Fatalf("ApplyShelf: %v", err)
	}
	// Shelving and restoring is a round trip: the staged line comes back
	// with the unstaged one, and so does the new file.
	text, _ = os.ReadFile(filepath.Join(dir, "a.txt"))
	if string(text) != "one\nstaged\nunstaged\n" {
		t.Fatalf("a.txt after restore = %q", text)
	}
	if text, _ := os.ReadFile(filepath.Join(dir, "fresh.txt")); string(text) != "brand new\n" {
		t.Fatalf("fresh.txt after restore = %q", text)
	}
}
