package git

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// conflictingFile leaves a.txt unmerged with "main" in stage 2 and "side" in
// stage 3, on a base of "base".
func conflictingFile(t *testing.T) (*Repo, string) {
	t.Helper()
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "base\n")
	runGit(t, dir, "commit", "-qam", "base")

	runGit(t, dir, "switch", "-q", "-c", "side")
	writeFile(t, dir, "a.txt", "side\n")
	runGit(t, dir, "commit", "-qam", "side")

	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "a.txt", "main\n")
	runGit(t, dir, "commit", "-qam", "main")

	if out := runGitFail(t, dir, "merge", "side"); !strings.Contains(out, "CONFLICT") {
		t.Fatalf("merge did not conflict: %s", out)
	}
	return repo, dir
}

func TestMergePreviewMergesTheStagesInMemory(t *testing.T) {
	repo, dir := conflictingFile(t)
	before, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}

	preview, err := repo.MergePreview(context.Background(), MergePreviewRequest{
		Path: "a.txt", Ours: "main", Base: "base", Theirs: "side",
	})
	if err != nil {
		t.Fatalf("MergePreview: %v", err)
	}
	if preview.Conflicts != 1 {
		t.Fatalf("Conflicts = %d, want 1", preview.Conflicts)
	}
	want := "<<<<<<< main\nmain\n||||||| base\nbase\n=======\nside\n>>>>>>> side\n"
	if preview.Content != want {
		t.Fatalf("Content = %q, want %q", preview.Content, want)
	}
	// Computing the merge touches nothing: the file on disk is unchanged.
	after, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("MergePreview changed the working tree")
	}
	if _, err := repo.Status(context.Background(), false); err != nil {
		t.Fatal(err)
	}
}

func TestMergePreviewMergesAModifyDeleteConflict(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "base\n")
	runGit(t, dir, "commit", "-qam", "base")
	runGit(t, dir, "switch", "-q", "-c", "side")
	runGit(t, dir, "rm", "-q", "a.txt")
	runGit(t, dir, "commit", "-q", "-m", "side deletes")
	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "a.txt", "main\n")
	runGit(t, dir, "commit", "-qam", "main changes")
	if out := runGitFail(t, dir, "merge", "side"); !strings.Contains(out, "CONFLICT") {
		t.Fatalf("the merge did not conflict: %s", out)
	}

	preview, err := repo.MergePreview(context.Background(), MergePreviewRequest{Path: "a.txt"})
	if err != nil {
		t.Fatalf("MergePreview: %v", err)
	}
	if preview.HasTheirs {
		t.Fatal("the deleted side has no stage")
	}
	if preview.Conflicts != 1 {
		t.Fatalf("Conflicts = %d, want 1: %q", preview.Conflicts, preview.Content)
	}
	// A missing side is an empty block, not a missing section.
	if !strings.Contains(preview.Content, "=======\n>>>>>>> theirs\n") {
		t.Fatalf("Content = %q", preview.Content)
	}
	if !strings.Contains(preview.Content, "main\n") || !strings.Contains(preview.Content, "base\n") {
		t.Fatalf("Content = %q", preview.Content)
	}
}

func TestResolveInMemoryStagesWithoutTouchingTheFile(t *testing.T) {
	repo, dir := conflictingFile(t)
	const resolved = "resolved\n"

	oid, err := repo.ResolveInMemory(context.Background(), "a.txt", resolved, false)
	if err != nil {
		t.Fatalf("ResolveInMemory: %v", err)
	}
	if oid == "" {
		t.Fatal("no object was written")
	}
	if unmerged := strings.TrimSpace(runGit(t, dir, "ls-files", "-u", "--", "a.txt")); unmerged != "" {
		t.Fatalf("the path is still unmerged:\n%s", unmerged)
	}
	if staged := runGit(t, dir, "show", ":a.txt"); staged != strings.TrimSpace(resolved) {
		t.Fatalf("staged content = %q", staged)
	}
	// The working tree keeps its markers: only the index was resolved.
	onDisk, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(onDisk), "<<<<<<<") {
		t.Fatalf("the working file lost its markers: %q", onDisk)
	}
}

func TestSaveResolutionStagesTheBytesTheEditorHeld(t *testing.T) {
	repo, dir := conflictingFile(t)
	const resolved = "inline\n"

	// The file on disk is left with markers on purpose: saving must stage
	// the text it was given, not what happens to be in the working tree.
	if err := repo.SaveResolution(context.Background(), "a.txt", resolved, true); err != nil {
		t.Fatalf("SaveResolution: %v", err)
	}
	if unmerged := strings.TrimSpace(runGit(t, dir, "ls-files", "-u", "--", "a.txt")); unmerged != "" {
		t.Fatalf("the path is still unmerged:\n%s", unmerged)
	}
	if staged := runGit(t, dir, "show", ":a.txt"); staged != strings.TrimSpace(resolved) {
		t.Fatalf("staged content = %q", staged)
	}
	// The index differs from HEAD (that is the resolution), but the
	// working tree matches the index: the second status column is blank.
	if status := runGit(t, dir, "status", "--porcelain", "--", "a.txt"); strings.TrimSpace(status) != "M  a.txt" {
		t.Fatalf("status = %q, want the file staged and the working tree clean", status)
	}
	text, err := os.ReadFile(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(text) != resolved {
		t.Fatalf("a.txt = %q", text)
	}
}

func TestResolveInMemoryKeepsTheFileMode(t *testing.T) {
	repo, dir := conflictingFile(t)
	runGit(t, dir, "update-index", "--chmod=+x", "a.txt")

	if _, err := repo.ResolveInMemory(context.Background(), "a.txt", "#!/bin/sh\n", true); err != nil {
		t.Fatalf("ResolveInMemory: %v", err)
	}
	mode := strings.Fields(runGit(t, dir, "ls-files", "-s", "--", "a.txt"))[0]
	if mode != "100755" {
		t.Fatalf("mode = %q, want 100755", mode)
	}
	info, err := os.Stat(filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("the written file is not executable: %v", info.Mode())
	}
}

func TestMergePreviewThenResolveHandlesARealConflictSetLikeThePage(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "one.txt", "base\n")
	writeFile(t, dir, "two.txt", "base\n")
	runGit(t, dir, "add", "one.txt", "two.txt")
	runGit(t, dir, "commit", "-q", "-m", "base")

	runGit(t, dir, "switch", "-q", "-c", "side")
	writeFile(t, dir, "one.txt", "side one\n")
	writeFile(t, dir, "two.txt", "side two\n")
	runGit(t, dir, "commit", "-qam", "side")

	runGit(t, dir, "switch", "-q", "main")
	writeFile(t, dir, "one.txt", "main one\n")
	writeFile(t, dir, "two.txt", "main two\n")
	runGit(t, dir, "commit", "-qam", "main")
	if out := runGitFail(t, dir, "merge", "side"); !strings.Contains(out, "CONFLICT") {
		t.Fatalf("merge did not conflict: %s", out)
	}

	// The page asks each conflicted path for its merge, stages what is clean
	// and leaves the rest with markers — the loop in mergeConflictsInMemory.
	conflicted := []string{"one.txt", "two.txt"}
	pending := 0
	for _, path := range conflicted {
		preview, err := repo.MergePreview(context.Background(), MergePreviewRequest{Path: path, Ours: "main"})
		if err != nil {
			t.Fatalf("MergePreview(%s): %v", path, err)
		}
		pending += preview.Conflicts
		if preview.Conflicts == 0 {
			if err := repo.SaveResolution(context.Background(), path, preview.Content, true); err != nil {
				t.Fatalf("SaveResolution(%s): %v", path, err)
			}
			continue
		}
		// Writing the marker form keeps the file unmerged, which is what a
		// partial save does.
		if err := repo.SaveResolution(context.Background(), path, preview.Content, false); err != nil {
			t.Fatalf("SaveResolution(%s): %v", path, err)
		}
	}
	if pending != 2 {
		t.Fatalf("pending = %d, want 2", pending)
	}
	if unmerged := strings.Fields(runGit(t, dir, "diff", "--name-only", "--diff-filter=U")); len(unmerged) != 2 {
		t.Fatalf("unmerged files = %v, want both", unmerged)
	}
	// Resolving both from memory is what lets the merge be committed.
	for _, path := range conflicted {
		if _, err := repo.ResolveInMemory(context.Background(), path, "merged\n", true); err != nil {
			t.Fatalf("ResolveInMemory(%s): %v", path, err)
		}
	}
	if unmerged := strings.TrimSpace(runGit(t, dir, "diff", "--name-only", "--diff-filter=U")); unmerged != "" {
		t.Fatalf("still unmerged: %q", unmerged)
	}
}
