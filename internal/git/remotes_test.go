package git

import (
	"context"
	"strings"
	"testing"
)

func TestRemotesCanBeAddedRetargetedRenamedAndRemoved(t *testing.T) {
	repo, dir := newTestRepo(t)
	ctx := context.Background()
	if err := repo.RemoteAdd(ctx, "origin", "https://example.com/a.git"); err != nil {
		t.Fatalf("RemoteAdd: %v", err)
	}
	if got := runGit(t, dir, "remote", "get-url", "origin"); got != "https://example.com/a.git" {
		t.Fatalf("url = %q", got)
	}
	if err := repo.RemoteSetURL(ctx, "origin", "ssh://example.com/b.git"); err != nil {
		t.Fatalf("RemoteSetURL: %v", err)
	}
	if got := runGit(t, dir, "remote", "get-url", "origin"); got != "ssh://example.com/b.git" {
		t.Fatalf("url = %q after set-url", got)
	}
	if err := repo.RemoteRename(ctx, "origin", "upstream"); err != nil {
		t.Fatalf("RemoteRename: %v", err)
	}
	if names := runGit(t, dir, "remote"); names != "upstream" {
		t.Fatalf("remotes = %q", names)
	}
	if err := repo.RemoteRemove(ctx, "upstream"); err != nil {
		t.Fatalf("RemoteRemove: %v", err)
	}
	if names := runGit(t, dir, "remote"); names != "" {
		t.Fatalf("remotes = %q after remove", names)
	}
}

func TestRemoteAddRejectsADuplicateNameAndABadURL(t *testing.T) {
	repo, _ := newTestRepo(t)
	ctx := context.Background()
	if err := repo.RemoteAdd(ctx, "origin", "https://example.com/a.git"); err != nil {
		t.Fatal(err)
	}
	if err := repo.RemoteAdd(ctx, "origin", "https://example.com/b.git"); err == nil {
		t.Fatal("RemoteAdd accepted a duplicate name")
	}
	if err := repo.RemoteAdd(ctx, "bad name", "https://example.com/a.git"); err == nil {
		t.Fatal("RemoteAdd accepted a name with a space")
	}
	if err := repo.RemoteAdd(ctx, "x", ""); err == nil || !strings.Contains(err.Error(), "URL") {
		t.Fatalf("RemoteAdd = %v, want a URL error", err)
	}
}

func TestRemoteMutationsRejectAnUnknownRemote(t *testing.T) {
	repo, _ := newTestRepo(t)
	ctx := context.Background()
	if err := repo.RemoteSetURL(ctx, "nope", "https://example.com/a.git"); err == nil {
		t.Fatal("RemoteSetURL accepted an unknown remote")
	}
	if err := repo.RemoteRemove(ctx, "nope"); err == nil {
		t.Fatal("RemoteRemove accepted an unknown remote")
	}
}
