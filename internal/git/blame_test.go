package git

import "testing"

func TestBlameAnnotatesEachLineWithItsCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "f.txt", "first\nsecond\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-qm", "add f")
	first := runGit(t, dir, "rev-parse", "HEAD")

	writeFile(t, dir, "f.txt", "first\nsecond changed\nthird\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-qm", "edit f")
	second := runGit(t, dir, "rev-parse", "HEAD")

	result, err := repo.Blame(t.Context(), "f.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 3 {
		t.Fatalf("lines = %d, want 3", len(result.Lines))
	}
	if result.Lines[0].Commit != first {
		t.Fatalf("line 1 belongs to %s, want %s", result.Lines[0].Commit, first)
	}
	if result.Lines[1].Commit != second || result.Lines[2].Commit != second {
		t.Fatalf("lines 2-3 belong to %s and %s, want %s", result.Lines[1].Commit, result.Lines[2].Commit, second)
	}
	if result.Lines[1].Summary != "edit f" {
		t.Fatalf("summary = %q", result.Lines[1].Summary)
	}
	if result.Lines[0].Text != "first" {
		t.Fatalf("text = %q", result.Lines[0].Text)
	}
	if result.MaxTime == 0 {
		t.Fatal("MaxTime should colour the gutter")
	}
}

func TestBlameReportsUncommittedLines(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "f.txt", "committed\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-qm", "add f")
	writeFile(t, dir, "f.txt", "committed\nlocal\n")

	result, err := repo.Blame(t.Context(), "f.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(result.Lines))
	}
	if !result.Lines[1].Uncommitted {
		t.Fatalf("line 2 should be uncommitted: %+v", result.Lines[1])
	}
}
