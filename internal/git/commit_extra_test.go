package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUndoCommitKeepsTheChangesStaged(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "add b")
	first := runGit(t, dir, "rev-parse", "HEAD")
	before := runGit(t, dir, "rev-parse", "HEAD~1")
	res, err := repo.UndoCommit(context.Background())
	if err != nil {
		t.Fatalf("UndoCommit: %v", err)
	}
	if !strings.Contains(res.Subject, "add b") {
		t.Fatalf("subject = %q", res.Subject)
	}
	if tip := runGit(t, dir, "rev-parse", "HEAD"); tip != before {
		t.Fatalf("HEAD = %s, want %s", tip, before)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); staged != "b.txt" {
		t.Fatalf("staged = %q, want b.txt", staged)
	}
	if first == before {
		t.Fatal("fixture did not create two different commits")
	}
}

func TestUndoCommitDropsTheRootCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	if _, err := repo.UndoCommit(context.Background()); err != nil {
		t.Fatalf("UndoCommit: %v", err)
	}
	if out := runGitFail(t, dir, "rev-parse", "--verify", "HEAD"); !strings.Contains(out, "fatal") {
		t.Fatalf("HEAD still resolves: %s", out)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); staged != "a.txt" {
		t.Fatalf("staged = %q, want the root commit's file", staged)
	}
}

func TestCommitFixupCreatesAFixupCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	head := runGit(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "a.txt", "one\nchanged\n")
	runGit(t, dir, "add", "a.txt")
	res, err := repo.CommitFixup(context.Background(), head, false)
	if err != nil {
		t.Fatalf("CommitFixup: %v", err)
	}
	if !strings.HasPrefix(res.Subject, "fixup! ") {
		t.Fatalf("subject = %q, want a fixup commit", res.Subject)
	}
	res, err = repo.CommitFixup(context.Background(), head, true)
	if err == nil {
		t.Fatal("the second fixup had nothing staged and should fail")
	}
	writeFile(t, dir, "a.txt", "one\nchanged again\n")
	runGit(t, dir, "add", "a.txt")
	res, err = repo.CommitFixup(context.Background(), head, true)
	if err != nil {
		t.Fatalf("CommitFixup squash: %v", err)
	}
	if !strings.HasPrefix(res.Subject, "squash! ") {
		t.Fatalf("subject = %q, want a squash commit", res.Subject)
	}
}

func TestCheckCommitFindsCRLFLargeAndReservedNames(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "crlf.txt", "a\r\nb\r\n")
	writeFile(t, dir, "big.bin", strings.Repeat("x", 2*1024*1024))
	writeFile(t, dir, "CON.txt", "x\n")
	warnings, err := repo.CheckCommit(context.Background(), []string{"crlf.txt", "big.bin", "CON.txt"}, CommitCheckOptions{
		CRLF: true, LargeFileMB: 1, BadNames: true,
	})
	if err != nil {
		t.Fatalf("CheckCommit: %v", err)
	}
	kinds := map[string]bool{}
	for _, w := range warnings {
		kinds[w.Kind] = true
	}
	for _, want := range []string{"crlf", "large", "name"} {
		if !kinds[want] {
			t.Fatalf("missing %q warning: %+v", want, warnings)
		}
	}
}

func TestCheckCommitReportsADetachedHead(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "checkout", "-q", "--detach")
	warnings, err := repo.CheckCommit(context.Background(), nil, CommitCheckOptions{Detached: true})
	if err != nil {
		t.Fatalf("CheckCommit: %v", err)
	}
	if len(warnings) != 1 || warnings[0].Kind != "detached" {
		t.Fatalf("warnings = %+v, want one detached warning", warnings)
	}
}

func TestCheckCommitRespectsTheLargeFileLimit(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "big.bin", strings.Repeat("x", 2*1024*1024))
	warnings, err := repo.CheckCommit(context.Background(), []string{"big.bin"}, CommitCheckOptions{LargeFileMB: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 0 {
		t.Fatalf("warnings = %+v, want none under the limit", warnings)
	}
	if _, err := os.Stat(filepath.Join(dir, "big.bin")); err != nil {
		t.Fatal(err)
	}
}
