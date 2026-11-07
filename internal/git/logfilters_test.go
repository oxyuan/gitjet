package git

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestLogFollowTracksARenamedFile(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "a.txt", "one\nchanged\n")
	runGit(t, dir, "commit", "-q", "-am", "change a")
	runGit(t, dir, "mv", "a.txt", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "rename")
	ctx := context.Background()
	plain, err := repo.Log(ctx, LogOptions{Path: "b.txt", Limit: 10})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	followed, err := repo.Log(ctx, LogOptions{Path: "b.txt", Follow: true, Limit: 10})
	if err != nil {
		t.Fatalf("Log --follow: %v", err)
	}
	if len(plain.Commits) != 1 {
		t.Fatalf("plain log has %d commits, want only the rename", len(plain.Commits))
	}
	subjects := []string{}
	for _, c := range followed.Commits {
		subjects = append(subjects, c.Subject)
	}
	if len(followed.Commits) < 2 || !strings.Contains(strings.Join(subjects, ","), "change a") {
		t.Fatalf("followed log = %v, want the pre-rename change too", subjects)
	}
}

func TestLogFiltersByDateAndCaseSensitiveRegex(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "x.txt", "x\n")
	runGit(t, dir, "add", "x.txt")
	runGit(t, dir, "commit", "-q", "-m", "Fix the Bug")
	ctx := context.Background()
	base := time.Now().Add(-time.Hour).Unix()
	later := time.Now().Add(time.Hour).Unix()
	result, err := repo.Log(ctx, LogOptions{Search: "fix|bug", Regex: true, Limit: 10})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(result.Commits) != 1 {
		t.Fatalf("insensitive regex found %d commits, want 1", len(result.Commits))
	}
	result, err = repo.Log(ctx, LogOptions{Search: "fix|bug", Regex: true, CaseSensitive: true, Limit: 10})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(result.Commits) != 0 {
		t.Fatalf("case-sensitive regex found %d commits, want 0", len(result.Commits))
	}
	result, err = repo.Log(ctx, LogOptions{Since: base, Until: later, Limit: 10})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(result.Commits) != 2 {
		t.Fatalf("date range found %d commits, want both", len(result.Commits))
	}
	result, err = repo.Log(ctx, LogOptions{Until: base, Limit: 10})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(result.Commits) != 0 {
		t.Fatalf("past-only range found %d commits, want 0", len(result.Commits))
	}
}

func TestShowCommitListsTagsContainingIt(t *testing.T) {
	repo, dir := newTestRepo(t)
	runGit(t, dir, "tag", "v1")
	runGit(t, dir, "tag", "later")
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "second")
	head := runGit(t, dir, "rev-parse", "HEAD")
	detail, err := repo.ShowCommit(context.Background(), head)
	if err != nil {
		t.Fatalf("ShowCommit: %v", err)
	}
	if len(detail.Tags) != 0 {
		t.Fatalf("tags of the tip = %v, want none", detail.Tags)
	}
	first := runGit(t, dir, "rev-parse", "HEAD~1")
	detail, err = repo.ShowCommit(context.Background(), first)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(detail.Tags, ",") != "later,v1" {
		t.Fatalf("tags = %v, want later and v1", detail.Tags)
	}
}
