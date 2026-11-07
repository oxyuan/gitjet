package git

import (
	"context"
	"strings"
	"testing"
)

func TestMergeNoCommitLeavesTheResultInTheIndex(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "switch", "-q", "-c", "side")
	writeFile(t, dir, "side.txt", "side\n")
	runGit(t, dir, "add", "side.txt")
	runGit(t, dir, "commit", "-q", "-m", "side")
	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "main.txt", "main\n")
	runGit(t, dir, "add", "main.txt")
	runGit(t, dir, "commit", "-q", "-m", "main")
	head := runGit(t, dir, "rev-parse", "HEAD")
	if _, err := repo.Merge(context.Background(), "side", MergeOptions{NoCommit: true}); err != nil {
		t.Fatalf("Merge: %v", err)
	}
	if tip := runGit(t, dir, "rev-parse", "HEAD"); tip != head {
		t.Fatalf("HEAD moved to %s, want %s", tip, head)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); !strings.Contains(staged, "side.txt") {
		t.Fatalf("side.txt is not staged:\n%s", staged)
	}
}

func TestMergeRejectsContradictoryFastForwardOptions(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "switch", "-q", "-c", "side")
	runGit(t, dir, "switch", "-q", "main")
	if _, err := repo.Merge(context.Background(), "side", MergeOptions{NoFF: true, FFOnly: true}); err == nil {
		t.Fatal("Merge accepted --no-ff and --ff-only together")
	}
}

func TestMergeFFOnlyRefusesADivergedBranch(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "switch", "-q", "-c", "side")
	writeFile(t, dir, "side.txt", "side\n")
	runGit(t, dir, "add", "side.txt")
	runGit(t, dir, "commit", "-q", "-m", "side")
	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "main.txt", "main\n")
	runGit(t, dir, "add", "main.txt")
	runGit(t, dir, "commit", "-q", "-m", "main")
	if _, err := repo.Merge(context.Background(), "side", MergeOptions{FFOnly: true}); err == nil {
		t.Fatal("Merge --ff-only accepted a diverged branch")
	}
}

func TestMergeAllowUnrelatedHistoriesMergesTwoRoots(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "switch", "-q", "--orphan", "other")
	writeFile(t, dir, "other.txt", "other\n")
	runGit(t, dir, "add", "other.txt")
	runGit(t, dir, "commit", "-q", "-m", "other root")
	runGit(t, dir, "switch", "-q", "main")
	if _, err := repo.Merge(context.Background(), "other", MergeOptions{}); err == nil {
		t.Fatal("Merge merged unrelated histories without the option")
	}
	if _, err := repo.Merge(context.Background(), "other", MergeOptions{AllowUnrelatedHistories: true, NoCommit: true}); err != nil {
		t.Fatalf("Merge with unrelated histories: %v", err)
	}
}

func TestRebaseValidatesItsOptions(t *testing.T) {
	repo, _ := newTestRepo(t)
	ctx := context.Background()
	if _, err := repo.Rebase(ctx, RebaseOptions{}); err == nil {
		t.Fatal("Rebase accepted an empty new base")
	}
	if _, err := repo.Rebase(ctx, RebaseOptions{Onto: "HEAD", AutoSquash: "maybe"}); err == nil {
		t.Fatal("Rebase accepted an invalid autosquash value")
	}
}

func TestBlameIgnoreWhitespaceAttributesTheEarlierCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	// The line's content without its indentation was written by the first
	// commit, so -w must attribute it there.
	first := runGit(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "a.txt", "one\n  two\n")
	runGit(t, dir, "commit", "-q", "-am", "indent")
	writeFile(t, dir, "a.txt", "one\n      two\n")
	runGit(t, dir, "commit", "-q", "-am", "reindent")
	second := runGit(t, dir, "rev-parse", "HEAD")
	plain, err := repo.Blame(context.Background(), "a.txt", "", BlameOptions{})
	if err != nil {
		t.Fatalf("Blame: %v", err)
	}
	if got := plain.Lines[1].Commit; got != second {
		t.Fatalf("plain blame = %s, want %s", got, second)
	}
	spaced, err := repo.Blame(context.Background(), "a.txt", "", BlameOptions{IgnoreWhitespace: true})
	if err != nil {
		t.Fatalf("Blame -w: %v", err)
	}
	if got := spaced.Lines[1].Commit; got != first {
		t.Fatalf("blame -w = %s, want %s", got, first)
	}
}

func TestBlameSkipsTheCommittedIgnoreRevsFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	base := runGit(t, dir, "rev-parse", "HEAD")
	// A reformat moves indentation only, which is what the ignore file is
	// for: without it, blame names the formatting commit.
	writeFile(t, dir, "a.txt", "one\n    two\n")
	runGit(t, dir, "commit", "-q", "-am", "format")
	format := runGit(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, ".git-blame-ignore-revs", format+"\n")
	runGit(t, dir, "add", ".git-blame-ignore-revs")
	runGit(t, dir, "commit", "-q", "-m", "ignore the reformat")
	result, err := repo.Blame(context.Background(), "a.txt", "", BlameOptions{})
	if err != nil {
		t.Fatalf("Blame: %v", err)
	}
	if got := result.Lines[1].Commit; got != base {
		t.Fatalf("blame = %s, want %s (the ignored formatting commit)", got, base)
	}
}
