package git

import (
	"context"
	"os"
	"os/exec"
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

func TestCommitUsesStagedVersionOfASelectedPath(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "a.txt", "one\nworktree\n")

	if _, err := repo.Commit(context.Background(), CommitOptions{Message: "staged only", Paths: []string{"a.txt"}}); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if got := runGit(t, dir, "show", "HEAD:a.txt"); got != "one\nstaged" {
		t.Fatalf("HEAD:a.txt = %q, want the staged version", got)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("staged = %q, want the committed path clean", staged)
	}
	if worktree := runGit(t, dir, "diff", "--name-only"); worktree != "a.txt" {
		t.Fatalf("worktree change = %q, want the unstaged edit kept", worktree)
	}
}

func TestCommitRunsPreCommitHook(t *testing.T) {
	repo, dir := newTestRepo(t)
	hook := filepath.Join(dir, ".git", "hooks", "pre-commit")
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "a.txt", "one\nhooked\n")
	before := runGit(t, dir, "rev-parse", "HEAD")
	if _, err := repo.Commit(context.Background(), CommitOptions{Message: "blocked", Paths: []string{"a.txt"}}); err == nil {
		t.Fatal("Commit succeeded although the pre-commit hook exits 1")
	}
	if after := runGit(t, dir, "rev-parse", "HEAD"); after != before {
		t.Fatalf("HEAD moved from %s to %s", before, after)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("the failed commit left %q staged, want nothing", staged)
	}
}

func TestCommitCompletesAMergeWithBothParents(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "checkout", "-q", "-b", "other")
	writeFile(t, dir, "a.txt", "other\n")
	runGit(t, dir, "commit", "-qam", "other")
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "a.txt", "main\n")
	runGit(t, dir, "commit", "-qam", "main")
	cmd := exec.Command("git", "-C", dir, "merge", "other")
	cmd.Env = gitEnv()
	_ = cmd.Run()
	writeFile(t, dir, "a.txt", "resolved\n")
	runGit(t, dir, "add", "a.txt")

	res, err := repo.Commit(context.Background(), CommitOptions{Message: "merge other", Paths: []string{"a.txt"}})
	if err != nil {
		t.Fatalf("Commit during merge: %v", err)
	}
	parents := strings.Fields(runGit(t, dir, "rev-list", "--parents", "-n", "1", res.Hash))
	if len(parents) != 3 {
		t.Fatalf("merge commit has %d parents: %q", len(parents)-1, parents)
	}
	if _, err := os.Stat(filepath.Join(dir, ".git", "MERGE_HEAD")); err == nil {
		t.Fatal("MERGE_HEAD survived the merge commit")
	}
}

func TestCommitAmendKeepsTheOriginalAuthor(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\n")
	cmd := exec.Command("git", "-C", dir, "commit", "-q", "-a", "--author=Other Person <other@example.com>", "-m", "elsewhere")
	cmd.Env = gitEnv()
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("commit: %v %s", err, out)
	}
	writeFile(t, dir, "a.txt", "one\ntwo\nthree\nfour\n")
	if _, err := repo.CommitSelected(context.Background(), CommitOptions{Amend: true, Paths: []string{"a.txt"}}); err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	if got := runGit(t, dir, "log", "-1", "--format=%an <%ae>"); got != "Other Person <other@example.com>" {
		t.Fatalf("author = %q, want the amended commit's author", got)
	}
}

func TestCommitSelectedKeepsFileModesAndEmptyFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "run.sh", "#!/bin/sh\necho hi\n")
	if err := os.Chmod(filepath.Join(dir, "run.sh"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeFile(t, dir, "empty.txt", "")
	if err := os.Symlink("run.sh", filepath.Join(dir, "link")); err != nil {
		t.Skipf("symlink: %v", err)
	}
	if _, err := repo.CommitSelected(context.Background(), CommitOptions{
		Message: "modes", Paths: []string{"run.sh", "empty.txt", "link"},
	}); err != nil {
		t.Fatalf("CommitSelected: %v", err)
	}
	tree := runGit(t, dir, "ls-tree", "-r", "HEAD")
	if !strings.Contains(tree, "100755 blob") || !strings.Contains(tree, "run.sh") {
		t.Fatalf("executable mode lost:\n%s", tree)
	}
	if !strings.Contains(tree, "120000 blob") || !strings.Contains(tree, "link") {
		t.Fatalf("symlink mode lost:\n%s", tree)
	}
	if !strings.Contains(tree, "empty.txt") {
		t.Fatalf("empty file was skipped:\n%s", tree)
	}
}

func TestCommitCompletesARename(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	if _, err := repo.Commit(context.Background(), CommitOptions{Message: "rename", Paths: []string{"b.txt"}}); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if status := runGit(t, dir, "status", "--porcelain"); status != "" {
		t.Fatalf("status after rename commit = %q, want clean", status)
	}
	tree := runGit(t, dir, "ls-tree", "--name-only", "HEAD")
	if tree != "b.txt" {
		t.Fatalf("tree = %q, want only b.txt", tree)
	}
}
