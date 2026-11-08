package git

import (
	"context"
	"testing"
)

func TestSignatureSeesContentChangesInsideAChangedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nfirst edit\n")

	before := repo.Signature(context.Background())
	// The second edit keeps the file in the same status state: only its
	// content and mtime move, which the porcelain listing does not show.
	writeFile(t, dir, "a.txt", "one\nsecond edit\n")
	after := repo.Signature(context.Background())
	if before == after {
		t.Fatal("the signature did not change when the file was edited again")
	}
}

func TestSignatureSeesANewFileInsideAnUntrackedDirectory(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "out/one.txt", "1\n")
	before := repo.Signature(context.Background())
	writeFile(t, dir, "out/two.txt", "2\n")
	if after := repo.Signature(context.Background()); before == after {
		t.Fatal("the signature ignored a new file in an untracked directory")
	}
}
