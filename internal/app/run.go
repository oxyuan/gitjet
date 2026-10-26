package app

import (
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
	mygo.Bind(&Workspace{c: c})
	mygo.Bind(&Git{c: c})

	app.WhenReady(func() {
		app.SetMenu(buildMenu())
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

func openWindow() {
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
		StateKey:             "main",
		URL:                  "/",
	})
}

func buildMenu() *mygo.Menu {
	send := func(cmd string) func(*mygo.MenuItem, *mygo.Window) {
		return func(*mygo.MenuItem, *mygo.Window) { Command.Broadcast(cmd) }
	}
	return mygo.NewMenu([]*mygo.MenuItem{
		{Role: mygo.RoleAppMenu},
		{Label: "File", Submenu: []*mygo.MenuItem{
			{Label: "Open Repository…", Accelerator: "CmdOrCtrl+O", Click: send("open")},
			{Label: "Quick Open File…", Accelerator: "CmdOrCtrl+P", Click: send("quickopen")},
			{Label: "Close Editor Tab", Accelerator: "CmdOrCtrl+W", Click: send("closetab")},
			{Label: "Close Repository", Accelerator: "CmdOrCtrl+Shift+W", Click: send("close")},
			mygo.Separator(),
			{Label: "Settings…", Accelerator: "CmdOrCtrl+,", Click: send("settings")},
			mygo.Separator(),
			{Role: mygo.RoleQuit},
		}},
		{Label: "Edit", Submenu: []*mygo.MenuItem{
			{Role: mygo.RoleUndo}, {Role: mygo.RoleRedo}, mygo.Separator(),
			{Role: mygo.RoleCut}, {Role: mygo.RoleCopy}, {Role: mygo.RolePaste},
			{Role: mygo.RoleSelectAll},
		}},
		{Label: "View", Submenu: []*mygo.MenuItem{
			{Label: "Commit", Accelerator: "CmdOrCtrl+9", Click: send("tab:commit")},
			{Label: "Log", Accelerator: "CmdOrCtrl+0", Click: send("tab:log")},
			{Label: "Console", Accelerator: "CmdOrCtrl+Shift+9", Click: send("tab:console")},
			mygo.Separator(),
			{Label: "Refresh", Accelerator: "CmdOrCtrl+R", Click: send("refresh")},
			mygo.Separator(),
			{Role: mygo.RoleToggleFullScreen},
		}},
		{Label: "Git", Submenu: []*mygo.MenuItem{
			{Label: "Commit…", Accelerator: "CmdOrCtrl+K", Click: send("commit")},
			{Label: "Push…", Accelerator: "CmdOrCtrl+Shift+K", Click: send("push")},
			{Label: "Update Project…", Accelerator: "CmdOrCtrl+T", Click: send("pull")},
			{Label: "Fetch", Click: send("fetch")},
			{Label: "Branches…", Accelerator: "CmdOrCtrl+Shift+`", Click: send("branches")},
			{Label: "Stash Changes…", Accelerator: "CmdOrCtrl+Shift+S", Click: send("stash")},
			mygo.Separator(),
			{Label: "Show Git Console", Click: send("tab:console")},
		}},
		{Label: "Window", Submenu: []*mygo.MenuItem{{Role: mygo.RoleMinimize}, {Role: mygo.RoleZoom}}},
	})
}
