package git

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCreateFileMakesParents(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := repo.CreateFile(context.Background(), "src/new/deep.txt"); err != nil {
		t.Fatalf("CreateFile: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "src", "new", "deep.txt")); err != nil {
		t.Fatalf("created file missing: %v", err)
	}
	if err := repo.CreateFile(context.Background(), "src/new/deep.txt"); err == nil {
		t.Fatal("CreateFile overwrote an existing file")
	}
}

func TestCreateDirRejectsExisting(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := repo.CreateDir(context.Background(), "pkg/inner"); err != nil {
		t.Fatalf("CreateDir: %v", err)
	}
	if info, err := os.Stat(filepath.Join(dir, "pkg", "inner")); err != nil || !info.IsDir() {
		t.Fatalf("created directory missing: %v", err)
	}
	if err := repo.CreateDir(context.Background(), "pkg/inner"); err == nil {
		t.Fatal("CreateDir accepted an existing path")
	}
}

func TestRenameTrackedFileStagesRename(t *testing.T) {
	repo, _ := newTestRepo(t)
	if err := repo.RenamePath(context.Background(), "a.txt", "docs/a.txt"); err != nil {
		t.Fatalf("RenamePath: %v", err)
	}
	out := runGit(t, repo.Dir(), "status", "--porcelain=v1")
	if out != "R  a.txt -> docs/a.txt" {
		t.Fatalf("status = %q, want a staged rename", out)
	}
}

func TestRenameUntrackedFileMovesOnly(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "scratch.txt", "x")
	if err := repo.RenamePath(context.Background(), "scratch.txt", "notes/scratch.txt"); err != nil {
		t.Fatalf("RenamePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "notes", "scratch.txt")); err != nil {
		t.Fatalf("renamed file missing: %v", err)
	}
	out := runGit(t, repo.Dir(), "status", "--porcelain=v1")
	if out != "?? notes/" {
		t.Fatalf("status = %q, want one untracked directory", out)
	}
}

func TestDeletePathRemovesTrackedAndStages(t *testing.T) {
	repo, dir := newTestRepo(t)
	if err := repo.DeletePath(context.Background(), "a.txt"); err != nil {
		t.Fatalf("DeletePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.txt")); !os.IsNotExist(err) {
		t.Fatal("tracked file still on disk")
	}
	out := runGit(t, repo.Dir(), "status", "--porcelain=v1")
	if out != "D  a.txt" {
		t.Fatalf("status = %q, want a staged deletion", out)
	}
}

func TestDeletePathRemovesTrackedDirectory(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "pkg/one.txt", "1")
	writeFile(t, dir, "pkg/two.txt", "2")
	runGit(t, dir, "add", "pkg")
	runGit(t, dir, "commit", "-q", "-m", "pkg")
	writeFile(t, dir, "pkg/untracked.txt", "u")
	if err := repo.DeletePath(context.Background(), "pkg"); err != nil {
		t.Fatalf("DeletePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "pkg")); !os.IsNotExist(err) {
		t.Fatal("directory still on disk")
	}
	out := runGit(t, repo.Dir(), "status", "--porcelain=v1")
	if out != "D  pkg/one.txt\nD  pkg/two.txt" {
		t.Fatalf("status = %q, want both tracked files staged as deleted", out)
	}
}

func TestDeletePathRemovesUntrackedTree(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "build/out.js", "x")
	if err := repo.DeletePath(context.Background(), "build"); err != nil {
		t.Fatalf("DeletePath: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "build")); !os.IsNotExist(err) {
		t.Fatal("untracked directory still on disk")
	}
	if out := runGit(t, repo.Dir(), "status", "--porcelain=v1"); out != "" {
		t.Fatalf("status = %q, want a clean tree", out)
	}
}

func TestFileOpsRejectGitDirectory(t *testing.T) {
	repo, _ := newTestRepo(t)
	for name, call := range map[string]func(string) error{
		"CreateFile": func(p string) error { return repo.CreateFile(context.Background(), p) },
		"CreateDir":  func(p string) error { return repo.CreateDir(context.Background(), p) },
		"DeletePath": func(p string) error { return repo.DeletePath(context.Background(), p) },
	} {
		if err := call(".git/config"); err == nil {
			t.Errorf("%s accepted a .git path", name)
		}
	}
}
