package git

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalHistoryRecordsDistinctContentsAndRestores(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nfirst\n")
	first, added, err := repo.SnapshotLocal("a.txt", "save")
	if err != nil || !added {
		t.Fatalf("SnapshotLocal: %v added=%v", err, added)
	}
	if _, added, err = repo.SnapshotLocal("a.txt", "save"); err != nil || added {
		t.Fatalf("an identical snapshot was added twice: %v", err)
	}
	writeFile(t, dir, "a.txt", "one\nsecond\n")
	if _, added, err = repo.SnapshotLocal("a.txt", "save"); err != nil || !added {
		t.Fatalf("second SnapshotLocal: %v added=%v", err, added)
	}
	entries, err := repo.LocalHistory("a.txt")
	if err != nil {
		t.Fatalf("LocalHistory: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("entries = %d, want 2", len(entries))
	}
	text, err := repo.LocalHistoryContent("a.txt", first.Digest)
	if err != nil || text != "one\nfirst\n" {
		t.Fatalf("content = %q (%v)", text, err)
	}
	if err := repo.RestoreLocalHistory("a.txt", first.Digest); err != nil {
		t.Fatalf("RestoreLocalHistory: %v", err)
	}
	if data, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(data) != "one\nfirst\n" {
		t.Fatalf("a.txt = %q after restore", data)
	}
}

func TestLocalHistoryLabelsAndPrunes(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nzero\n")
	entry, _, err := repo.SnapshotLocal("a.txt", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.LabelLocalHistory("a.txt", entry.Digest, "before the rewrite"); err != nil {
		t.Fatalf("LabelLocalHistory: %v", err)
	}
	entries, _ := repo.LocalHistory("a.txt")
	if len(entries) != 1 || entries[0].Label != "before the rewrite" {
		t.Fatalf("entries = %+v, want the label", entries)
	}
	for i := range historyLimitPerFile + 5 {
		writeFile(t, dir, "a.txt", "one\n"+string(rune('a'+i%26))+"\n"+string(rune('0'+i%10))+"\n")
		if _, _, err := repo.SnapshotLocal("a.txt", ""); err != nil {
			t.Fatal(err)
		}
	}
	entries, _ = repo.LocalHistory("a.txt")
	if len(entries) > historyLimitPerFile {
		t.Fatalf("entries = %d, want at most %d", len(entries), historyLimitPerFile)
	}
}

func TestSnapshotChangedRecordsEveryChangedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nchanged\n")
	writeFile(t, dir, "b.txt", "new\n")
	repo.SnapshotChanged(context.Background(), 10)
	entries, err := repo.LocalHistory("a.txt")
	if err != nil || len(entries) != 1 {
		t.Fatalf("a.txt entries = %+v (%v)", entries, err)
	}
	entries, _ = repo.LocalHistory("b.txt")
	if len(entries) != 1 {
		t.Fatalf("b.txt entries = %+v", entries)
	}
}
