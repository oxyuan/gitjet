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
