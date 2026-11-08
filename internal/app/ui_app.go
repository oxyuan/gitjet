package app

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

// The native UI: one window drawn by MyGo from Go, with no web page. The
// services in service.go stay the only place that runs git; this layer owns
// what the window shows and calls them.

// tabKind is what an editor tab shows.
type tabKind uint8

const (
	tabDiff tabKind = iota
	tabSource
	tabRevisionTree
	tabCommit
)

// docTab is one editor tab: a diff, a source file, or the files of a
// revision.
type docTab struct {
	kind     tabKind
	id       string
	title    string
	path     string
	revision string
	from     string
	gotoLine int
	opts     git.DiffOptions
	status   string

	// diff
	diff        *editor.DiffState
	loaded      bool
	err         string
	selStart    int
	selEnd      int
	selSide     editor.DiffSide
	hasSel      bool
	blameOld    []git.BlameLine
	blameNew    []git.BlameLine
	diffBlameOn bool
	wrapOn      bool

	// source
	src         *editor.State
	file        git.SourceFile
	base        *editor.Buffer
	blame       []git.BlameLine
	blameOn     bool
	blameIgnore bool
	image       ui.ImageSource
	imageOld    ui.ImageSource
	imageNew    ui.ImageSource
	imageMode   int
	imageAlpha  float64
	imageMime   string
	binary      bool
	missing     bool
	truncated   bool
	fileSize    int64
	history     []git.LocalHistoryEntry
	readOnly    bool
	saveErr     string
	lastSaved   uint64
	sourceLang  string

	// revision tree
	files []git.RepoFile

	// commit
	commit git.CommitDetail
}

// nativeApp is the state the window shows. Everything in it is read and
// written on the main thread; work that may block runs on a goroutine and
// posts its result back with mygo.RunOnMain.
type nativeApp struct {
	win *mygo.Window
	c   *core
	ws  *Workspace
	g   *Git

	lang      lang
	settings  Settings
	startup   string
	secondary bool

	repoOpen    bool
	loading     bool
	errText     string
	busy        int
	notice      string
	noticeError bool
	noticeSeq   int
	redraws     uint64

	snapshot   git.ChangesSnapshot
	refs       git.RefsSnapshot
	remotes    []git.Remote
	shelves    []git.Shelf
	lfs        git.LFSStatus
	worktrees  []git.Worktree
	submodules []git.Submodule
	recent     []RecentRepo

	// sidebar
	sideTab           int
	sideSplit         float32
	changes           []changeRow
	changeSel         int
	changeClosed      map[string]bool
	changeView        string
	changePicked      map[string]bool
	changeAnchor      int
	checked           map[string]bool
	checkedInit       bool
	commitForm        commitForm
	commitComp        []string
	commitCompStart   int
	commitCompEnd     int
	commitCaret       int
	focusCommit       int
	history           []string
	showStaged        bool
	showCommitOptions bool

	files       []git.RepoFile
	fileTree    []fileRow
	fileList    ui.ListState
	fileSel     int
	fileFilter  string
	fileTypeBuf string
	fileTypeAt  time.Time

	branches     []repoRefRow
	branchList   ui.ListState
	branchSel    int
	branchSearch string
	branchClosed map[string]bool
	recentBr     []string
	tags         []repoRefRow

	log              git.LogResult
	logList          ui.ListState
	logPick          ui.Selection[string]
	logSel           int
	logOpts          git.LogOptions
	logSearch        string
	logAll           bool
	logDirty         bool
	logFilterGen     int
	logFold          bool
	editorSplit      float32
	logSplit         float32
	logDetail        *git.CommitDetail
	logDetailHash    string
	logDetailLoading bool
	logAuthor        string
	logRegex         bool
	logCase          bool
	equivalent       map[string]bool
	openDirs         map[string]bool
	journal          []JournalEntry
	graph            []graphRow
	repoTab          int
	systemDark       bool
	systemKnown      bool
	appliedTheme     string
	appliedScale     int
	theme            *ui.Theme

	// editor
	tabs      []*docTab
	activeTab int

	// quick open
	quickOpen    bool
	quickQuery   string
	quickSel     int
	quickFiles   []git.RepoFile
	quickCommits []git.Commit
	quickIndex   []quickHit
	quickReq     int
	quickLoading bool

	// dialog footer, captured by buttons() while its body builds.
	dialogOK string
	dialogFn func()

	// console
	consoleOpen    bool
	consoleTab     int
	consoleLog     []string
	consoleIn      string
	consoleProgram string
	fetchPrune     bool
	fetchTags      bool
	consoleHis     []string
	consoleComp    []git.Completion

	dialog dialogState

	lsp         *lspClient
	lspStarting bool

	reloadGen     atomic.Uint64
	reloading     atomic.Bool
	reloadPending atomic.Bool
}

// changeRow is one row of the commit tool window: a path on one side.
type changeRow struct {
	change git.Change
	staged bool
}

// repoRefRow is a branch or tag shown in a list.
type repoRefRow struct {
	ref   git.RepoRef
	group string
}

// fileRow is a flattened row of the working-tree file list.
type fileRow struct {
	path  string
	name  string
	depth int
	dir   bool
	open  bool
}

// commitForm is the commit message and its options.
type commitForm struct {
	Message      string
	Amend        bool
	SignOff      bool
	NoVerify     bool
	AllowEmpty   bool
	Sign         bool
	AuthorName   string
	AuthorEmail  string
	SelectedOnly bool
	PushAfter    bool
	RebaseAfter  bool
}

// quickHit is a file or commit in the quick-open list.
type quickHit struct {
	title, detail, path, revision string
	commit                        bool
}

// Run starts GitJet with its native window.
func Run() error {
	mygo.App.SetName("GitJet")
	mygo.App.SetLanguages("en", "zh-Hans")
	a := newNativeApp()
	if len(os.Args) > 1 {
		if st, err := os.Stat(os.Args[1]); err == nil && st.IsDir() {
			a.startup = os.Args[1]
			a.secondary = true
		}
	}
	dispatchNative = a.command
	mygo.App.OnOpenFile(func(path string) {
		if st, err := os.Stat(path); err == nil {
			if !st.IsDir() {
				path = filepath.Dir(path)
			}
			a.openPath(path)
		}
	})
	mygo.App.WhenReady(a.ready)
	mygo.App.OnWindowAllClosed(func() { a.win = nil })
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows && a.win == nil {
			a.openWindow()
		}
	})
	return mygo.App.Run()
}

func newNativeApp() *nativeApp {
	c := newCore()
	a := &nativeApp{
		c:          c,
		ws:         &Workspace{c: c},
		g:          &Git{c: c},
		settings:   c.settings,
		lang:       resolveLang(c.settings.Language),
		checked:    map[string]bool{},
		showStaged: false,
		sideSplit:  356,
		equivalent: map[string]bool{},
		openDirs:   map[string]bool{},
		logOpts: git.LogOptions{
			Limit: 300,
		},
		logSel:         -1,
		logDirty:       true,
		logAll:         true,
		consoleProgram: "git",
		fetchPrune:     true,
		fetchTags:      true,
		editorSplit:    650,
		logSplit:       900,
		changeSel:      -1,
		changeClosed:   map[string]bool{},
		changeView:     "flat",
		fileSel:        -1,
		branchSel:      -1,
		branchClosed:   map[string]bool{},
	}
	a.commitForm.Message = strings.TrimSpace(c.settings.CommitTemplate)
	c.onChange = func() { mygo.RunOnMain(a.changed) }
	c.stream = func(line string) { mygo.RunOnMain(func() { a.appendConsole(line) }) }
	return a
}

func (a *nativeApp) ready() {
	applyMenu(a.settings.Language)
	a.openWindow()
	path := a.startup
	if path == "" {
		if recent := a.ws.Recent(); len(recent) > 0 {
			if st, err := os.Stat(recent[0].Path); err == nil && st.IsDir() {
				path = recent[0].Path
			}
		}
	}
	if path != "" {
		a.openPath(path)
	} else {
		a.loadRecent()
	}

}

func (a *nativeApp) openWindow() {
	stateKey := "main"
	if a.secondary {
		stateKey = "main-2"
	}
	a.win = mygo.NewWindow(mygo.WindowOptions{
		Title:                "GitJet",
		Width:                1440,
		Height:               900,
		MinWidth:             900,
		MinHeight:            560,
		TitleBarStyle:        mygo.TitleBarHidden,
		TitleBarHeight:       52,
		TrafficLightPosition: &mygo.Point{X: 20, Y: 19},
		BackgroundColor:      "light-dark(#f5f5f7, #1c1d21)",
		StateKey:             stateKey,
		Content:              ui.View(a.view),
	})
	a.win.OnClosed(func() { a.win = nil })
	a.win.Focus()
}

// view builds one frame of the window.
func (a *nativeApp) view(c *ui.Context) {
	a.applyAppearance(c)
	if a.theme == nil {
		a.theme = gitjetTheme(a.systemDark)
	}
	ui.Themed(c, a.theme).Fill().Children(func() {
		a.viewBody(c)
	})
}

func (a *nativeApp) viewBody(c *ui.Context) {
	c.OnWindowShortcut(ui.Cmd|ui.Shift, ui.KeyB, a.findReferences)
	c.OnWindowShortcut(ui.Shift, ui.KeyF12, a.findReferences)
	c.OnWindowShortcut(ui.Cmd, ui.KeyS, func() {
		if a.activeTab >= 0 && a.activeTab < len(a.tabs) {
			tab := a.tabs[a.activeTab]
			if tab.kind == tabSource && tab.revision == "" {
				a.saveSource(tab)
			}
		}
	})
	c.OnWindowShortcut(ui.Cmd, ui.KeyEnter, func() {
		if a.repoOpen && !a.dialogOpen() {
			a.commitForm.PushAfter = false
			a.commitForm.RebaseAfter = false
			a.requestCommit()
		}
	})
	c.OnWindowShortcut(ui.Ctrl, ui.KeyEnter, func() {
		if a.repoOpen && !a.dialogOpen() {
			a.commitForm.PushAfter = false
			a.commitForm.RebaseAfter = false
			a.requestCommit()
		}
	})
	c.OnWindowShortcut(ui.Ctrl, ui.KeySpace, func() {
		if a.repoOpen && !a.dialogOpen() && a.focusCommit == 0 {
			a.openCommitCompletion(rune(a.commitCaret))
		}
	})
	a.registerFileTypeahead(c)
	a.mainView(c)
	a.dialogView(c)
	a.noticeView(c)
}

func (a *nativeApp) noticeView(c *ui.Context) {
	if a.notice == "" {
		return
	}
	p := palette(c.Theme())
	tint := ui.Hex(p.accent)
	icon := "check"
	if a.noticeError {
		tint = ui.Hex(p.danger)
		icon = "warning"
	}
	card := ui.Column(c).Absolute().Bottom(38).Right(12).Width(340).Padding(10, 12).Radius(12).
		Background(ui.Hex(p.raised)).Border(1, ui.Hex(p.border)).
		Shadow(0, 18, 48, 0, ui.RGBA(16, 20, 40, 0.18))
	card.Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Box(c).Size(22, 22).Radius(7).Background(tint.Alpha(0.12)).Center().Children(func() {
				ui.Row(c).TextColor(tint).Center().Children(func() {
					a.icon(c, icon, 13)
				})
			})
			ui.Text(c, a.notice).FontSize(11.5).TextColor(ui.Hex(p.fgSoft)).Grow(1).MaxLines(4)
			if _, clicked := a.kitIconButton(c, "close", a.t("Close"), 22, 12, false, false, false); clicked {
				a.notice = ""
			}
		})
	})
}

func (a *nativeApp) applyAppearance(c *ui.Context) {
	if !a.systemKnown {
		a.systemDark = c.Theme().Dark
		a.systemKnown = true
	}
	s := a.settings
	if a.appliedTheme != s.Theme || !a.systemKnown {
		a.appliedTheme = s.Theme
		dark := a.systemDark
		switch s.Theme {
		case "light":
			dark = false
		case "dark":
			dark = true
		}
		a.theme = gitjetTheme(dark)
	}
	if s.UIScale > 0 && a.appliedScale != s.UIScale {
		a.appliedScale = s.UIScale
		c.SetZoom(float32(s.UIScale) / 100)
	}
}

func (a *nativeApp) redraw() {
	if a.win != nil {
		a.win.Invalidate()
	}
}

func (a *nativeApp) t(key string) string {
	return a.lang.tr(key)
}

func (a *nativeApp) fail(err error) {
	if err == nil {
		return
	}
	a.errText = err.Error()
	a.setNotice(err.Error())
	a.noticeError = true
	a.redraw()
}

func (a *nativeApp) clearNotice() {
	a.notice = ""
	a.errText = ""
}

func (a *nativeApp) setNotice(s string) {
	a.notice = s
	a.noticeError = false
	a.noticeSeq++
	seq := a.noticeSeq
	time.AfterFunc(4*time.Second, func() {
		mygo.RunOnMain(func() {
			if seq == a.noticeSeq {
				a.notice = ""
			}
		})
	})
	a.redraw()
}

// busyRun runs fn off the main thread and reloads the view afterwards.
func (a *nativeApp) busyRun(label string, fn func() error) {
	a.busy++
	a.redraw()
	go func() {
		err := fn()
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
			}
			a.refresh()
		})
	}()
}

func (a *nativeApp) changed() {
	a.logDirty = true
	a.refresh()
}

// loadRecent reads the recent repository list.
func (a *nativeApp) loadRecent() {
	a.recent = a.ws.Recent()
	a.redraw()
}

func (a *nativeApp) openPath(path string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	a.loading = true
	a.errText = ""
	a.reloadGen.Add(1)
	a.reloading.Store(false)
	a.reloadPending.Store(false)
	if a.repoOpen {
		closeMergeWindows()
		_ = a.g.LSPStop()
		a.ws.Close()
		a.lsp = nil
		a.lspStarting = false
		a.tabs = nil
		a.activeTab = 0
		a.snapshot = git.ChangesSnapshot{}
		a.log = git.LogResult{}
		a.graph = nil
		a.logOpts = git.LogOptions{Limit: 300}
		a.logAll = false
		a.logDirty = true
		a.sideTab = 0
		a.checked = map[string]bool{}
		a.checkedInit = false
		a.logPick.Clear()
		a.equivalent = map[string]bool{}
		a.openDirs = map[string]bool{}
		a.fileFilter = ""
	}
	a.repoOpen = false
	a.redraw()
	go func() {
		snap, err := a.ws.Open(path)
		mygo.RunOnMain(func() {
			a.loading = false
			if err != nil {
				a.fail(err)
				a.repoOpen = false
				return
			}
			a.repoOpen = true
			a.consoleHis = append([]string(nil), a.c.meta.ConsoleHistory...)
			if a.c.meta.ConsoleProgram != "" {
				a.consoleProgram = a.c.meta.ConsoleProgram
			}
			a.lsp = nil
			a.lspStarting = false
			a.snapshot = snap
			a.logDirty = true
			a.commitForm.Message = strings.TrimSpace(a.settings.CommitTemplate)
			a.pickInitialChange()
			a.loadRecent()
			a.refresh()
			a.applyWindowTitle()
			a.ensureLSP()
		})
	}()
}

func (a *nativeApp) closeRepo() {
	closeMergeWindows()
	a.reloadGen.Add(1)
	a.reloading.Store(false)
	a.reloadPending.Store(false)
	_ = a.g.LSPStop()
	a.lsp = nil
	a.lspStarting = false
	a.ws.Close()
	a.repoOpen = false
	a.tabs = nil
	a.activeTab = 0
	a.snapshot = git.ChangesSnapshot{}
	a.refs = git.RefsSnapshot{}
	a.log = git.LogResult{}
	a.changeSel = -1
	a.loadRecent()
	a.applyWindowTitle()
	a.redraw()
}

func (a *nativeApp) applyWindowTitle() {
	if a.win == nil {
		return
	}
	if !a.repoOpen {
		a.win.SetTitle("GitJet")
		return
	}
	name := a.snapshot.State.Name
	if name == "" {
		name = filepath.Base(a.snapshot.State.Root)
	}
	a.win.SetTitle("GitJet — " + name)
}

// refresh reloads the repository state and the lists built from it.
func (a *nativeApp) refresh() {
	if !a.repoOpen {
		return
	}
	if a.reloading.Swap(true) {
		a.reloadPending.Store(true)
		return
	}
	a.reloadPending.Store(false)
	gen := a.reloadGen.Add(1)
	opts := a.logOpts
	opts.All = a.logAll
	loadLog := a.logDirty || len(a.log.Commits) == 0
	go func() {
		snap, err := a.g.Refresh()
		if err != nil {
			mygo.RunOnMain(func() {
				a.reloading.Store(false)
				a.fail(err)
				if a.reloadPending.Swap(false) {
					a.refresh()
				}
			})
			return
		}
		refs, refsErr := a.g.Refs()
		remotes, _ := a.g.Remotes()
		shelves, _ := a.g.Shelves()
		lfs, _ := a.g.LFS()
		worktrees, _ := a.g.Worktrees()
		submodules, _ := a.g.Submodules()
		var logRes git.LogResult
		var logErr error
		if loadLog {
			logRes, logErr = a.g.Log(opts)
		}
		files, _ := a.g.Files("")
		recentBranches := a.g.RecentBranches()
		journal, _ := a.g.Journal(300)
		mygo.RunOnMain(func() {
			if gen != a.reloadGen.Load() {
				a.reloading.Store(false)
				if a.reloadPending.Swap(false) {
					a.refresh()
				}
				return
			}
			if refsErr != nil {
				a.fail(refsErr)
			}
			a.snapshot = snap
			a.refs = refs
			a.remotes = remotes
			a.shelves = shelves
			a.lfs = lfs
			a.worktrees = worktrees
			a.submodules = submodules
			if len(files) > 0 {
				a.files = files
			}
			a.recentBr = recentBranches
			if len(journal) > 0 {
				a.journal = journal
			}
			if loadLog {
				a.logDirty = false
				if logErr == nil {
					a.log = logRes
					a.graph = computeGraph(logRes.Commits)
					if a.logSel >= len(a.log.Commits) {
						a.logSel = len(a.log.Commits) - 1
					}
				} else {
					a.fail(logErr)
				}
			}
			a.rebuildRows()
			a.applyWindowTitle()
			a.redraw()
			a.reloading.Store(false)
			if a.reloadPending.Swap(false) {
				a.refresh()
			}
		})
	}()
}

func (a *nativeApp) rebuildRows() {
	a.changes = a.changes[:0]
	if a.showStaged {
		for _, ch := range a.snapshot.Changes {
			if ch.Staged {
				a.changes = append(a.changes, changeRow{change: ch, staged: true})
			}
		}
	}
	for _, ch := range a.snapshot.Changes {
		if !ch.Staged {
			a.changes = append(a.changes, changeRow{change: ch, staged: false})
		}
	}
	sort.SliceStable(a.changes, func(i, j int) bool {
		if a.changes[i].staged != a.changes[j].staged {
			return a.changes[i].staged
		}
		return a.changes[i].change.Path < a.changes[j].change.Path
	})
	if a.changeSel >= len(a.changes) {
		a.changeSel = len(a.changes) - 1
	}
	if !a.checkedInit {
		for _, row := range a.changes {
			if row.change.Unmerged || row.change.Kind == "ignored" {
				continue
			}
			key := row.change.Path
			if row.staged {
				key = "staged:" + key
			}
			a.checked[key] = true
		}
		a.checkedInit = true
	}
	a.rebuildFiles()
	a.rebuildBranches()
}

func (a *nativeApp) pickInitialChange() {
	a.changeSel = -1
	for i, ch := range a.snapshot.Changes {
		if ch.Unmerged {
			a.changeSel = i
			return
		}
	}
}

func (a *nativeApp) rebuildFiles() {
	if len(a.files) == 0 {
		seen := map[string]bool{}
		for _, ch := range a.snapshot.Changes {
			if !seen[ch.Path] {
				seen[ch.Path] = true
				a.files = append(a.files, git.RepoFile{Path: ch.Path, Tracked: ch.Kind != "untracked"})
			}
		}
	}
	a.fileTree = flattenFiles(a.files, a.openDirs)
	if a.fileFilter != "" || len(a.fileTree) == 0 {
		a.rebuildFileTree()
	}
}

type fileNode struct {
	name     string
	path     string
	dir      bool
	children []*fileNode
}

// flattenFiles builds the rows the file tree shows: folders before files,
// in name order, and only the children of folders that are open.
func flattenFiles(files []git.RepoFile, openDirs map[string]bool) []fileRow {
	root := &fileNode{}
	dirs := map[string]*fileNode{"": root}
	for _, f := range files {
		parts := strings.Split(strings.Trim(f.Path, "/"), "/")
		cur := root
		path := ""
		for i, part := range parts {
			if part == "" {
				continue
			}
			if path == "" {
				path = part
			} else {
				path += "/" + part
			}
			last := i == len(parts)-1
			next := dirs[path]
			if next == nil {
				next = &fileNode{name: part, path: path, dir: !last}
				dirs[path] = next
				cur.children = append(cur.children, next)
			}
			cur = next
		}
	}
	var out []fileRow
	var walk func(n *fileNode, depth int)
	walk = func(n *fileNode, depth int) {
		sort.SliceStable(n.children, func(i, j int) bool {
			if n.children[i].dir != n.children[j].dir {
				return n.children[i].dir
			}
			return n.children[i].name < n.children[j].name
		})
		for _, ch := range n.children {
			out = append(out, fileRow{path: ch.path, name: ch.name, depth: depth, dir: ch.dir, open: openDirs[ch.path]})
			if ch.dir && openDirs[ch.path] {
				walk(ch, depth+1)
			}
		}
	}
	walk(root, 0)
	return out
}

func (a *nativeApp) rebuildBranches() {
	order := map[string]int{}
	for i, name := range a.recentBr {
		order[name] = i
	}
	local := append([]git.RepoRef(nil), a.refs.Local...)
	sort.SliceStable(local, func(i, j int) bool {
		ri, iok := order[local[i].Name]
		rj, jok := order[local[j].Name]
		if iok != jok {
			return iok
		}
		if iok && jok {
			return ri < rj
		}
		return local[i].Name < local[j].Name
	})
	a.branches = a.branches[:0]
	for _, ref := range local {
		a.branches = append(a.branches, repoRefRow{ref: ref, group: "local"})
	}
	for _, ref := range a.refs.Remote {
		a.branches = append(a.branches, repoRefRow{ref: ref, group: "remote"})
	}
	a.tags = a.tags[:0]
	for _, ref := range a.refs.Tags {
		a.tags = append(a.tags, repoRefRow{ref: ref, group: "tag"})
	}
	if a.branchSel >= len(a.branches) {
		a.branchSel = -1
	}
}

// command runs a menu command.
func (a *nativeApp) command(cmd string) {
	switch {
	case cmd == "open":
		a.chooseAndOpen()
	case cmd == "clone":
		a.openCloneDialog()
	case cmd == "init":
		a.openInitDialog()
	case cmd == "refresh":
		a.refresh()
	case cmd == "settings":
		a.openSettingsDialog()
	case cmd == "close":
		dirty := false
		for _, tab := range a.tabs {
			if tab.dirty() {
				dirty = true
				break
			}
		}
		if dirty {
			a.dialog = dialogState{kind: dialogConfirm, title: a.t("Unsaved changes"), message: a.t("Close the repository without saving?"), action: "close-repo"}
			return
		}
		a.closeRepo()
	case cmd == "new-window":
		if a.repoOpen {
			_ = a.ws.OpenInWindow(a.repoRoot())
		}
	case cmd == "closetab":
		a.closeActiveTab()
	case cmd == "quickopen":
		a.openQuickOpen()
	case cmd == "commit":
		a.sideTab = 0
		a.focusCommit++
	case cmd == "commit-now":
		a.requestCommit()
	case cmd == "fetch":
		a.fetch()
	case cmd == "pull":
		a.openPullDialog()
	case cmd == "push":
		a.openPushDialog()
	case cmd == "branches":
		a.sideTab = 1
	case cmd == "stash":
		a.openStashDialog()
	case cmd == "repo-tools":
		a.openRepoToolsDialog()
	case cmd == "remotes":
		a.openRemotesDialog()
	case cmd == "cleanup-branches":
		a.openCleanupDialog()
	case cmd == "resolve-conflicts":
		a.openConflictSummary()
	case cmd == "browse-revision":
		a.openBrowseRevisionDialog()
	case cmd == "compare":
		a.openCompare("", a.snapshot.State.Branch)
	case cmd == "patches":
		a.openPatchDialog()
	case cmd == "shelves":
		a.openShelfDialog()
	case cmd == "journal":
		a.openJournalDialog()
	case cmd == "worktrees":
		a.openRepoToolsDialog()
		a.repoTab = 0
	case cmd == "submodules":
		a.openRepoToolsDialog()
		a.repoTab = 1
	case cmd == "lfs":
		a.openLFSDialog()
	case strings.HasPrefix(cmd, "tab:"):
		switch strings.TrimPrefix(cmd, "tab:") {
		case "commit":
			a.sideTab = 0
		case "branch":
			a.sideTab = 1
		case "files":
			a.sideTab = 2
		case "log":
			a.logFold = false
			if a.editorSplit < 360 {
				a.editorSplit = 360
			}
		case "console":
			a.sideTab = 4
			a.consoleOpen = true
		}
	}
	a.redraw()
}

func (a *nativeApp) chooseAndOpen() {
	l := a.lang
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      a.win,
		Title:       l.tr("dialog.openRepo"),
		ButtonLabel: l.tr("dialog.openRepoButton"),
		Message:     l.tr("dialog.openRepoMessage"),
		Directory:   true,
	})
	if err != nil || len(paths) == 0 {
		return
	}
	if a.repoOpen && a.settings.OpenInNewWindow {
		_ = a.ws.OpenInWindow(paths[0])
		return
	}
	a.openPath(paths[0])
}

// updateTitle keeps the window title and the recent documents list current.

func (a *nativeApp) copyText(text string) {
	if text == "" {
		return
	}
	if err := a.ws.Copy(text); err != nil {
		a.fail(err)
	}
}

func (a *nativeApp) repoRoot() string {
	return a.snapshot.State.Root
}

func (a *nativeApp) absPath(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(a.repoRoot(), filepath.FromSlash(path))
}

func (a *nativeApp) isImage(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico":
		return true
	}
	return false
}

func (a *nativeApp) openURL(url string) {
	_ = a.ws.OpenURL(url)
}

var errNoRepo = errors.New("no repository is open")

func (a *nativeApp) requireRepo() error {
	if !a.repoOpen {
		return errNoRepo
	}
	return nil
}

func (a *nativeApp) changedCount() int {
	return a.snapshot.State.Changed + a.snapshot.State.Untracked + a.snapshot.State.Conflicts
}

func (a *nativeApp) afterCommit() {
	a.commitForm.Message = strings.TrimSpace(a.settings.CommitTemplate)
	a.checked = map[string]bool{}
	a.commitForm.Amend = false
	a.commitForm.SignOff = false
	a.commitForm.NoVerify = false
	a.commitForm.AllowEmpty = false
	a.commitForm.Sign = false
	a.checkedInit = false
	a.refresh()
}

func (a *nativeApp) lastCommitMessage() string {
	if msg, err := a.g.LastCommitMessage(); err == nil {
		return msg
	}
	return ""
}

func (a *nativeApp) stamp(unix int64) string {
	if unix == 0 {
		return ""
	}
	t := time.Unix(unix, 0)
	now := time.Now()
	if t.Year() == now.Year() && t.YearDay() == now.YearDay() {
		return t.Format("15:04:05")
	}
	return t.Format("2006-01-02 15:04")
}
