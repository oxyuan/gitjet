package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// commitFile writes a file and commits it, returning the new commit hash.
func commitFile(t *testing.T, dir, name, content, message string) string {
	t.Helper()
	writeFile(t, dir, name, content)
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", message)
	return runGit(t, dir, "rev-parse", "HEAD")
}

// logSubjects lists the commit subjects of the branch, oldest first.
func logSubjects(t *testing.T, dir string) []string {
	t.Helper()
	out := runGit(t, dir, "log", "--reverse", "--format=%s")
	if out == "" {
		return nil
	}
	return strings.Split(out, "\n")
}

func logMessages(t *testing.T, dir string) []string {
	t.Helper()
	out := runGit(t, dir, "log", "--reverse", "--format=%B%x1e")
	records := []string{}
	for _, r := range strings.Split(out, "\x1e") {
		r = strings.TrimSpace(r)
		if r != "" {
			records = append(records, r)
		}
	}
	return records
}

func TestRewritePlanListsRangeOldestFirst(t *testing.T) {
	repo, dir := newTestRepo(t)
	commitFile(t, dir, "b.txt", "b\n", "second")
	commitFile(t, dir, "c.txt", "c\n", "third")

	plan, err := repo.RewritePlan(context.Background(), "HEAD~2")
	if err != nil {
		t.Fatalf("RewritePlan: %v", err)
	}
	if len(plan) != 2 {
		t.Fatalf("plan has %d commits, want 2", len(plan))
	}
	if plan[0].Subject != "second" || plan[1].Subject != "third" {
		t.Errorf("subjects = %q, %q", plan[0].Subject, plan[1].Subject)
	}
	if plan[0].Merge || plan[1].Merge {
		t.Error("plain commits were reported as merges")
	}
}

func TestRewriteSquashesAndFixups(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	c2 := commitFile(t, dir, "c.txt", "c\n", "third")
	c3 := commitFile(t, dir, "d.txt", "d\n", "fourth")
	ctx := context.Background()

	_, err := repo.Rewrite(ctx, "HEAD~3", []PlanStep{
		{Hash: c1, Action: PlanPick},
		{Hash: c2, Action: PlanSquash, Message: "third, folded"},
		{Hash: c3, Action: PlanFixup},
	})
	if err != nil {
		t.Fatalf("Rewrite: %v", err)
	}
	subjects := logSubjects(t, dir)
	want := []string{"initial", "second"}
	if strings.Join(subjects, ",") != strings.Join(want, ",") {
		t.Fatalf("subjects = %v, want %v", subjects, want)
	}
	msgs := logMessages(t, dir)
	if !strings.Contains(msgs[1], "third, folded") || !strings.Contains(msgs[1], "second") {
		t.Errorf("squashed message = %q", msgs[1])
	}
	if strings.Contains(msgs[1], "fourth") {
		t.Errorf("fixup kept the folded commit's message: %q", msgs[1])
	}
	for _, name := range []string{"b.txt", "c.txt", "d.txt"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s is missing after the rewrite", name)
		}
	}
	if _, err := os.Stat(filepath.Join(repo.GitDir(), planFile)); err == nil {
		t.Error("the plan file was left behind")
	}
}

func TestRewriteDropsCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	c2 := commitFile(t, dir, "c.txt", "c\n", "third")
	ctx := context.Background()

	if _, err := repo.Rewrite(ctx, "HEAD~2", []PlanStep{
		{Hash: c1, Action: PlanPick},
		{Hash: c2, Action: PlanDrop},
	}); err != nil {
		t.Fatalf("Rewrite: %v", err)
	}
	if got := logSubjects(t, dir); len(got) != 2 || got[1] != "second" {
		t.Fatalf("subjects = %v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "c.txt")); !os.IsNotExist(err) {
		t.Error("the dropped commit's file is still there")
	}
}

func TestRewriteRewordsWithoutChangingTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	tree := runGit(t, dir, "rev-parse", "HEAD^{tree}")
	ctx := context.Background()

	if _, err := repo.Rewrite(ctx, "HEAD~1", []PlanStep{
		{Hash: c1, Action: PlanReword, Message: "second, reworded"},
	}); err != nil {
		t.Fatalf("Rewrite: %v", err)
	}
	if got := logSubjects(t, dir); got[len(got)-1] != "second, reworded" {
		t.Fatalf("subjects = %v", got)
	}
	if got := runGit(t, dir, "rev-parse", "HEAD^{tree}"); got != tree {
		t.Errorf("tree changed: %s != %s", got, tree)
	}
}

func TestRewriteRejectsPlanThatDoesNotMatchTheRange(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	commitFile(t, dir, "c.txt", "c\n", "third")
	ctx := context.Background()

	_, err := repo.Rewrite(ctx, "HEAD~2", []PlanStep{{Hash: c1, Action: PlanPick}})
	if err == nil {
		t.Fatal("Rewrite accepted a plan shorter than the range")
	}
	if !strings.Contains(err.Error(), "covers") {
		t.Errorf("error = %v", err)
	}
}

func TestRewriteRejectsDirtyWorkTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	writeFile(t, dir, "b.txt", "dirty\n")

	_, err := repo.Rewrite(context.Background(), "HEAD~1", []PlanStep{{Hash: c1, Action: PlanPick}})
	if err == nil || !strings.Contains(err.Error(), "stash") {
		t.Fatalf("error = %v, want a local changes refusal", err)
	}
}

func TestRewriteConflictKeepsPlanForContinue(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	// Two commits editing the same line: dropping the first makes the
	// second conflict when the plan replays it.
	writeFile(t, dir, "a.txt", "one\nbase\n")
	runGit(t, dir, "commit", "-qam", "prepare")
	c1 := commitFile(t, dir, "a.txt", "one\nfirst\n", "first")
	c2 := commitFile(t, dir, "a.txt", "one\nsecond\n", "second")

	_, err := repo.Rewrite(ctx, c1+"^", []PlanStep{
		{Hash: c1, Action: PlanDrop},
		{Hash: c2, Action: PlanReword, Message: "second, reworded"},
	})
	if err == nil {
		t.Fatal("Rewrite did not conflict")
	}
	if _, err := os.Stat(filepath.Join(repo.GitDir(), planFile)); err != nil {
		t.Fatal("the plan was not saved for continue")
	}
	if op, progress, _ := repo.operation(); op != "rebase-interactive" || progress == "" {
		t.Errorf("operation = %q %q", op, progress)
	}

	// Resolve the conflict in favour of the incoming side and continue.
	writeFile(t, dir, "a.txt", "one\nsecond\n")
	runGit(t, dir, "add", "a.txt")
	if _, err := repo.ContinueOperation(ctx); err != nil {
		t.Fatalf("ContinueOperation: %v", err)
	}
	if got := logSubjects(t, dir); got[len(got)-1] != "second, reworded" {
		t.Fatalf("subjects = %v", got)
	}
	if _, err := os.Stat(filepath.Join(repo.GitDir(), planFile)); err == nil {
		t.Error("the plan file survived the finished rewrite")
	}
}

func TestRewriteAbortRestoresOriginalTip(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	writeFile(t, dir, "a.txt", "one\nbase\n")
	runGit(t, dir, "commit", "-qam", "prepare")
	c1 := commitFile(t, dir, "a.txt", "one\nfirst\n", "first")
	c2 := commitFile(t, dir, "a.txt", "one\nsecond\n", "second")
	original := runGit(t, dir, "rev-parse", "HEAD")

	if _, err := repo.Rewrite(ctx, c1+"^", []PlanStep{
		{Hash: c1, Action: PlanDrop},
		{Hash: c2, Action: PlanPick},
	}); err == nil {
		t.Fatal("Rewrite did not conflict")
	}
	if _, err := repo.AbortOperation(ctx); err != nil {
		t.Fatalf("AbortOperation: %v", err)
	}
	if got := runGit(t, dir, "rev-parse", "HEAD"); got != original {
		t.Errorf("HEAD = %s, want %s", got, original)
	}
	if _, err := os.Stat(filepath.Join(repo.GitDir(), planFile)); err == nil {
		t.Error("the plan file survived the abort")
	}
	if op, _, _ := repo.operation(); op != "" {
		t.Errorf("operation = %q after abort", op)
	}
}

func TestRewriteStopsToEditAndContinues(t *testing.T) {
	repo, dir := newTestRepo(t)
	onto := runGit(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "first")
	writeFile(t, dir, "c.txt", "c\n")
	runGit(t, dir, "add", "c.txt")
	runGit(t, dir, "commit", "-q", "-m", "second")
	plan, err := repo.RewritePlan(context.Background(), onto)
	if err != nil {
		t.Fatalf("RewritePlan: %v", err)
	}
	steps := []PlanStep{
		{Hash: plan[0].Hash, Action: PlanEdit},
		{Hash: plan[1].Hash, Action: PlanPick},
	}
	out, err := repo.Rewrite(context.Background(), onto, steps)
	if err != nil {
		t.Fatalf("Rewrite: %v", err)
	}
	if !strings.Contains(out, "stopped to edit") {
		t.Fatalf("output = %q, want a stop for the edit", out)
	}
	if op, _, _ := repo.operation(); op != "rebase-interactive" {
		t.Fatalf("operation = %q, want rebase-interactive", op)
	}
	// The user amends the commit the edit stopped on, then continues.
	runGit(t, dir, "commit", "-q", "--amend", "-m", "first amended")
	if _, err := repo.ContinueOperation(context.Background()); err != nil {
		t.Fatalf("ContinueOperation: %v", err)
	}
	if op, _, _ := repo.operation(); op != "" {
		t.Fatalf("operation = %q after continue, want none", op)
	}
	subjects := runGit(t, dir, "log", "--format=%s", "-2")
	if subjects != "second\nfirst amended" {
		t.Fatalf("history = %q", subjects)
	}
}

func TestRewriteReordersIndependentCommits(t *testing.T) {
	repo, dir := newTestRepo(t)
	onto := runGit(t, dir, "rev-parse", "HEAD")
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "first")
	writeFile(t, dir, "c.txt", "c\n")
	runGit(t, dir, "add", "c.txt")
	runGit(t, dir, "commit", "-q", "-m", "second")
	plan, err := repo.RewritePlan(context.Background(), onto)
	if err != nil {
		t.Fatal(err)
	}
	reordered := []PlanStep{
		{Hash: plan[1].Hash, Action: PlanPick},
		{Hash: plan[0].Hash, Action: PlanPick},
	}
	if _, err := repo.Rewrite(context.Background(), onto, reordered); err != nil {
		t.Fatalf("Rewrite: %v", err)
	}
	if subjects := runGit(t, dir, "log", "--format=%s", "-2"); subjects != "first\nsecond" {
		t.Fatalf("history = %q, want the commits in the new order", subjects)
	}
	if _, err := os.Stat(filepath.Join(dir, "c.txt")); err != nil {
		t.Fatalf("c.txt is missing: %v", err)
	}
}

func TestStalePlanIsNotReplayedOnAnotherBranch(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "switch", "-q", "-c", "other")
	writeFile(t, dir, "other.txt", "other\n")
	runGit(t, dir, "add", "other.txt")
	runGit(t, dir, "commit", "-q", "-m", "other work")
	runGit(t, dir, "switch", "-q", "main")

	// A plan left behind by a conflict names the branch it belonged to.
	head := runGit(t, dir, "rev-parse", "HEAD")
	plan := &planState{
		Onto:     "HEAD~1",
		Branch:   "feature",
		Original: head,
		Steps:    []PlanStep{{Hash: head, Action: PlanPick}},
	}
	if err := repo.writePlan(plan); err != nil {
		t.Fatalf("writePlan: %v", err)
	}
	before := runGit(t, dir, "rev-parse", "HEAD")
	if out, err := repo.AbortOperation(context.Background()); err == nil {
		t.Fatalf("AbortOperation replayed a plan of another branch: %q", out)
	}
	if after := runGit(t, dir, "rev-parse", "HEAD"); after != before {
		t.Fatalf("HEAD moved from %s to %s", before, after)
	}
	if _, ok := repo.readPlan(); ok {
		t.Fatal("the stale plan was kept")
	}
}
