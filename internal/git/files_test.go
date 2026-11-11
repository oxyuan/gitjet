package git

import (
	"context"
	"os"
	"path/filepath"
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

func TestUsagePreviewReadsAWindow(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\n  two\nthree\nfour\nfive\nsix\nseven\n")
	got := repo.UsagePreview("a.txt", 4, 2)
	if got.Start != 2 || len(got.Lines) != 5 {
		t.Fatalf("preview = %+v", got)
	}
	if got.Lines[0].Line != 2 || got.Lines[0].Text != "  two" {
		t.Errorf("first = %+v", got.Lines[0])
	}
	if got.Lines[4].Line != 6 || got.Lines[4].Text != "six" {
		t.Errorf("last = %+v", got.Lines[4])
	}
	// A line past the end clamps to the last line instead of returning none.
	clamped := repo.UsagePreview("a.txt", 99, 1)
	if clamped.Line != 7 || len(clamped.Lines) == 0 || clamped.Lines[len(clamped.Lines)-1].Line != 7 {
		t.Errorf("clamped = %+v", clamped)
	}
}

func TestUsagePreviewReadsAnExternalFile(t *testing.T) {
	repo, _ := newTestRepo(t)
	outside := filepath.Join(t.TempDir(), "lib.go")
	if err := os.WriteFile(outside, []byte("package lib\r\n\r\nfunc Run() {}\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := repo.UsagePreview(outside, 3, 1)
	if len(got.Lines) != 2 || got.Start != 2 {
		t.Fatalf("preview = %+v", got)
	}
	if got.Lines[1].Line != 3 || got.Lines[1].Text != "func Run() {}" {
		t.Errorf("line = %+v", got.Lines[1])
	}
	if empty := repo.UsagePreview(filepath.Join(t.TempDir(), "missing.go"), 1, 1); len(empty.Lines) != 0 {
		t.Errorf("missing = %+v", empty)
	}
	if escaped := repo.UsagePreview("../outside.txt", 1, 1); len(escaped.Lines) != 0 {
		t.Errorf("escaped = %+v", escaped)
	}
}

func TestExternalFileReadsOutsideTheRepository(t *testing.T) {
	repo, _ := newTestRepo(t)
	outside := filepath.Join(t.TempDir(), "lib.go")
	if err := os.WriteFile(outside, []byte("package lib\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	file, err := repo.ExternalFile(outside)
	if err != nil {
		t.Fatalf("ExternalFile: %v", err)
	}
	if !file.External || file.Revision != "EXTERNAL" || !file.Exists || file.Text != "package lib\n" {
		t.Fatalf("file = %+v", file)
	}
	if file.Language != "go" {
		t.Errorf("language = %q", file.Language)
	}
	missing, err := repo.ExternalFile(filepath.Join(t.TempDir(), "missing.go"))
	if err != nil {
		t.Fatalf("ExternalFile missing: %v", err)
	}
	if missing.Exists || !missing.External {
		t.Errorf("missing = %+v", missing)
	}
	if _, err := repo.ExternalFile("relative.go"); err == nil {
		t.Fatal("ExternalFile accepted a relative path")
	}
}
