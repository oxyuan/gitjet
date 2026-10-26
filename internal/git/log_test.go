package git

import (
	"context"
	"testing"
)

func TestShowCommitListsBranchesContainingIt(t *testing.T) {
	repo, dir := newTestRepo(t)
	// A branch that does not move still contains the commit.
	runGit(t, dir, "branch", "parked")
	head := runGit(t, dir, "rev-parse", "HEAD")

	detail, err := repo.ShowCommit(context.Background(), head)
	if err != nil {
		t.Fatalf("ShowCommit: %v", err)
	}
	if len(detail.Branches) != 2 {
		t.Fatalf("branches = %v, want main and parked", detail.Branches)
	}
	// The checked out branch comes first.
	if detail.Branches[0] != "main" {
		t.Errorf("branches[0] = %q, want main", detail.Branches[0])
	}
	if detail.Branches[1] != "parked" {
		t.Errorf("branches[1] = %q, want parked", detail.Branches[1])
	}

	// A newer commit on the checked out branch is not on the parked one.
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	runGit(t, dir, "commit", "-qam", "second")
	second := runGit(t, dir, "rev-parse", "HEAD")
	detail, err = repo.ShowCommit(context.Background(), second)
	if err != nil {
		t.Fatalf("ShowCommit: %v", err)
	}
	if len(detail.Branches) != 1 || detail.Branches[0] != "main" {
		t.Errorf("branches = %v, want [main]", detail.Branches)
	}
}
