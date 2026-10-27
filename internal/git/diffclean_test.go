package git

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestFileDiffOfACleanFileHasNoHunks(t *testing.T) {
	repo, dir := newTestRepo(t)
	_ = dir
	d, err := repo.FileDiff(t.Context(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree, Context: 3, NoText: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Hunks) != 0 {
		t.Fatalf("hunks = %d, want 0: %+v", len(d.Hunks), d.Hunks)
	}
}

func TestFileDiffOfAnUntrackedFileIsSynthetic(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "fresh.txt", "brand new\n")

	d, err := repo.FileDiff(t.Context(), DiffOptions{Path: "fresh.txt", Target: DiffWorkingTree, Context: 3, NoText: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Hunks) != 1 || d.Status != "added" {
		t.Fatalf("hunks = %d, status = %q", len(d.Hunks), d.Status)
	}
	if d.Hunks[0].Lines[0].Text != "brand new" {
		t.Fatalf("first line = %q", d.Hunks[0].Lines[0].Text)
	}
}

func TestFileDiffWholeFileKeepsEveryUnchangedLine(t *testing.T) {
	repo, dir := newTestRepo(t)
	var b strings.Builder
	for i := 1; i <= 40; i++ {
		fmt.Fprintf(&b, "line %d\n", i)
	}
	writeFile(t, dir, "long.txt", b.String())
	runGit(t, dir, "add", "long.txt")
	runGit(t, dir, "commit", "-q", "-m", "long")
	writeFile(t, dir, "long.txt", strings.Replace(b.String(), "line 20", "line twenty", 1))

	whole, err := repo.FileDiff(context.Background(), DiffOptions{Path: "long.txt", Target: DiffWorkingTree, Context: -1})
	if err != nil {
		t.Fatal(err)
	}
	if len(whole.Hunks) != 1 {
		t.Fatalf("whole-file diff has %d hunks, want 1", len(whole.Hunks))
	}
	kept := 0
	for _, line := range whole.Hunks[0].Lines {
		if line.Kind == "context" {
			kept++
		}
	}
	if !whole.WholeFile {
		t.Fatal("a diff asked for the whole file should say so")
	}
	if kept != 39 {
		t.Fatalf("context lines = %d, want the 39 unchanged lines", kept)
	}

	narrow, err := repo.FileDiff(context.Background(), DiffOptions{Path: "long.txt", Target: DiffWorkingTree, Context: 0})
	if err != nil {
		t.Fatal(err)
	}
	if narrow.WholeFile {
		t.Fatal("a windowed diff should not claim the whole file")
	}
	narrowContext := 0
	for _, line := range narrow.Hunks[0].Lines {
		if line.Kind == "context" {
			narrowContext++
		}
	}
	if narrowContext != 6 {
		t.Fatalf("default diff kept %d context lines, want 6 (3 either side)", narrowContext)
	}
}
