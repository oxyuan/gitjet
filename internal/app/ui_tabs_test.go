package app

import (
	"testing"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

func testNativeApp(t *testing.T) *nativeApp {
	t.Helper()
	c := newCore()
	c.settings.Language = "en"
	return &nativeApp{
		c:          c,
		ws:         &Workspace{c: c},
		g:          &Git{c: c},
		settings:   c.settings,
		lang:       langEN,
		checked:    map[string]bool{},
		equivalent: map[string]bool{},
		openDirs:   map[string]bool{},
		sideSplit:  380,
		repoOpen:   true,
		snapshot: git.ChangesSnapshot{State: git.RepoState{
			Open: true, Root: t.TempDir(), Branch: "main", Name: "repo",
		}},
	}
}

func TestNativeSourceTabBuildsWithBlame(t *testing.T) {
	a := testNativeApp(t)
	tab := &docTab{kind: tabSource, id: "file::a.go", title: "a.go", path: "a.go"}
	tab.file = git.SourceFile{Path: "a.go", Exists: true, Text: "package a\n\nfunc main() {}\n"}
	tab.src = a.newSourceState(tab)
	tab.blame = []git.BlameLine{
		{Line: 1, Author: "Ada", Short: "abc1234", Summary: "init"},
		{Line: 2, Author: "Ada", Short: "abc1234", Summary: "init"},
		{Line: 3, Author: "Ada", Short: "abc1234", Summary: "init"},
	}
	a.tabs = []*docTab{tab}
	tester := ui.NewTester(a.view, 1100, 700)
	for i := 0; i < 3; i++ {
		tester.Frame()
	}
	if _, ok := tester.Find("a.go"); !ok {
		t.Fatal("the source editor did not build")
	}
}

func TestNativeDiffTabBuilds(t *testing.T) {
	a := testNativeApp(t)
	old := editor.NewBuffer("package a\n\nfunc main() {\n\tprintln(\"one\")\n}\n")
	newer := editor.NewBuffer("package a\n\nfunc main() {\n\tprintln(\"two\")\n}\n")
	lang := editor.LanguageFor("a.go")
	old.SetLanguage(lang)
	newer.SetLanguage(lang)
	tab := &docTab{
		kind:   tabDiff,
		id:     "diff:worktree::a.go",
		title:  "a.go",
		path:   "a.go",
		opts:   git.DiffOptions{Path: "a.go", Target: git.DiffWorkingTree, Context: -1},
		loaded: true,
		diff:   &editor.DiffState{Old: old, New: newer},
	}
	a.tabs = []*docTab{tab}
	tester := ui.NewTester(a.view, 1100, 700)
	for i := 0; i < 3; i++ {
		tester.Frame()
	}
	if _, ok := tester.Find("a.go"); !ok {
		t.Fatal("the diff viewer did not build")
	}
}
