package git

import (
	"context"
	"testing"
)

func TestFileDiffLocalTextComesFromTheIndex(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "a.txt", "one\nworktree\n")

	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.OldText != "one\nstaged\n" {
		t.Fatalf("old text = %q, want the staged version", d.OldText)
	}
	if d.NewText != "one\nworktree\n" {
		t.Fatalf("new text = %q, want the working tree", d.NewText)
	}
}

func TestFileDiffCarriesTextForAnUntrackedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "first\nsecond\n")

	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "new.txt", Target: DiffWorkingTree})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.OldText != "" || d.NewText != "first\nsecond\n" {
		t.Fatalf("text = %q / %q, want an empty old side and the file", d.OldText, d.NewText)
	}
}

func TestFileDiffWhitespacePolicies(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\n\nvalue = 1\n")
	runGit(t, dir, "add", "a.txt")
	runGit(t, dir, "commit", "-q", "-m", "base")
	// An added blank line and a changed amount of spaces on one line.
	writeFile(t, dir, "a.txt", "one\n\n\nvalue  =  1\n")

	hunks := func(policy WhitespacePolicy) int {
		d, err := repo.FileDiff(context.Background(), DiffOptions{
			Path:       "a.txt",
			Target:     DiffWorkingTree,
			Whitespace: policy,
			NoText:     true,
		})
		if err != nil {
			t.Fatalf("FileDiff(%q): %v", policy, err)
		}
		return len(d.Hunks)
	}

	if n := hunks(WhitespaceNone); n == 0 {
		t.Fatal("no policy found no change")
	}
	if n := hunks(WhitespaceTrim); n == 0 {
		t.Fatal("trimming whitespace hid the blank line too")
	}
	if n := hunks(WhitespaceAll); n == 0 {
		t.Fatal("ignoring whitespace hid the blank line too")
	}
	if n := hunks(WhitespaceBlankLines); n != 0 {
		t.Fatalf("ignoring whitespace and blank lines left %d hunks, want 0", n)
	}
}
