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

	result, err := repo.Blame(t.Context(), "f.txt", "")
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

	result, err := repo.Blame(t.Context(), "f.txt", "")
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

func TestBlameAtRevisionUsesThatRevision(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "f.txt", "first\nsecond\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-qm", "add f")
	first := runGit(t, dir, "rev-parse", "HEAD")

	writeFile(t, dir, "f.txt", "first\nsecond changed\nthird\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-qm", "edit f")

	result, err := repo.Blame(t.Context(), "f.txt", first)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 2 {
		t.Fatalf("lines = %d, want the two lines of %s", len(result.Lines), first[:8])
	}
	for i, line := range result.Lines {
		if line.Commit != first {
			t.Fatalf("line %d belongs to %s, want %s", i+1, line.Commit, first)
		}
	}
	if result.Lines[1].Text != "second" {
		t.Fatalf("line 2 text = %q", result.Lines[1].Text)
	}
}

func TestBlameIndexReadsTheStagedCopy(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "f.txt", "one\n")
	runGit(t, dir, "add", "f.txt")
	runGit(t, dir, "commit", "-qm", "one")
	writeFile(t, dir, "f.txt", "one\nstaged\n")
	runGit(t, dir, "add", "f.txt")
	// The working tree differs from the index, so a worktree blame would
	// read the wrong text.
	writeFile(t, dir, "f.txt", "one\nworktree only\n")

	result, err := repo.Blame(t.Context(), "f.txt", "INDEX")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(result.Lines))
	}
	if result.Lines[1].Text != "staged" {
		t.Fatalf("line 2 text = %q, want the staged line", result.Lines[1].Text)
	}
	if !result.Lines[1].Uncommitted {
		t.Fatalf("the staged line should be uncommitted: %+v", result.Lines[1])
	}
}
