package git

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileDiffOfACleanFileHasNoHunks(t *testing.T) {
	repo, dir := newTestRepo(t)
	_ = dir
	d, err := repo.FileDiff(t.Context(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree, Context: 3, NoText: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Hunks) != 0 {
		t.Fatalf("hunks = %d, want 0: %+v", len(d.Hunks), d.Hunks)
	}
}

func TestFileDiffOfAnUntrackedFileIsSynthetic(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "fresh.txt", "brand new\n")

	d, err := repo.FileDiff(t.Context(), DiffOptions{Path: "fresh.txt", Target: DiffWorkingTree, Context: 3, NoText: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Hunks) != 1 || d.Status != "added" {
		t.Fatalf("hunks = %d, status = %q", len(d.Hunks), d.Status)
	}
	if d.Hunks[0].Lines[0].Text != "brand new" {
		t.Fatalf("first line = %q", d.Hunks[0].Lines[0].Text)
	}
}

func TestFileDiffWholeFileKeepsEveryUnchangedLine(t *testing.T) {
	repo, dir := newTestRepo(t)
	var b strings.Builder
	for i := 1; i <= 40; i++ {
		fmt.Fprintf(&b, "line %d\n", i)
	}
	writeFile(t, dir, "long.txt", b.String())
	runGit(t, dir, "add", "long.txt")
	runGit(t, dir, "commit", "-q", "-m", "long")
	writeFile(t, dir, "long.txt", strings.Replace(b.String(), "line 20", "line twenty", 1))

	whole, err := repo.FileDiff(context.Background(), DiffOptions{Path: "long.txt", Target: DiffWorkingTree, Context: -1})
	if err != nil {
		t.Fatal(err)
	}
	if len(whole.Hunks) != 1 {
		t.Fatalf("whole-file diff has %d hunks, want 1", len(whole.Hunks))
	}
	kept := 0
	for _, line := range whole.Hunks[0].Lines {
		if line.Kind == "context" {
			kept++
		}
	}
	if !whole.WholeFile {
		t.Fatal("a diff asked for the whole file should say so")
	}
	if kept != 39 {
		t.Fatalf("context lines = %d, want the 39 unchanged lines", kept)
	}

	narrow, err := repo.FileDiff(context.Background(), DiffOptions{Path: "long.txt", Target: DiffWorkingTree, Context: 0})
	if err != nil {
		t.Fatal(err)
	}
	if narrow.WholeFile {
		t.Fatal("a windowed diff should not claim the whole file")
	}
	narrowContext := 0
	for _, line := range narrow.Hunks[0].Lines {
		if line.Kind == "context" {
			narrowContext++
		}
	}
	if narrowContext != 6 {
		t.Fatalf("default diff kept %d context lines, want 6 (3 either side)", narrowContext)
	}
}

func TestFileDiffHeadCombinesStagedAndUnstagedChanges(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nstaged\n")
	runGit(t, dir, "add", "a.txt")
	writeFile(t, dir, "a.txt", "one\nstaged\nand unstaged\n")
	diff, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a.txt", Target: DiffHead})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if diff.Additions != 2 {
		t.Fatalf("additions = %d, want both changes", diff.Additions)
	}
	if diff.OldLabel != "HEAD" || diff.NewLabel != "Working Tree" {
		t.Fatalf("labels = %q -> %q", diff.OldLabel, diff.NewLabel)
	}
}

func TestFileDiffHeadWithARevisionComparesItWithTheWorkingTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nstashed\n")
	runGit(t, dir, "stash", "push", "-q", "-m", "wip")
	writeFile(t, dir, "a.txt", "one\nworking\n")
	diff, err := repo.FileDiff(context.Background(), DiffOptions{
		Path: "a.txt", Target: DiffHead, Revision: "stash@{0}",
	})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if diff.NewLabel != "Working Tree" || !diff.HasChanges {
		t.Fatalf("diff = %+v", diff)
	}
	if diff.Additions != 1 || diff.Deletions != 1 {
		t.Fatalf("additions/deletions = %d/%d, want 1/1", diff.Additions, diff.Deletions)
	}
}

func TestFileDiffHeadOnABranchWithoutCommits(t *testing.T) {
	repo, dir := newEmptyRepo(t)
	writeFile(t, dir, "a.txt", "one\ntwo\n")
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a.txt", Target: DiffHead})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.Status != "added" || len(d.Hunks) != 1 {
		t.Fatalf("status=%q hunks=%d, want an added file with one hunk", d.Status, len(d.Hunks))
	}
	if d.OldText != "" || d.NewText != "one\ntwo\n" {
		t.Fatalf("old=%q new=%q, want the file as new content", d.OldText, d.NewText)
	}
}

func TestFileDiffOfAStagedRenameKeepsBothSides(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "b.txt", OldPath: "a.txt", Target: DiffStaged})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.Status != "renamed" || d.OldPath != "a.txt" {
		t.Fatalf("status=%q old=%q, want a rename from a.txt", d.Status, d.OldPath)
	}
	if len(d.Hunks) != 0 {
		t.Fatalf("hunks=%d, want contents that only moved", len(d.Hunks))
	}
	if d.OldText != "one\ntwo\n" || d.NewText != "one\ntwo\n" {
		t.Fatalf("old=%q new=%q, want the same content on both sides", d.OldText, d.NewText)
	}
}

func TestFileDiffOfARenameWithEditsShowsBothSides(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	writeFile(t, dir, "b.txt", "one\nTWO\n")
	runGit(t, dir, "add", "b.txt")
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "b.txt", OldPath: "a.txt", Target: DiffStaged})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.Status != "renamed" || len(d.Hunks) != 1 {
		t.Fatalf("status=%q hunks=%d, want one hunk in a rename", d.Status, len(d.Hunks))
	}
	if d.OldText != "one\ntwo\n" || d.NewText != "one\nTWO\n" {
		t.Fatalf("old=%q new=%q, want the old and new file content", d.OldText, d.NewText)
	}
}

func TestApplyDiffHunkUnstagesARenameHunkWithoutRevertingTheRename(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	writeFile(t, dir, "b.txt", "one\nTWO\n")
	runGit(t, dir, "add", "b.txt")
	opts := DiffOptions{Path: "b.txt", OldPath: "a.txt", Target: DiffStaged}
	d, err := repo.FileDiff(context.Background(), opts)
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.Status != "renamed" || len(d.Hunks) != 1 {
		t.Fatalf("status=%q hunks=%d, want one hunk in a rename", d.Status, len(d.Hunks))
	}
	if err := repo.ApplyDiffHunk(context.Background(), opts, 0, "unstage"); err != nil {
		t.Fatalf("ApplyDiffHunk: %v", err)
	}
	if content := runGit(t, dir, "show", ":b.txt"); content != "one\ntwo" {
		t.Fatalf("index content = %q, want the hunk reverted", content)
	}
	if staged := runGit(t, dir, "diff", "--cached", "--name-status"); staged != "R100\ta.txt\tb.txt" {
		t.Fatalf("staged change = %q, want the rename still staged", staged)
	}
}

func TestThreeWayOfAStagedRenameReadsBothPaths(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "mv", "a.txt", "b.txt")
	tw, err := repo.ThreeWay(context.Background(), DiffOptions{Path: "b.txt", OldPath: "a.txt"})
	if err != nil {
		t.Fatalf("ThreeWay: %v", err)
	}
	if tw.Staged.Status != "renamed" || tw.OldPath != "a.txt" {
		t.Fatalf("staged status=%q old=%q, want the rename", tw.Staged.Status, tw.OldPath)
	}
	if tw.Head != "one\ntwo\n" || tw.Index != "one\ntwo\n" || tw.Worktree != "one\ntwo\n" {
		t.Fatalf("head=%q index=%q worktree=%q, want the same content", tw.Head, tw.Index, tw.Worktree)
	}
}

func TestFileDiffOfAnUntrackedSymlinkShowsTheLinkTarget(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := os.Symlink("a.txt", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "link", Target: DiffWorkingTree})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.Status != "added" || !strings.Contains(d.Patch, "new file mode 120000") {
		t.Fatalf("status=%q patch=%q, want a new link", d.Status, d.Patch)
	}
	if d.NewText != "a.txt" {
		t.Fatalf("new text = %q, want the link target", d.NewText)
	}
	if len(d.Hunks) != 1 || len(d.Hunks[0].Lines) != 1 || d.Hunks[0].Lines[0].Text != "a.txt" || !d.Hunks[0].Lines[0].NoNewline {
		t.Fatalf("hunks = %+v, want one target line without a final newline", d.Hunks)
	}
}

func TestFileDiffOfAChangedSymlinkShowsBothTargets(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := os.Symlink("a.txt", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	runGit(t, dir, "add", "link")
	runGit(t, dir, "commit", "-qm", "link")
	if err := os.Remove(filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("b.txt", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "link", Target: DiffWorkingTree})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.OldText != "a.txt" || d.NewText != "b.txt" {
		t.Fatalf("old=%q new=%q, want the two link targets", d.OldText, d.NewText)
	}
	if len(d.Hunks) != 1 {
		t.Fatalf("hunks = %d, want the retargeted link", len(d.Hunks))
	}
}

func TestFileDiffOfAnUntrackedExecutableKeepsItsMode(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "run.sh", "#!/bin/sh\necho hi\n")
	if err := os.Chmod(filepath.Join(dir, "run.sh"), 0o755); err != nil {
		t.Fatal(err)
	}
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "run.sh", Target: DiffWorkingTree})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if !strings.Contains(d.Patch, "new file mode 100755") {
		t.Fatalf("patch = %q, want the executable mode", d.Patch)
	}
}

func TestFileDiffReportsAModeChange(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := os.Chmod(filepath.Join(dir, "a.txt"), 0o755); err != nil {
		t.Fatal(err)
	}
	d, err := repo.FileDiff(context.Background(), DiffOptions{Path: "a.txt", Target: DiffWorkingTree})
	if err != nil {
		t.Fatalf("FileDiff: %v", err)
	}
	if d.OldMode != "100644" || d.NewMode != "100755" {
		t.Fatalf("modes = %q -> %q, want the chmod", d.OldMode, d.NewMode)
	}
	if !d.HasChanges {
		t.Fatal("a mode-only change reports no change")
	}
	if d.OldText != d.NewText {
		t.Fatalf("content changed: %q vs %q", d.OldText, d.NewText)
	}
}
