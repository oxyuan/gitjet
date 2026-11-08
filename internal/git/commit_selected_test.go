package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommitSelectedKeepsOtherStagedChanges(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "add b")
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "b.txt", "b\nselected\n")

	res, err := repo.CommitSelected(context.Background(), CommitOptions{
		Message: "only b",
		Paths:   []string{"b.txt"},
	})
	if err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	if res.Subject != "only b" || res.Short == "" {
		t.Fatalf("result = %+v", res)
	}
	if shown := runGit(t, dir, "show", "--format=", "--name-only", "HEAD"); shown != "b.txt" {
		t.Fatalf("commit touched %q, want only b.txt", shown)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); staged != "a.txt" {
		t.Fatalf("staged = %q, want a.txt to stay staged", staged)
	}
	if status := runGit(t, dir, "status", "--porcelain"); strings.Contains(status, "b.txt") {
		t.Fatalf("b.txt is not clean after its commit:\n%s", status)
	}
}

func TestCommitSelectedIncludesUntrackedFilesAndLeavesOthers(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "new\n")
	writeFile(t, dir, "left.txt", "left\n")
	if _, err := repo.CommitSelected(context.Background(), CommitOptions{
		Message: "add new",
		Paths:   []string{"new.txt"},
	}); err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	if shown := runGit(t, dir, "show", "--format=", "--name-only", "HEAD"); shown != "new.txt" {
		t.Fatalf("commit touched %q", shown)
	}
	status := runGit(t, dir, "status", "--porcelain")
	if !strings.Contains(status, "?? left.txt") {
		t.Fatalf("left.txt is not untouched:\n%s", status)
	}
	if _, err := os.Stat(filepath.Join(dir, "new.txt")); err != nil {
		t.Fatalf("new.txt disappeared: %v", err)
	}
}

func TestCommitSelectedSignsOff(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nsigned\n")
	if _, err := repo.CommitSelected(context.Background(), CommitOptions{
		Message: "signed change",
		Paths:   []string{"a.txt"},
		SignOff: true,
	}); err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	if body := runGit(t, dir, "log", "-1", "--format=%B"); !strings.Contains(body, "Signed-off-by:") {
		t.Fatalf("message has no sign-off:\n%s", body)
	}
}

func TestCommitSelectedAmendsInsteadOfAddingACommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nsecond\n")
	root := runGit(t, dir, "rev-list", "--max-parents=0", "HEAD")

	res, err := repo.CommitSelected(context.Background(), CommitOptions{
		Amend: true, Message: "amended", Paths: []string{"a.txt"},
	})
	if err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	if count := runGit(t, dir, "rev-list", "--count", "HEAD"); count != "1" {
		t.Fatalf("HEAD has %s commits, want the amend to replace the first", count)
	}
	if parents := runGit(t, dir, "rev-list", "--parents", "-n", "1", "HEAD"); strings.Contains(parents, root) {
		t.Fatalf("the amended commit kept the old commit as a parent: %q", parents)
	}
	if subject := runGit(t, dir, "log", "-1", "--format=%s"); subject != "amended" {
		t.Fatalf("subject = %q", subject)
	}
	if content := runGit(t, dir, "show", "HEAD:a.txt"); content != "one\nsecond" {
		t.Fatalf("HEAD:a.txt = %q", content)
	}
	_ = res
}
