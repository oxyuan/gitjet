package git

import (
	"context"
	"strings"
	"testing"
)

// remoteFixture makes a repository that tracks a bare origin at main.
func remoteFixture(t *testing.T) (*Repo, string, string) {
	t.Helper()
	repo, dir := newTestRepo(t)
	origin := t.TempDir()
	runGit(t, origin, "init", "-q", "--bare", "-b", "main")
	runGit(t, dir, "remote", "add", "origin", origin)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")
	return repo, dir, origin
}

// pushFromAnotherClone adds one commit to main through a second clone.
func pushFromAnotherClone(t *testing.T, origin, name, branch string) string {
	t.Helper()
	other := t.TempDir()
	runGit(t, other, "clone", "-q", origin, ".")
	writeFile(t, other, name, name+"\n")
	runGit(t, other, "add", "-A")
	runGit(t, other, "commit", "-q", "-m", "remote "+name)
	runGit(t, other, "push", "-q", "origin", "HEAD:"+branch)
	return runGit(t, other, "rev-parse", "HEAD")
}

func TestUpdateSelectedFastForwardsAQuietBranch(t *testing.T) {
	repo, dir, origin := remoteFixture(t)
	ctx := context.Background()
	runGit(t, dir, "branch", "topic")
	runGit(t, dir, "push", "-q", "-u", "origin", "topic")
	remote := pushFromAnotherClone(t, origin, "remote.txt", "topic")
	runGit(t, dir, "fetch", "-q", "origin")
	if _, err := repo.UpdateSelected(ctx, "topic"); err != nil {
		t.Fatalf("UpdateSelected: %v", err)
	}
	if tip := runGit(t, dir, "rev-parse", "topic"); tip != remote {
		t.Fatalf("topic = %s, want %s", tip, remote)
	}
}

func TestUpdateSelectedRefusesADivergedBranch(t *testing.T) {
	repo, dir, origin := remoteFixture(t)
	ctx := context.Background()
	runGit(t, dir, "branch", "topic")
	runGit(t, dir, "push", "-q", "-u", "origin", "topic")
	runGit(t, dir, "switch", "-q", "topic")
	writeFile(t, dir, "local.txt", "local\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "local")
	pushFromAnotherClone(t, origin, "remote.txt", "topic")
	runGit(t, dir, "fetch", "-q", "origin")
	if _, err := repo.UpdateSelected(ctx, "topic"); err == nil {
		t.Fatal("UpdateSelected fast-forwarded a diverged branch")
	}
}

func TestResetToRemoteMovesTheBranchToItsUpstream(t *testing.T) {
	repo, dir, origin := remoteFixture(t)
	ctx := context.Background()
	runGit(t, dir, "commit", "-q", "--allow-empty", "-m", "local only")
	remote := pushFromAnotherClone(t, origin, "remote.txt", "main")
	runGit(t, dir, "fetch", "-q", "origin")
	if _, err := repo.ResetToRemote(ctx, "main"); err != nil {
		t.Fatalf("ResetToRemote: %v", err)
	}
	if tip := runGit(t, dir, "rev-parse", "HEAD"); tip != remote {
		t.Fatalf("HEAD = %s, want %s", tip, remote)
	}
}

func TestPushCommitsPublishesOneCommitToARemoteBranch(t *testing.T) {
	repo, dir, origin := remoteFixture(t)
	ctx := context.Background()
	writeFile(t, dir, "picked.txt", "picked\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "picked")
	picked := runGit(t, dir, "rev-parse", "HEAD")
	if _, err := repo.PushCommits(ctx, "origin", "release", picked); err != nil {
		t.Fatalf("PushCommits: %v", err)
	}
	if got := strings.TrimSpace(runGit(t, origin, "rev-parse", "refs/heads/release")); got != picked {
		t.Fatalf("release = %s, want %s", got, picked)
	}
}

func TestPushTagPublishesOneTag(t *testing.T) {
	repo, dir, origin := remoteFixture(t)
	runGit(t, dir, "tag", "v9")
	if _, err := repo.PushTag(context.Background(), "origin", "v9"); err != nil {
		t.Fatalf("PushTag: %v", err)
	}
	if got := strings.TrimSpace(runGit(t, origin, "tag")); got != "v9" {
		t.Fatalf("remote tags = %q", got)
	}
	if _, err := repo.PushTag(context.Background(), "origin", "missing"); err == nil {
		t.Fatal("PushTag accepted an unknown tag")
	}
}

func TestUpstreamOfReadsTheTrackingBranch(t *testing.T) {
	repo, _, _ := remoteFixture(t)
	if got := repo.UpstreamOf(context.Background(), "main"); got != "origin/main" {
		t.Fatalf("upstream = %q, want origin/main", got)
	}
	if got := repo.UpstreamOf(context.Background(), "none"); got != "" {
		t.Fatalf("upstream of a branch without one = %q", got)
	}
}
