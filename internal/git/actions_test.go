package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIgnoreUntracksTrackedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "changed\n")

	if _, err := repo.Ignore(context.Background(), []string{"a.txt"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	if got := runGit(t, dir, "ls-files", "--", "a.txt"); got != "" {
		t.Errorf("tracked files = %q, want none", got)
	}
	if got := runGit(t, dir, "status", "--porcelain", "--", "a.txt"); got != "D  a.txt" {
		t.Errorf("status = %q, want staged deletion", got)
	}
	b, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil || string(b) != "changed\n" {
		t.Errorf("worktree file = %q, %v; want it untouched", b, err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != "/a.txt\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
}

func TestIgnoreUntracksTrackedDirectoryAndKeepsWorktree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "src/a.go", "package a\n")
	writeFile(t, dir, "src/b.go", "package b\n")
	runGit(t, dir, "add", "src")
	runGit(t, dir, "commit", "-q", "-m", "add src")
	writeFile(t, dir, "src/keep.txt", "untracked\n")

	if _, err := repo.Ignore(context.Background(), []string{"src"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	if got := runGit(t, dir, "ls-files", "--", "src"); got != "" {
		t.Errorf("tracked files = %q, want none", got)
	}
	for _, name := range []string{"src/a.go", "src/b.go", "src/keep.txt"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s is missing: %v", name, err)
		}
	}
	status := runGit(t, dir, "status", "--porcelain", "--", "src")
	if !strings.Contains(status, "D  src/a.go") || !strings.Contains(status, "D  src/b.go") {
		t.Errorf("status = %q, want both files staged as deleted", status)
	}
	if got := runGit(t, dir, "status", "--porcelain", "--", "src/keep.txt"); got != "" {
		t.Errorf("untracked file status = %q, want it ignored", got)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != "/src\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
}

func TestIgnoreLeavesUntrackedFileOnDisk(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "new\n")

	if _, err := repo.Ignore(context.Background(), []string{"new.txt"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	if got := runGit(t, dir, "ls-files", "--", "new.txt"); got != "" {
		t.Errorf("tracked files = %q, want none", got)
	}
	if got := runGit(t, dir, "status", "--porcelain", "--", "new.txt"); got != "" {
		t.Errorf("status = %q, want the ignored file to be absent", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "new.txt")); err != nil {
		t.Errorf("new.txt is missing: %v", err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != "/new.txt\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
}

func TestIgnoreEscapesGlobCharacters(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a[1].txt", "one\n")
	runGit(t, dir, "add", "a[1].txt")
	runGit(t, dir, "commit", "-q", "-m", "add bracket file")

	if _, err := repo.Ignore(context.Background(), []string{"a[1].txt"}); err != nil {
		t.Fatalf("Ignore: %v", err)
	}
	ignore, err := os.ReadFile(filepath.Join(dir, ".gitignore"))
	if err != nil || string(ignore) != `/a\[1].txt`+"\n" {
		t.Errorf(".gitignore = %q, %v", ignore, err)
	}
	runGit(t, dir, "check-ignore", "-q", "a[1].txt")
}

func TestCommitOfSelectedPathsLeavesOtherStagedFilesAlone(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nselected\n")
	writeFile(t, dir, "b.txt", "b staged\n")
	runGit(t, dir, "add", "a.txt", "b.txt")

	if _, err := repo.Commit(context.Background(), CommitOptions{Message: "only a", Paths: []string{"a.txt"}}); err != nil {
		t.Fatalf("Commit: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--name-only")
	if strings.TrimSpace(staged) != "b.txt" {
		t.Fatalf("staged after the commit = %q, want b.txt", staged)
	}
	committed := runGit(t, dir, "show", "--name-only", "--format=", "HEAD")
	if strings.TrimSpace(committed) != "a.txt" {
		t.Fatalf("the commit contains %q", committed)
	}
}

func TestDiffOfABracketPathNamesOnlyThatFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a[1].txt", "one\nbracket\n")
	writeFile(t, dir, "a1.txt", "one\nother file\n")
	runGit(t, dir, "add", "a[1].txt", "a1.txt")
	runGit(t, dir, "commit", "-q", "-m", "both")
	writeFile(t, dir, "a[1].txt", "one\nbracket changed\n")

	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a[1].txt", Target: DiffWorkingTree, Context: 3, NoText: true})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if !strings.Contains(d.Patch, "bracket changed") || strings.Contains(d.Patch, "other file") {
		t.Fatalf("the patch of a[1].txt covers the wrong file:\n%s", d.Patch)
	}
}

func TestUnstageClearsBothSidesOfARename(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	if err := repo.Unstage(context.Background(), []string{"b.txt"}); err != nil {
		t.Fatalf("Unstage: %v", err)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-status"); staged != "" {
		t.Fatalf("staged after unstage = %q, want nothing", staged)
	}
	status := runGit(t, dir, "status", "--porcelain")
	if !strings.Contains(status, "D a.txt") || !strings.Contains(status, "?? b.txt") {
		t.Fatalf("status = %q, want the rename back as delete + untracked", status)
	}
}

func TestRollbackRestoresARenameWithoutLeavingACopy(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	if err := repo.Rollback(context.Background(), []string{"b.txt"}); err != nil {
		t.Fatalf("Rollback: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.txt")); err != nil {
		t.Fatalf("a.txt was not restored: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "b.txt")); !os.IsNotExist(err) {
		t.Fatalf("b.txt is still on disk after rollback (err=%v)", err)
	}
	if status := runGit(t, dir, "status", "--porcelain"); status != "" {
		t.Fatalf("status = %q, want clean", status)
	}
}

func TestMarkResolvedRejectsAnEmptySelection(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "new.txt", "new\n")
	if err := repo.MarkResolved(context.Background(), nil); err == nil {
		t.Fatal("MarkResolved accepted an empty selection")
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("the empty selection staged %q", staged)
	}
}

func TestMarkResolvedEscapesThePath(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "star*name.txt", "one\n")
	writeFile(t, dir, "starXname.txt", "one\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-q", "-m", "two files")
	writeFile(t, dir, "star*name.txt", "two\n")
	writeFile(t, dir, "starXname.txt", "two\n")
	if err := repo.MarkResolved(context.Background(), []string{"star*name.txt"}); err != nil {
		t.Fatalf("MarkResolved: %v", err)
	}
	staged := runGit(t, dir, "diff", "--cached", "--name-only")
	if staged != "star*name.txt" {
		t.Fatalf("staged = %q, want only the named path", staged)
	}
}
