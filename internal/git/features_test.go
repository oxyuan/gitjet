package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readWorkingFile(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestThreeWayDiffShowsHeadIndexAndWorktree(t *testing.T) {
	repo, dir := newTestRepo(t)
	commitFile(t, dir, "a.txt", "one\n", "base")
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "a.txt", "one\nstaged\nwork\n")

	three, err := repo.ThreeWay(context.Background(), DiffOptions{Path: "a.txt", Context: -1})
	if err != nil {
		t.Fatalf("ThreeWay: %v", err)
	}
	if three.Head != "one\n" {
		t.Errorf("HEAD = %q", three.Head)
	}
	if three.Index != "one\nstaged\n" {
		t.Errorf("index = %q", three.Index)
	}
	if three.Worktree != "one\nstaged\nwork\n" {
		t.Errorf("worktree = %q", three.Worktree)
	}
	if !three.Staged.HasChanges || !three.Unstaged.HasChanges {
		t.Errorf("both transitions need hunks: staged=%v unstaged=%v", three.Staged.HasChanges, three.Unstaged.HasChanges)
	}
	if three.HeadLabel != "HEAD" || three.IndexLabel != "Index" || three.WorktreeLabel != "Working Tree" {
		t.Errorf("labels = %q %q %q", three.HeadLabel, three.IndexLabel, three.WorktreeLabel)
	}
}

func TestCommitStagedOnlyLeavesTheWorktreeAlone(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "a1\n")
	writeFile(t, dir, "b.txt", "b1\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "base")

	writeFile(t, dir, "a.txt", "a2\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "b.txt", "b2\n")
	writeFile(t, dir, "c.txt", "new\n")

	res, err := repo.CommitSelected(context.Background(), CommitOptions{
		Message:    "staged only",
		StagedOnly: true,
	})
	if err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	if res.Subject != "staged only" {
		t.Errorf("subject = %q", res.Subject)
	}
	if got := runGit(t, dir, "show", "HEAD:a.txt"); got != "a2" {
		t.Errorf("HEAD:a.txt = %q", got)
	}
	if _, err := repo.run(context.Background(), "show", "HEAD:b.txt"); err != nil {
		t.Fatal("b.txt should still be at its committed version")
	}
	if got := runGit(t, dir, "show", "HEAD:b.txt"); got != "b1" {
		t.Errorf("HEAD:b.txt = %q, the unstaged edit was committed", got)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Changes) == 0 {
		t.Fatal("the unstaged and untracked changes disappeared")
	}
}

func TestCommitAllIncludesUntrackedFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "a1\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "base")
	writeFile(t, dir, "a.txt", "a2\n")
	writeFile(t, dir, "new.txt", "new\n")

	if _, err := repo.CommitAllChanges(context.Background(), CommitOptions{Message: "all"}); err != nil {
		t.Fatalf("CommitAllChanges: %v", err)
	}
	files := runGit(t, dir, "ls-tree", "-r", "--name-only", "HEAD")
	if !strings.Contains(files, "a.txt") || !strings.Contains(files, "new.txt") {
		t.Errorf("committed files = %q", files)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Changes) != 0 {
		t.Errorf("changes left after commit all: %+v", st.Changes)
	}
}

func TestAmendCommitFoldsStagedChangesIntoAnOlderCommit(t *testing.T) {
	repo, dir := newTestRepo(t)
	target := commitFile(t, dir, "a.txt", "a1\n", "first change")
	commitFile(t, dir, "b.txt", "b1\n", "second change")
	writeFile(t, dir, "a.txt", "a2\n")
	runGit(t, dir, "add", "a.txt")

	if _, err := repo.AmendCommit(context.Background(), target, "first change, amended"); err != nil {
		t.Fatalf("AmendCommit: %v", err)
	}
	subjects := logSubjects(t, dir)
	want := []string{"initial", "first change, amended", "second change"}
	if strings.Join(subjects, "|") != strings.Join(want, "|") {
		t.Fatalf("subjects = %v, want %v", subjects, want)
	}
	if got := runGit(t, dir, "show", "HEAD~1:a.txt"); got != "a2" {
		t.Errorf("the amended commit still has %q", got)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(st.Changes) != 0 {
		t.Errorf("changes left after amending: %+v", st.Changes)
	}
}

func TestCommitFixupBySubjectRefusesAnAmbiguousSubject(t *testing.T) {
	repo, dir := newTestRepo(t)
	commitFile(t, dir, "a.txt", "a\n", "same subject")
	commitFile(t, dir, "b.txt", "b\n", "same subject")
	writeFile(t, dir, "c.txt", "c\n")
	runGit(t, dir, "add", "c.txt")

	_, err := repo.CommitFixupBySubject(context.Background(), "same subject", false)
	if err == nil || !strings.Contains(err.Error(), "commits have the subject") {
		t.Fatalf("err = %v", err)
	}
}

func TestCheckCommitWarnsAboutEmptyChangesAndGpg(t *testing.T) {
	repo, _ := newTestRepo(t)
	warnings, err := repo.CheckCommit(context.Background(), nil, CommitCheckOptions{})
	if err != nil {
		t.Fatalf("CheckCommit: %v", err)
	}
	kinds := map[string]bool{}
	for _, w := range warnings {
		kinds[w.Kind] = true
	}
	if !kinds["empty"] {
		t.Errorf("warnings = %+v, want an empty warning", warnings)
	}
	if kinds["identity"] {
		t.Errorf("the fixture's identity was reported missing: %+v", warnings)
	}
}

func TestCheckCommitDetectsAMissingGpgProgram(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "config", "commit.gpgsign", "true")
	runGit(t, dir, "config", "gpg.program", "gitjet-no-such-gpg")
	warnings, err := repo.CheckCommit(context.Background(), nil, CommitCheckOptions{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, w := range warnings {
		if w.Kind == "gpg" {
			found = true
		}
	}
	if !found {
		t.Errorf("warnings = %+v, want a gpg warning", warnings)
	}
}

func TestLogResultCarriesTheCommandAndRefs(t *testing.T) {
	repo, dir := newTestRepo(t)
	commitFile(t, dir, "a.txt", "a\n", "second")
	result, err := repo.Log(context.Background(), LogOptions{Refs: []string{"HEAD"}, Limit: 5})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if !strings.Contains(result.Command, "git log") || !strings.Contains(result.Command, "HEAD") {
		t.Errorf("command = %q", result.Command)
	}
	if len(result.Commits) == 0 {
		t.Error("no commits returned")
	}
}

func TestLogRejectsARefThatLooksLikeAnOption(t *testing.T) {
	repo, _ := newTestRepo(t)
	if _, err := repo.Log(context.Background(), LogOptions{Refs: []string{"--all"}}); err == nil {
		t.Fatal("a ref starting with - must be refused")
	}
}

func TestLocalHistoryAllListsEveryFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "a1\n")
	writeFile(t, dir, "b.txt", "b1\n")
	if _, _, err := repo.SnapshotLocal("a.txt", "first"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.SnapshotLocal("b.txt", "first"); err != nil {
		t.Fatal(err)
	}
	entries := repo.LocalHistoryAll()
	if len(entries) != 2 {
		t.Fatalf("entries = %+v", entries)
	}
	seen := map[string]bool{}
	for _, e := range entries {
		seen[e.Path] = true
	}
	if !seen["a.txt"] || !seen["b.txt"] {
		t.Errorf("paths = %+v", seen)
	}
}

func TestSaveShelfRestoresUntrackedFilesAndTheIndex(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "base\n")
	runGit(t, dir, "add", "a.txt")
	runGit(t, dir, "commit", "-q", "-m", "base")
	writeFile(t, dir, "a.txt", "staged\n")
	writeFile(t, dir, "added.txt", "added\n")
	runGit(t, dir, "add", "a.txt", "added.txt")
	writeFile(t, dir, "a.txt", "work\n")
	writeFile(t, dir, "new.txt", "new\n")

	shelf, err := repo.SaveShelf(context.Background(), "all", PatchOptions{IncludeUntracked: true})
	if err != nil {
		t.Fatalf("SaveShelf: %v", err)
	}
	if !shelf.Staged || shelf.Untracked != 1 {
		t.Errorf("shelf = %+v", shelf)
	}
	if _, err := os.Stat(filepath.Join(dir, "new.txt")); !os.IsNotExist(err) {
		t.Error("the untracked file was left in the worktree")
	}
	if got := runGit(t, dir, "show", "HEAD:a.txt"); got != "base" {
		t.Errorf("a.txt = %q after shelving", got)
	}

	if _, err := repo.ApplyShelf(context.Background(), "all", false); err != nil {
		t.Fatalf("ApplyShelf: %v", err)
	}
	if got := readWorkingFile(t, dir, "a.txt"); got != "work\n" {
		t.Errorf("a.txt = %q after apply", got)
	}
	if got := runGit(t, dir, "show", ":a.txt"); got != "staged" {
		t.Errorf("index a.txt = %q after apply", got)
	}
	if got := runGit(t, dir, "show", ":added.txt"); got != "added" {
		t.Errorf("index added.txt = %q after apply", got)
	}
	if got := readWorkingFile(t, dir, "new.txt"); got != "new\n" {
		t.Errorf("new.txt = %q after apply", got)
	}
}

func TestRewriteExecBreakAndContinue(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	c2 := commitFile(t, dir, "c.txt", "c\n", "third")
	ctx := context.Background()

	out, err := repo.Rewrite(ctx, "HEAD~2", []PlanStep{
		{Hash: c1, Action: PlanPick},
		{Action: PlanExec, Command: "printf 'ran' > exec.txt"},
		{Action: PlanBreak},
		{Hash: c2, Action: PlanPick},
	})
	if err != nil {
		t.Fatalf("Rewrite: %v", err)
	}
	if !strings.Contains(out, "stopped at break") {
		t.Errorf("output = %q", out)
	}
	if _, err := os.Stat(filepath.Join(dir, "exec.txt")); err != nil {
		t.Error("the exec step did not run")
	}
	if _, err := os.Stat(filepath.Join(dir, "c.txt")); !os.IsNotExist(err) {
		t.Error("the commit after the break was replayed too early")
	}
	if _, err := repo.ContinueOperation(ctx); err != nil {
		t.Fatalf("ContinueOperation: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "c.txt")); err != nil {
		t.Error("the plan did not resume after the break")
	}
}

func TestRewriteContinuesPastAFailedExec(t *testing.T) {
	repo, dir := newTestRepo(t)
	c1 := commitFile(t, dir, "b.txt", "b\n", "second")
	c2 := commitFile(t, dir, "c.txt", "c\n", "third")
	ctx := context.Background()

	_, err := repo.Rewrite(ctx, "HEAD~2", []PlanStep{
		{Hash: c1, Action: PlanPick},
		{Action: PlanExec, Command: "exit 7"},
		{Hash: c2, Action: PlanPick},
	})
	if err == nil {
		t.Fatal("a failing exec must be reported")
	}
	if _, err := repo.ContinueOperation(ctx); err != nil {
		t.Fatalf("ContinueOperation: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "c.txt")); err != nil {
		t.Error("continue did not resume after the failed exec")
	}
}
