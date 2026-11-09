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

func TestApplyDiffLinesWorksInWholeFileMode(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\nfour\nfive\n")
	runGit(t, dir, "commit", "-q", "-am", "five lines")
	writeFile(t, dir, "a.txt", "one\nTWO\nthree\nfour\nFIVE\n")
	opts := DiffOptions{Path: "a.txt", Target: DiffWorkingTree, Context: -1}
	if err := repo.ApplyDiffLines(context.Background(), opts, []int{2}, "stage"); err != nil {
		t.Fatalf("ApplyDiffLines with the default whole-file context: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--unified=0")
	if !strings.Contains(staged, "+TWO") || strings.Contains(staged, "+FIVE") {
		t.Fatalf("index has the wrong lines:\n%s", staged)
	}
}

func TestApplyDiffLinesKeepsSidesApart(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "l1\nl2\nl3\nl4\nl5\n")
	runGit(t, dir, "add", "a.txt")
	runGit(t, dir, "commit", "-qm", "five")
	var b strings.Builder
	b.WriteString("n1\nn2\nn3\nn4\nn5\n")
	b.WriteString("l1\nl2\nl3\nl4\n")
	writeFile(t, dir, "a.txt", b.String())

	// New line 5 is n5. Old line 5 (l5) is deleted in the same diff and
	// must not be picked up by the same number.
	if err := repo.ApplyDiffLines(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree}, []int{5}, "stage"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--unified=0")
	if !strings.Contains(staged, "+n5") {
		t.Fatalf("the selected addition was not staged:\n%s", staged)
	}
	if strings.Contains(staged, "-l5") {
		t.Fatalf("an unrelated deleted line was staged with it:\n%s", staged)
	}
	if unstaged := runGit(t, dir, "diff", "--unified=0"); !strings.Contains(unstaged, "-l5") {
		t.Fatalf("the deletion left the working tree diff:\n%s", unstaged)
	}
}

func TestApplyDiffLinesStagesScatteredDeletions(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "l1\nl2\nl3\nl4\nl5\n")
	runGit(t, dir, "add", "a.txt")
	runGit(t, dir, "commit", "-qm", "five")
	writeFile(t, dir, "a.txt", "l1\nl3\nl5\n")

	if err := repo.ApplyDiffLines(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree}, []int{-2, -4}, "stage"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--unified=0")
	if !strings.Contains(staged, "-l2") || !strings.Contains(staged, "-l4") {
		t.Fatalf("the selected deletions were not staged:\n%s", staged)
	}
	if strings.Contains(staged, "-l3") {
		t.Fatalf("an unselected deletion was staged:\n%s", staged)
	}
}

func TestApplyDiffLinesUnstagesAllOfANewFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "first\nsecond\n")
	runGit(t, dir, "add", "new.txt")
	if err := repo.ApplyDiffLines(context.Background(), DiffOptions{Path: "new.txt", Target: DiffStaged}, []int{1, 2}, "unstage"); err != nil {
		t.Fatalf("ApplyDiffLines: %v", err)
	}
	if tracked := runGit(t, dir, "ls-files", "--", "new.txt"); tracked != "" {
		t.Fatalf("new.txt is still tracked: %q", tracked)
	}
	if status := runGit(t, dir, "status", "--porcelain", "--", "new.txt"); status != "?? new.txt" {
		t.Fatalf("status = %q, want the file back as untracked", status)
	}
}
