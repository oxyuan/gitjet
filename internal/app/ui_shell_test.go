package app

import (
	"testing"

	"github.com/egoist/mygo/ui"

	"gitjet/internal/git"
)

// The shell builds a frame without a window or a repository call: every
// pane reads state the reload left behind.
func TestNativeShellBuildsAFrame(t *testing.T) {
	c := newCore()
	c.settings.Language = "en"
	a := &nativeApp{
		c:          c,
		ws:         &Workspace{c: c},
		g:          &Git{c: c},
		settings:   c.settings,
		lang:       langEN,
		checked:    map[string]bool{},
		equivalent: map[string]bool{},
		openDirs:   map[string]bool{},
		sideSplit:  380,
	}
	a.repoOpen = true
	a.snapshot = git.ChangesSnapshot{
		State: git.RepoState{Open: true, Root: t.TempDir(), Branch: "main", Changed: 1},
		Changes: []git.Change{
			{Path: "a.go", Index: ".", WorkTree: "M", Kind: "modified", Additions: 2, Deletions: 1},
			{Path: "b.go", Index: "A", WorkTree: ".", Staged: true, Kind: "added"},
		},
		Changelists: git.Changelists{Active: "default", Items: []git.Changelist{{ID: "default", Name: "Default", Default: true}}},
	}
	a.rebuildRows()
	a.log = git.LogResult{
		Head: "main",
		Commits: []git.Commit{
			{Hash: "1111111111111111111111111111111111111111", Short: "1111111", Parents: []string{"2222222222222222222222222222222222222222"}, Subject: "one"},
			{Hash: "2222222222222222222222222222222222222222", Short: "2222222", Subject: "two"},
		},
	}
	a.graph = computeGraph(a.log.Commits)
	tester := ui.NewTester(a.view, 1200, 800)
	for i := 0; i < 3; i++ {
		tester.Frame()
	}
	if _, ok := tester.Find("a.go"); !ok {
		t.Fatal("the commit tool window did not build its rows")
	}
}
