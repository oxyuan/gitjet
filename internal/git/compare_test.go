package git

import (
	"context"
	"testing"
)

func TestCompareRefsListsTheChangesBetweenTwoCommits(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "old.txt", "one\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-q", "-m", "base")
	base := runGit(t, dir, "rev-parse", "HEAD")

	runGit(t, dir, "mv", "old.txt", "new.txt")
	writeFile(t, dir, "added.txt", "new\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-q", "-m", "second")

	changes, err := repo.CompareRefs(context.Background(), base, "HEAD")
	if err != nil {
		t.Fatalf("CompareRefs: %v", err)
	}
	if len(changes) != 2 {
		t.Fatalf("changes = %+v, want a rename and an add", changes)
	}
	byPath := make(map[string]Change, len(changes))
	for _, change := range changes {
		byPath[change.Path] = change
	}
	renamed, ok := byPath["new.txt"]
	if !ok {
		t.Fatalf("rename missing: %+v", changes)
	}
	if renamed.Kind != "renamed" || renamed.OldPath != "old.txt" {
		t.Errorf("rename = %+v, want renamed from old.txt", renamed)
	}
	if added, ok := byPath["added.txt"]; !ok || added.Kind != "added" {
		t.Errorf("added = %+v (ok=%v), want an added file", added, ok)
	}
}

func TestCompareRefsRefusesAnEmptyRevision(t *testing.T) {
	repo, _ := newTestRepo(t)
	if _, err := repo.CompareRefs(context.Background(), "", "HEAD"); err == nil {
		t.Fatal("an empty revision should be refused")
	}
}

func TestCompareWorktreeSeesStagedAndUnstagedChanges(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "tracked.txt", "one\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-q", "-m", "base")
	base := runGit(t, dir, "rev-parse", "HEAD")

	writeFile(t, dir, "tracked.txt", "one\ntwo\n")
	writeFile(t, dir, "staged.txt", "new\n")
	runGit(t, dir, "add", "staged.txt")
	writeFile(t, dir, "untracked.txt", "not in a diff\n")

	changes, err := repo.CompareWorktree(context.Background(), base)
	if err != nil {
		t.Fatalf("CompareWorktree: %v", err)
	}
	byPath := make(map[string]Change, len(changes))
	for _, change := range changes {
		byPath[change.Path] = change
	}
	if got := byPath["tracked.txt"].Kind; got != "modified" {
		t.Errorf("tracked.txt = %q, want modified", got)
	}
	if got := byPath["staged.txt"].Kind; got != "added" {
		t.Errorf("staged.txt = %q, want added", got)
	}
	if _, ok := byPath["untracked.txt"]; ok {
		t.Error("an untracked file is not part of a diff")
	}
}
