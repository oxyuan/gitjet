package app

import (
	"os"

	"github.com/egoist/mygo"
)

// Command is sent to the page when a menu item asks it to act, e.g.
// "open", "commit" or "fetch".
var Command = mygo.NewEvent[string]("app:command")

// Run starts GitJet with its services and window.
func Run() error {
	app := mygo.App
	app.SetName("GitJet")
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

	app.WhenReady(func() {
		applyMenu(c.uiLang())
		openWindow()
	})
	app.OnWindowAllClosed(func() {})
	app.OnActivate(func(hasVisibleWindows bool) {
		if !hasVisibleWindows {
			openWindow()
		}
	})
	return app.Run()
}

// secondary is true when this process was started on a repository given on
// the command line, which makes it an extra window of the app.
var secondary bool

func openWindow() {
	stateKey := "main"
	if secondary {
		stateKey = "main-2"
	}
	mygo.NewWindow(mygo.WindowOptions{
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
}

// applyMenu installs the menu in lang, replacing whatever menu is showing.
func applyMenu(l lang) { mygo.App.SetMenu(buildMenu(l)) }

func buildMenu(l lang) *mygo.Menu {
	send := func(cmd string) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) { Command.Broadcast(cmd) }
	}
	return mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Label: l.tr("menu.file"), Submenu: []*mygo.MenuItem{
			{Label: l.tr("menu.openRepo"), Accelerator: "CmdOrCtrl+O", Click: send("open")},
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
			{Label: l.tr("menu.logTab"), Accelerator: "CmdOrCtrl+0", Click: send("tab:log")},
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
			{Label: l.tr("menu.stash"), Accelerator: "CmdOrCtrl+Shift+S", Click: send("stash")},
			mygo.Separator(),
			{Label: l.tr("menu.repoTools"), Click: send("repo-tools")},
			{Label: l.tr("menu.cleanupBranches"), Click: send("cleanup-branches")},
			{Label: l.tr("menu.resolveConflicts"), Click: send("resolve-conflicts")},
			mygo.Separator(),
			{Label: l.tr("menu.showConsole"), Click: send("tab:console")},
		}},
		{Label: l.tr("menu.window"), Submenu: []*mygo.MenuItem{{Role: mygo.RoleMinimize}, {Role: mygo.RoleZoom}}},
	})
}
