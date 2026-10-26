package git

import "testing"

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
