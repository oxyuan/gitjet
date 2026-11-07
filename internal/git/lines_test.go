package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyDiffLinesStagesOnlyTheSelectedLine(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\nfour\nfive\n")
	runGit(t, dir, "commit", "-q", "-am", "five lines")
	writeFile(t, dir, "a.txt", "one\nTWO\nthree\nfour\nFIVE\n")
	opts := DiffOptions{Path: "a.txt", Target: DiffWorkingTree}
	if err := repo.ApplyDiffLines(context.Background(), opts, []int{5}, "stage"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--unified=0")
	if !strings.Contains(staged, "+FIVE") || strings.Contains(staged, "+TWO") {
		t.Fatalf("index has the wrong lines:\n%s", staged)
	}
	unstaged := runGit(t, dir, "diff", "--unified=0")
	if !strings.Contains(unstaged, "+TWO") || strings.Contains(unstaged, "+FIVE") {
		t.Fatalf("working tree diff has the wrong lines:\n%s", unstaged)
	}
}

func TestApplyDiffLinesUnstagesOnlyTheSelectedLine(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\nfour\nfive\n")
	runGit(t, dir, "commit", "-q", "-am", "five lines")
	writeFile(t, dir, "a.txt", "one\nTWO\nthree\nfour\nFIVE\n")
	runGit(t, dir, "add", "a.txt")
	opts := DiffOptions{Path: "a.txt", Target: DiffStaged}
	if err := repo.ApplyDiffLines(context.Background(), opts, []int{5}, "unstage"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--unified=0")
	if strings.Contains(staged, "+FIVE") || !strings.Contains(staged, "+TWO") {
		t.Fatalf("index kept the wrong line:\n%s", staged)
	}
}

func TestApplyDiffLinesRollsBackOnlyTheSelectedLine(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\nfour\nfive\n")
	runGit(t, dir, "commit", "-q", "-am", "five lines")
	writeFile(t, dir, "a.txt", "one\nTWO\nthree\nfour\nFIVE\n")
	opts := DiffOptions{Path: "a.txt", Target: DiffWorkingTree}
	if err := repo.ApplyDiffLines(context.Background(), opts, []int{2}, "rollback"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	text, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(text) != "one\ntwo\nthree\nfour\nFIVE\n" {
		t.Fatalf("a.txt = %q, want only line 2 rolled back", text)
	}
}

func TestApplyDiffLinesStagesAPartOfAnUntrackedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "first\nsecond\n")
	opts := DiffOptions{Path: "new.txt", Target: DiffWorkingTree}
	if err := repo.ApplyDiffLines(context.Background(), opts, []int{1}, "stage"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--unified=0")
	if !strings.Contains(staged, "+first") || strings.Contains(staged, "+second") {
		t.Fatalf("index has the wrong lines:\n%s", staged)
	}
}

func TestApplyDiffLinesRejectsAnEmptySelection(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nTWO\n")
	if err := repo.ApplyDiffLines(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree}, nil, "stage"); err == nil {
		t.Fatal("ApplyDiffLines accepted an empty selection")
	}
}
