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

func TestLogAllCoversBranchesThatWereNeverMerged(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "checkout", "-q", "-b", "side")
	writeFile(t, dir, "side.txt", "side\n")
	runGit(t, dir, "add", "side.txt")
	runGit(t, dir, "commit", "-qm", "side work")
	side := runGit(t, dir, "rev-parse", "HEAD")
	runGit(t, dir, "checkout", "-q", "main")

	all, err := repo.Log(context.Background(), LogOptions{All: true, Limit: 50})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if !hasCommit(all, side) {
		t.Errorf("history of all branches misses %s from the side branch", side[:8])
	}

	mainOnly, err := repo.Log(context.Background(), LogOptions{Refs: []string{"main"}, Limit: 50})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if hasCommit(mainOnly, side) {
		t.Errorf("history of main alone should not list the side branch")
	}
}

func TestShowCommitReportsEveryParentOfAMerge(t *testing.T) {
	repo, dir := newTestRepo(t)
	first := runGit(t, dir, "rev-parse", "HEAD")
	runGit(t, dir, "checkout", "-q", "-b", "side")
	writeFile(t, dir, "side.txt", "side\n")
	runGit(t, dir, "add", "side.txt")
	runGit(t, dir, "commit", "-qm", "side work")
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "main.txt", "main\n")
	runGit(t, dir, "add", "main.txt")
	runGit(t, dir, "commit", "-qm", "main work")
	runGit(t, dir, "merge", "-q", "--no-ff", "-m", "merge side", "side")

	merge := runGit(t, dir, "rev-parse", "HEAD")
	detail, err := repo.ShowCommit(context.Background(), merge)
	if err != nil {
		t.Fatalf("ShowCommit: %v", err)
	}
	if len(detail.Parents) != 2 {
		t.Fatalf("parents = %v, want two", detail.Parents)
	}
	if detail.Parents[1] == first {
		t.Errorf("second parent = first commit, want the side branch tip")
	}
}

func hasCommit(result LogResult, hash string) bool {
	for _, commit := range result.Commits {
		if commit.Hash == hash {
			return true
		}
	}
	return false
}
