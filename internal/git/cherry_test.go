package git

import (
	"context"
	"testing"
)

func TestCherryPickedMarksPatchEquivalentCommits(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "x.txt", "x\n")
	runGit(t, dir, "add", "x.txt")
	runGit(t, dir, "commit", "-q", "-m", "feature")
	feature := runGit(t, dir, "rev-parse", "HEAD")
	runGit(t, dir, "switch", "-q", "-c", "side", "HEAD~1")
	writeFile(t, dir, "side.txt", "side\n")
	runGit(t, dir, "add", "side.txt")
	runGit(t, dir, "commit", "-q", "-m", "side work")
	runGit(t, dir, "cherry-pick", feature)
	copied := runGit(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "y.txt", "y\n")
	runGit(t, dir, "add", "y.txt")
	runGit(t, dir, "commit", "-q", "-m", "unique")
	unique := runGit(t, dir, "rev-parse", "HEAD")

	marked, err := repo.CherryPicked(context.Background(), []string{feature, copied, unique})
	if err != nil {
		t.Fatalf("CherryPicked: %v", err)
	}
	set := map[string]bool{}
	for _, hash := range marked {
		set[hash] = true
	}
	if !set[feature] || !set[copied] {
		t.Fatalf("marked = %v, want both copies", marked)
	}
	if set[unique] {
		t.Fatalf("marked = %v, but %s has no equivalent", marked, unique)
	}
}

func TestCherryPickedIgnoresUnknownInput(t *testing.T) {
	repo, _ := newTestRepo(t)
	marked, err := repo.CherryPicked(context.Background(), []string{"", "-x", "not a hash"})
	if err != nil {
		t.Fatalf("CherryPicked: %v", err)
	}
	if len(marked) != 0 {
		t.Fatalf("marked = %v", marked)
	}
}
