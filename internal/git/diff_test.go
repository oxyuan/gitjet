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
