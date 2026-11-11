package git

import (
	"context"
	"testing"
)

func TestTreeAtRevisionListsTheFilesOfACommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "dir/b.txt", "b\n")
	runGit(t, dir, "add", "dir/b.txt")
	runGit(t, dir, "commit", "-q", "-m", "add b")
	head := runGit(t, dir, "rev-parse", "HEAD")
	files, err := repo.TreeAtRevision(context.Background(), head)
	if err != nil {
		t.Fatalf("TreeAtRevision: %v", err)
	}
	got := []string{}
	for _, file := range files {
		got = append(got, file.Path)
	}
	if len(got) != 2 || got[0] != "a.txt" || got[1] != "dir/b.txt" {
		t.Fatalf("files = %v", got)
	}
	if _, err := repo.TreeAtRevision(context.Background(), "nope"); err == nil {
		t.Fatal("TreeAtRevision accepted an unknown revision")
	}
}

func TestLineTextsReadsWorkingTreeLines(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "first\r\n  second  \nthird\n")
	writeFile(t, dir, "bin.dat", "a\x00b")
	got := repo.LineTexts([]LineRef{
		{Path: "a.txt", Line: 1},
		{Path: "./a.txt", Line: 2},
		{Path: "a.txt", Line: 3},
		{Path: "a.txt", Line: 99},
		{Path: "../outside.txt", Line: 1},
		{Path: "/etc/passwd", Line: 1},
		{Path: "bin.dat", Line: 1},
		{Path: "missing.txt", Line: 1},
	})
	if len(got) != 3 {
		t.Fatalf("lines = %+v", got)
	}
	if got[0].Path != "a.txt" || got[0].Line != 1 || got[0].Text != "first" {
		t.Errorf("line 1 = %+v", got[0])
	}
	if got[1].Text != "second" {
		t.Errorf("line 2 = %+v", got[1])
	}
	if got[2].Text != "third" {
		t.Errorf("line 3 = %+v", got[2])
	}
}

func TestLineTextsReadsEachFileOnce(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\n")
	got := repo.LineTexts([]LineRef{
		{Path: "a.txt", Line: 1},
		{Path: "a.txt", Line: 2},
		{Path: "a.txt", Line: 1},
	})
	if len(got) != 3 || got[0].Text != "one" || got[1].Text != "two" || got[2].Text != "one" {
		t.Fatalf("lines = %+v", got)
	}
}
