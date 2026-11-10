package app

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
	// MyGo's own labels, of its menu items and dialogs, in Chinese: the app
	// translates its own text, and SetLanguages makes these two the languages
	// it comes in.
	_ "github.com/egoist/mygo/locales/zh-Hans"
)

// Command is sent to the page when a menu item asks it to act, e.g.
// "open", "commit" or "fetch".
var Command = mygo.NewEvent[string]("app:command")

// Run starts GitJet with its services and window.
func Run() error {
	app := mygo.App
	app.SetName("GitJet")
	// The languages the app comes in: its pages and menu labels say them
	// themselves, and this makes MyGo's own labels, its dialogs and its
	// standard menu items, say them too.
	app.SetLanguages("en", "zh-Hans")
	c := newCore()
	if len(os.Args) > 1 {
		if st, err := os.Stat(os.Args[1]); err == nil && st.IsDir() {
			c.startup = os.Args[1]
			// A window opened on another repository keeps its own geometry,
			// so it does not land exactly on the window that opened it.
			secondary = true
		}
	}
	mygo.Bind(&Workspace{c: c})
	mygo.Bind(&Git{c: c})

	// Files and folders the system opens reach the app here: a repository
	// given on the command line is the startup one and opens in Bootstrap,
	// and any other, from Open Recent, the Dock menu and Finder, opens in
	// the window the page already has.
	app.OnOpenFile(func(path string) {
		c.mu.Lock()
		startup := c.startup
		c.mu.Unlock()
		if startup != "" && samePath(startup, path) {
			return
		}
		path = repositoryPath(path)
		if path == "" {
			return
		}
		app.WhenReady(func() {
			if window() == nil {
				c.mu.Lock()
				c.startup = path
				c.mu.Unlock()
				openWindow()
				return
			}
			Command.Broadcast("open:" + path)
		})
	})

	app.WhenReady(func() {
		applyMenu(c.languageSetting())
		openWindow()
	})
	app.OnWindowAllClosed(func() { setWindow(nil) })
	app.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			openWindow()
		}
	})
	return app.Run()
}

// windowRef is the window this process shows, nil while it has none.
var (
	windowMu  sync.Mutex
	windowRef *mygo.Window
)

func window() *mygo.Window {
	windowMu.Lock()
	defer windowMu.Unlock()
	return windowRef
}

func setWindow(w *mygo.Window) {
	windowMu.Lock()
	windowRef = w
	windowMu.Unlock()
}

// repositoryPath is the folder to open for a path the system opened: a
// repository may be dragged in as any file of it.
func repositoryPath(path string) string {
	st, err := os.Stat(path)
	if err != nil {
		return ""
	}
	if st.IsDir() {
		return path
	}
	return filepath.Dir(path)
}

// samePath tells whether two paths name the same place, as the startup
// repository and the one the system reports for it do.
func samePath(a, b string) bool {
	aa, err := filepath.Abs(a)
	if err != nil {
		return a == b
	}
	bb, err := filepath.Abs(b)
	if err != nil {
		return a == b
	}
	return aa == bb
}

// secondary is true when this process was started on a repository given on
// the command line, which makes it an extra window of the app.
var secondary bool

func openWindow() {
	stateKey := "main"
	if secondary {
		stateKey = "main-2"
	}
	w := mygo.NewWindow(mygo.WindowOptions{
		Title:                mygo.App.Name(),
		Width:                1440,
		Height:               900,
		MinWidth:             900,
		MinHeight:            560,
		TitleBarStyle:        mygo.TitleBarHidden,
		TitleBarHeight:       52,
		TrafficLightPosition: &mygo.Point{X: 20, Y: 19},
		BackgroundColor:      "light-dark(#f5f5f7, #141416)",
		StateKey:             stateKey,
		URL:                  "/",
	})
	setWindow(w)
	w.OnClosed(func() { setWindow(nil) })
	installPageContextMenu(w)
}

// applyMenu installs the menu for the language setting, replacing whatever
// menu is showing, and makes MyGo's own labels say the same language.
func applyMenu(setting string) {
	// "system" leaves MyGo to the user's languages, as the app does then.
	// MyGo's strings are Simplified Chinese; the app has no Traditional one.
	locale := ""
	switch setting {
	case string(langZH):
		locale = "zh-Hans"
	case string(langEN):
		locale = "en"
	}
	mygo.App.SetLocale(locale)
	mygo.App.SetMenu(buildMenu(resolveLang(setting)))
}

func buildMenu(l lang) *mygo.Menu {
	send := func(cmd string) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) { Command.Broadcast(cmd) }
	}
	return mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Label: l.tr("menu.file"), Submenu: []*mygo.MenuItem{
			{Label: l.tr("menu.openRepo"), Accelerator: "CmdOrCtrl+O", Click: send("open")},
			{Label: l.tr("menu.clone"), Click: send("clone")},
			{Label: l.tr("menu.init"), Click: send("init")},
			// The repositories the app opened lately, as the system lists
			// them in the Dock menu and the jump list; choosing one comes
			// back through App.OnOpenFile.
			{Role: mygo.RoleOpenRecent},
			{Label: l.tr("menu.quickOpen"), Accelerator: "CmdOrCtrl+P", Click: send("quickopen")},
			{Label: l.tr("menu.closeTab"), Accelerator: "CmdOrCtrl+W", Click: send("closetab")},
			{Label: l.tr("menu.closeRepo"), Accelerator: "CmdOrCtrl+Shift+W", Click: send("close")},
			mygo.Separator(),
			{Label: l.tr("menu.settings"), Accelerator: "CmdOrCtrl+,", Click: send("settings")},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		}},
		{Label: l.tr("menu.edit"), Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleUndo}, {Role: mygo.RoleRedo}, mygo.Separator(),
			{Role: mygo.RoleCut}, {Role: mygo.RoleCopy}, {Role: mygo.RolePaste},
			{Role: mygo.RoleSelectAll},
		}},
		{Label: l.tr("menu.view"), Submenu: []*mygo.MenuItem{
			{Label: l.tr("menu.commitTab"), Accelerator: "CmdOrCtrl+9", Click: send("tab:commit")},
			{Label: l.tr("menu.logTab"), Accelerator: "CmdOrCtrl+0", Click: send("tab:branch")},
			{Label: l.tr("menu.filesTab"), Accelerator: "CmdOrCtrl+Shift+E", Click: send("tab:files")},
			{Label: l.tr("menu.consoleTab"), Accelerator: "CmdOrCtrl+Shift+9", Click: send("tab:console")},
			mygo.Separator(),
			{Label: l.tr("menu.refresh"), Accelerator: "CmdOrCtrl+R", Click: send("refresh")},
			mygo.Separator(),
			{Role: mygo.RoleToggleFullScreen},
		}},
		{Label: l.tr("menu.git"), Submenu: []*mygo.MenuItem{
			{Label: l.tr("menu.commit"), Accelerator: "CmdOrCtrl+K", Click: send("commit")},
			{Label: l.tr("menu.push"), Accelerator: "CmdOrCtrl+Shift+K", Click: send("push")},
			{Label: l.tr("menu.pull"), Accelerator: "CmdOrCtrl+T", Click: send("pull")},
			{Label: l.tr("menu.fetch"), Click: send("fetch")},
			{Label: l.tr("menu.branches"), Accelerator: "CmdOrCtrl+Shift+`", Click: send("branches")},
			{Label: l.tr("menu.merge"), Click: send("merge")},
			{Label: l.tr("menu.stash"), Accelerator: "CmdOrCtrl+Shift+S", Click: send("stash")},
			mygo.Separator(),
			{Label: l.tr("menu.repoTools"), Click: send("repo-tools")},
			{Label: l.tr("menu.remotes"), Click: send("remotes")},
			{Label: l.tr("menu.cleanupBranches"), Click: send("cleanup-branches")},
			{Label: l.tr("menu.resolveConflicts"), Click: send("resolve-conflicts")},
			{Label: l.tr("menu.browseRevision"), Click: send("browse-revision")},
			mygo.Separator(),
			{Label: l.tr("menu.showConsole"), Click: send("tab:console")},
		}},
		{Label: l.tr("menu.window"), Submenu: []*mygo.MenuItem{{Role: mygo.RoleMinimize}, {Role: mygo.RoleZoom}}},
	})
}
