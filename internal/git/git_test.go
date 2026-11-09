package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// newTestRepo creates a repository with one committed file and a local
// identity, isolated from the developer's git configuration.
func newTestRepo(t *testing.T) (*Repo, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(home, "gitconfig"))
	t.Setenv("GIT_CONFIG_SYSTEM", filepath.Join(home, "gitconfig-system"))
	t.Setenv("GIT_AUTHOR_NAME", "Test")
	t.Setenv("GIT_AUTHOR_EMAIL", "test@example.com")
	t.Setenv("GIT_COMMITTER_NAME", "Test")
	t.Setenv("GIT_COMMITTER_EMAIL", "test@example.com")
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "-b", "main")
	writeFile(t, dir, "a.txt", "one\ntwo\n")
	runGit(t, dir, "add", "a.txt")
	runGit(t, dir, "commit", "-q", "-m", "initial")
	repo, err := Open(context.Background(), dir, "")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return repo, dir
}

func runGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = gitEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStatusSplitsIndexAndWorkTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nchanged\n")
	writeFile(t, dir, "new.txt", "new\n")
	if err := repo.Stage(context.Background(), []string{"a.txt"}); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	writeFile(t, dir, "a.txt", "one\nchanged\nalso\n")

	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if st.State.Branch != "main" {
		t.Errorf("branch = %q, want main", st.State.Branch)
	}
	if st.State.Staged != 1 {
		t.Errorf("staged = %d, want 1", st.State.Staged)
	}
	var staged, unstaged, untracked int
	for _, c := range st.Changes {
		if c.Staged {
			staged++
		} else if c.Path == "a.txt" {
			unstaged++
		}
		if c.Path == "new.txt" && c.Kind != "untracked" {
			t.Errorf("new.txt kind = %q, want untracked", c.Kind)
		}
		if c.Path == "new.txt" {
			untracked++
		}
	}
	if staged != 1 || unstaged != 1 || untracked != 1 {
		t.Errorf("staged=%d unstaged=%d untracked=%d, want 1/1/1", staged, unstaged, untracked)
	}
	if st.State.Changed != 1 || st.State.Untracked != 1 {
		t.Errorf("changed=%d untracked=%d, want 1/1", st.State.Changed, st.State.Untracked)
	}
}

func TestDiffParsesHunksAndStagesOne(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\n")
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree, Context: 1})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("hunks = %d, want 1", len(d.Hunks))
	}
	if d.Additions == 0 || d.Deletions == 0 {
		t.Fatalf("adds=%d dels=%d, want both", d.Additions, d.Deletions)
	}
	if err := repo.ApplyDiffHunk(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree, Context: 1}, 0, "stage"); err != nil {
		t.Fatalf("ApplyDiffHunk: %v", err)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if st.State.Staged != 1 {
		t.Fatalf("staged = %d, want 1", st.State.Staged)
	}
}

func TestCommitSelectedAndLog(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nchanged\n")
	writeFile(t, dir, "b.txt", "b\n")
	res, err := repo.Commit(context.Background(), CommitOptions{Message: "change a", Paths: []string{"a.txt"}})
	if err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if res.Hash == "" || res.Subject != "change a" {
		t.Fatalf("result = %+v", res)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	var bUntracked bool
	for _, c := range st.Changes {
		if c.Path == "b.txt" && c.Kind == "untracked" {
			bUntracked = true
		}
		if c.Path == "a.txt" {
			t.Errorf("a.txt still changed after commit: %+v", c)
		}
	}
	if !bUntracked {
		t.Error("b.txt should remain untracked")
	}
	log, err := repo.Log(context.Background(), LogOptions{Limit: 10})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(log.Commits) != 2 || log.Commits[0].Subject != "change a" {
		t.Fatalf("log = %+v", log.Commits)
	}
	detail, err := repo.ShowCommit(context.Background(), log.Commits[0].Hash)
	if err != nil {
		t.Fatalf("ShowCommit: %v", err)
	}
	if len(detail.Files) != 1 || detail.Files[0].Path != "a.txt" {
		t.Fatalf("files = %+v", detail.Files)
	}
}

func TestRootCommitDiff(t *testing.T) {
	repo, _ := newTestRepo(t)
	log, err := repo.Log(context.Background(), LogOptions{Limit: 5})
	if err != nil {
		t.Fatal(err)
	}
	root := log.Commits[len(log.Commits)-1]
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a.txt", Target: DiffCommit, Revision: root.Hash})
	if err != nil {
		t.Fatalf("FileDiff root: %v", err)
	}
	if len(d.Hunks) != 1 || d.Status != "added" || d.Additions != 2 {
		t.Fatalf("root diff = status %q hunks %d adds %d", d.Status, len(d.Hunks), d.Additions)
	}
}

func TestHunkUnstageLeavesWorkTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nchanged\n")
	if err := repo.Stage(context.Background(), []string{"a.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.ApplyDiffHunk(context.Background(), DiffOptions{Path: "a.txt", Target: DiffStaged, Context: 3}, 0, "unstage"); err != nil {
		t.Fatalf("unstage hunk: %v", err)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if st.State.Staged != 0 {
		t.Fatalf("staged = %d, want 0", st.State.Staged)
	}
	if st.State.Changed != 1 {
		t.Fatalf("changed = %d, want 1", st.State.Changed)
	}
}

func TestStageHunkOfNewFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "a\nb\nc\n")
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "new.txt", Target: DiffWorkingTree})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("hunks = %d, want 1", len(d.Hunks))
	}
	if err := repo.ApplyDiffHunk(context.Background(), DiffOptions{Path: "new.txt", Target: DiffWorkingTree}, 0, "stage"); err != nil {
		t.Fatalf("stage hunk: %v", err)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	staged := false
	for _, c := range st.Changes {
		if c.Path == "new.txt" && c.Staged {
			staged = true
		}
	}
	if !staged {
		t.Fatalf("new.txt is not staged: %+v", st.Changes)
	}
}

func TestBranchesStashAndRefs(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := repo.CreateBranch(context.Background(), "feature", "main", true); err != nil {
		t.Fatalf("CreateBranch: %v", err)
	}
	refs, err := repo.Refs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if refs.Current != "feature" {
		t.Fatalf("current = %q, want feature", refs.Current)
	}
	writeFile(t, dir, "a.txt", "one\nstashed\n")
	if _, err := repo.StashPush(context.Background(), StashOptions{Message: "wip"}); err != nil {
		t.Fatalf("StashPush: %v", err)
	}
	stashes, err := repo.Stashes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(stashes) != 1 || stashes[0].Message == "" {
		t.Fatalf("stashes = %+v", stashes)
	}
	st, _ := repo.Status(context.Background(), false)
	if st.State.Changed != 0 {
		t.Fatalf("working tree not clean after stash: %+v", st.Changes)
	}
	if _, err := repo.StashApply(context.Background(), 0, true, false); err != nil {
		t.Fatalf("StashApply: %v", err)
	}
	st, _ = repo.Status(context.Background(), false)
	if st.State.Changed != 1 {
		t.Fatalf("changed = %d after pop, want 1", st.State.Changed)
	}
}

func TestTakeConflictSideDeletesAMissingStage(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "checkout", "-q", "-b", "delete")
	runGit(t, dir, "rm", "-q", "a.txt")
	runGit(t, dir, "commit", "-q", "-m", "delete")
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "a.txt", "one\nlocal\n")
	runGit(t, dir, "commit", "-q", "-am", "local")
	if _, err := repo.Merge(context.Background(), "delete", MergeOptions{}); err == nil {
		t.Fatal("merge should have conflicted")
	}
	conflict, err := repo.Conflict(context.Background(), "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if conflict.HasTheirs {
		t.Fatalf("theirs stage should be missing: %+v", conflict)
	}
	if err := repo.TakeConflictSide(context.Background(), "a.txt", "theirs"); err != nil {
		t.Fatalf("TakeConflictSide: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.txt")); !os.IsNotExist(err) {
		t.Fatalf("a.txt still exists: %v", err)
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if st.State.Conflicts != 0 {
		t.Fatalf("conflicts = %d after taking the deletion", st.State.Conflicts)
	}
}

func TestConflictResolution(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "checkout", "-q", "-b", "other")
	writeFile(t, dir, "a.txt", "one\ntheirs\n")
	runGit(t, dir, "commit", "-q", "-am", "theirs")
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "a.txt", "one\nours\n")
	runGit(t, dir, "commit", "-q", "-am", "ours")
	if _, err := repo.Merge(context.Background(), "other", MergeOptions{}); err == nil {
		t.Fatal("merge should have conflicted")
	}
	st, err := repo.Status(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if st.State.Operation != "merge" || st.State.Conflicts != 1 {
		t.Fatalf("operation=%q conflicts=%d", st.State.Operation, st.State.Conflicts)
	}
	conflict, err := repo.Conflict(context.Background(), "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !conflict.HasOurs || !conflict.HasTheirs || !strings.Contains(conflict.Ours, "ours") {
		t.Fatalf("conflict = %+v", conflict)
	}
	if conflict.Language != languageOf("a.txt") {
		t.Fatalf("language = %q, want %q", conflict.Language, languageOf("a.txt"))
	}
	if err := repo.SaveResolution(context.Background(), "a.txt", "one\nresolved\n", true); err != nil {
		t.Fatal(err)
	}
	st, _ = repo.Status(context.Background(), false)
	if st.State.Conflicts != 0 {
		t.Fatalf("conflicts = %d after resolution", st.State.Conflicts)
	}
	if _, err := repo.ContinueOperation(context.Background()); err != nil {
		t.Fatalf("ContinueOperation: %v", err)
	}
	st, _ = repo.Status(context.Background(), false)
	if st.State.Operation != "" {
		t.Fatalf("operation = %q after continue", st.State.Operation)
	}
}

func TestFileContentAndFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "src/main.ts", "export const answer = 42;\n")
	writeFile(t, dir, "untracked.md", "# notes\n")
	file, err := repo.FileContent(context.Background(), "src/main.ts", "")
	if err != nil {
		t.Fatal(err)
	}
	if !file.Exists || file.Language != "typescript" || !strings.Contains(file.Text, "answer") {
		t.Fatalf("file = %+v", file)
	}
	log, err := repo.Log(context.Background(), LogOptions{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	atHead, err := repo.FileContent(context.Background(), "a.txt", log.Commits[0].Hash)
	if err != nil {
		t.Fatal(err)
	}
	if atHead.Text != "one\ntwo\n" {
		t.Fatalf("HEAD content = %q", atHead.Text)
	}
	missing, err := repo.FileContent(context.Background(), "new.txt", "")
	if err != nil || missing.Exists {
		t.Fatalf("missing file = %+v, err %v", missing, err)
	}
	files, err := repo.Files(context.Background(), "srcmain", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Path != "src/main.ts" {
		t.Fatalf("files = %+v", files)
	}
	files, err = repo.Files(context.Background(), "untracked", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Tracked {
		t.Fatalf("untracked file = %+v", files)
	}
}

func TestSplitCommandLine(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{`commit -m "hello world"`, []string{"commit", "-m", "hello world"}},
		{`log --grep='a b' --oneline`, []string{"log", "--grep=a b", "--oneline"}},
		{`  status  `, []string{"status"}},
		{`show "a \"b\""`, []string{"show", `a "b"`}},
	}
	for _, c := range cases {
		got, err := SplitCommandLine(c.in)
		if err != nil {
			t.Fatalf("%q: %v", c.in, err)
		}
		if strings.Join(got, "|") != strings.Join(c.want, "|") {
			t.Errorf("%q = %q, want %q", c.in, got, c.want)
		}
	}
	if _, err := SplitCommandLine(`commit -m "unclosed`); err == nil {
		t.Error("unclosed quote should fail")
	}
}

func TestSaveResolutionWaitsForCleanResult(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "checkout", "-q", "-b", "other")
	writeFile(t, dir, "a.txt", "one\ntheirs\n")
	runGit(t, dir, "commit", "-q", "-am", "theirs")
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "a.txt", "one\nours\n")
	runGit(t, dir, "commit", "-q", "-am", "ours")
	if out, err := repo.Merge(context.Background(), "other", MergeOptions{}); err == nil {
		t.Fatalf("merge should have conflicted: %q", out)
	}
	// A half-resolved file is written but stays unmerged.
	half := "<<<<<<< HEAD\none\nours\n=======\ntheirs\n>>>>>>> other\n"
	if err := repo.SaveResolution(context.Background(), "a.txt", half, false); err != nil {
		t.Fatal(err)
	}
	st, _ := repo.Status(context.Background(), false)
	if st.State.Conflicts != 1 {
		t.Fatalf("conflicts = %d after a partial save", st.State.Conflicts)
	}
	detail, err := repo.MergeDetails(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if detail.Kind != "merge" || detail.Ours.Branch != "main" || detail.Theirs.Branch != "other" {
		t.Fatalf("merge details = %+v", detail)
	}
	if got := CountConflictMarkers(half); got != 1 {
		t.Fatalf("markers = %d, want 1", got)
	}
	if err := repo.SaveResolution(context.Background(), "a.txt", "one\nresolved\n", true); err != nil {
		t.Fatal(err)
	}
	st, _ = repo.Status(context.Background(), false)
	if st.State.Conflicts != 0 {
		t.Fatalf("conflicts = %d after a clean save", st.State.Conflicts)
	}
}

// linkConflict creates a merge that stops on a symbolic link both sides
// retargeted, and returns the repository and its directory.
func linkConflict(t *testing.T) (*Repo, string) {
	t.Helper()
	repo, dir := newTestRepo(t)
	link := filepath.Join(dir, "link")
	retarget := func(target string) {
		t.Helper()
		if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("symlink: %v", err)
		}
		runGit(t, dir, "add", "link")
		runGit(t, dir, "commit", "-q", "-m", target)
	}
	retarget("a.txt")
	runGit(t, dir, "branch", "other")
	retarget("b.txt")
	runGit(t, dir, "checkout", "-q", "other")
	retarget("c.txt")
	runGit(t, dir, "checkout", "-q", "main")
	if _, err := repo.Merge(context.Background(), "other", MergeOptions{}); err == nil {
		t.Fatal("merge should have conflicted")
	}
	return repo, dir
}

func TestConflictReportsALinkAsALink(t *testing.T) {
	repo, dir := linkConflict(t)
	conflict, err := repo.Conflict(context.Background(), "link")
	if err != nil {
		t.Fatal(err)
	}
	if conflict.Kind != "symlink" {
		t.Fatalf("kind = %q, want symlink", conflict.Kind)
	}
	// The link itself is what git stages; its target is not the file's text.
	if conflict.Working != "" {
		t.Fatalf("working = %q, want empty for a link", conflict.Working)
	}
	if conflict.Ours != "b.txt" || conflict.Theirs != "c.txt" {
		t.Fatalf("stages = %q / %q", conflict.Ours, conflict.Theirs)
	}
	if err := repo.SaveResolution(context.Background(), "link", "b.txt", true); err == nil {
		t.Fatal("SaveResolution should refuse a symbolic link")
	}
	fi, err := os.Lstat(filepath.Join(dir, "link"))
	if err != nil || fi.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("link is gone after the refusal: %v %v", fi, err)
	}
	if got := runGit(t, dir, "status", "--porcelain=v2"); !strings.Contains(got, "u UU") {
		t.Fatalf("status = %q, want the path still unmerged", got)
	}
}

func TestConflictReportsTheSurvivingSideOfADeleteModify(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "branch", "other")
	runGit(t, dir, "rm", "-q", "a.txt")
	runGit(t, dir, "commit", "-q", "-m", "delete")
	runGit(t, dir, "checkout", "-q", "other")
	writeFile(t, dir, "a.txt", "one\ntheirs\n")
	runGit(t, dir, "commit", "-q", "-am", "theirs")
	runGit(t, dir, "checkout", "-q", "main")
	if _, err := repo.Merge(context.Background(), "other", MergeOptions{}); err == nil {
		t.Fatal("merge should have conflicted")
	}
	conflict, err := repo.Conflict(context.Background(), "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if conflict.Kind != "file" || conflict.HasOurs || !conflict.HasTheirs {
		t.Fatalf("conflict = %+v", conflict)
	}
	if conflict.Working != "one\ntheirs\n" {
		t.Fatalf("working = %q, want the side that still has the file", conflict.Working)
	}
}

func TestApplyDiffHunkStagesAFileWithoutATrailingNewline(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "n.txt", "one\ntwo")
	runGit(t, dir, "add", "n.txt")
	runGit(t, dir, "commit", "-q", "-m", "no newline")
	writeFile(t, dir, "n.txt", "one\ntwo changed")

	if err := repo.ApplyDiffHunk(context.Background(), DiffOptions{Path: "n.txt", Target: DiffWorkingTree, Context: 3}, 0, "stage"); err != nil {
		t.Fatalf("ApplyDiffHunk: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--", "n.txt")
	if !strings.Contains(staged, "+two changed") || !strings.Contains(staged, `\ No newline at end of file`) {
		t.Fatalf("staged patch lost the marker:\n%s", staged)
	}
}

func TestCleanPathKeepsWhitespaceInAFilename(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "note ", "x\n")
	if err := repo.Stage(context.Background(), []string{"note "}); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	if err := runGitNoOut(dir, "ls-files", "--error-unmatch", "--", "note "); err != nil {
		t.Fatalf("the file with the trailing space was not staged: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "note")); !os.IsNotExist(err) {
		t.Fatalf("a path without the space was touched (err=%v)", err)
	}
	file, err := repo.FileContent(context.Background(), "note ", "")
	if err != nil || file.Text != "x\n" {
		t.Fatalf("FileContent = %q, %v", file.Text, err)
	}
}

func runGitNoOut(dir string, args ...string) error {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = gitEnv()
	_, err := cmd.CombinedOutput()
	return err
}
