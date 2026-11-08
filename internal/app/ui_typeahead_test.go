package app

import (
	"testing"

	"github.com/egoist/mygo/ui"

	"gitjet/internal/git"
)

func TestFileTypeaheadSelectsAVisiblePath(t *testing.T) {
	c := newCore()
	c.settings.Language = "en"
	a := &nativeApp{
		c: c, ws: &Workspace{c: c}, g: &Git{c: c}, settings: c.settings, lang: langEN,
		checked: map[string]bool{}, equivalent: map[string]bool{}, openDirs: map[string]bool{"src": true},
		sideSplit: 380, sideTab: 2,
	}
	a.repoOpen = true
	a.snapshot = git.ChangesSnapshot{State: git.RepoState{Open: true, Root: "/tmp/x", Name: "x"}}
	a.files = []git.RepoFile{{Path: "README.md"}, {Path: "src/main.ts"}, {Path: "src/util.ts"}}
	a.rebuildFileTree()

	tester := ui.NewTester(a.view, 1200, 800)
	for i := 0; i < 3; i++ {
		tester.Frame()
	}
	tester.Key(0, ui.KeyM)
	tester.Frame()
	if a.fileSel < 0 || a.fileTree[a.fileSel].path != "src/main.ts" {
		t.Fatalf("typeahead selected %d in %v; want src/main.ts", a.fileSel, a.fileTree)
	}
}
