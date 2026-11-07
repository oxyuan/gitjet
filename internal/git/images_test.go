package git

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestImageReadsTheWorkingTreeIndexAndRevisions(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "pic.png", "first-bytes")
	runGit(t, dir, "add", "pic.png")
	runGit(t, dir, "commit", "-q", "-m", "picture")
	writeFile(t, dir, "pic.png", "second-bytes")
	runGit(t, dir, "add", "pic.png")
	writeFile(t, dir, "pic.png", "third-bytes")

	work, err := repo.Image(context.Background(), "pic.png", "")
	if err != nil || work.Mime != "image/png" {
		t.Fatalf("worktree image = %+v (%v)", work, err)
	}
	if decoded, _ := base64.StdEncoding.DecodeString(work.Data); string(decoded) != "third-bytes" {
		t.Fatalf("worktree bytes = %q", decoded)
	}
	staged, err := repo.Image(context.Background(), "pic.png", "INDEX")
	if err != nil {
		t.Fatal(err)
	}
	if decoded, _ := base64.StdEncoding.DecodeString(staged.Data); string(decoded) != "second-bytes" {
		t.Fatalf("index bytes = %q", decoded)
	}
	head, err := repo.Image(context.Background(), "pic.png", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if decoded, _ := base64.StdEncoding.DecodeString(head.Data); string(decoded) != "first-bytes" {
		t.Fatalf("HEAD bytes = %q", decoded)
	}
}

func TestImageRejectsNonImagesAndMissingFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	if _, err := repo.Image(context.Background(), "a.txt", ""); err == nil {
		t.Fatal("Image accepted a text file")
	}
	if _, err := repo.Image(context.Background(), "nope.png", ""); err == nil {
		t.Fatal("Image accepted a missing file")
	}
	if _, err := os.Stat(filepath.Join(dir, "a.txt")); err != nil {
		t.Fatal(err)
	}
}
