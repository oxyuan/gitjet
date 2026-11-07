package app

import (
	"github.com/egoist/mygo"
	// MyGo's own labels, of its menu items and dialogs, in Chinese: the app
	// translates its own text, and SetLanguages makes these two the languages
	// it comes in.
	_ "github.com/egoist/mygo/locales/zh-Hans"
)

// dispatchNative sends a menu command to the native window.
var dispatchNative func(string)

// secondary is true when this process was started on a repository given on
// the command line, which makes it an extra window of the app.
var secondary bool

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
		return func(*mygo.MenuItem, *mygo.Window) {
			if dispatchNative != nil {
				dispatchNative(cmd)
			}
		}
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
			{Label: l.tr("menu.newWindow"), Accelerator: "CmdOrCtrl+Shift+N", Click: send("new-window")},
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
			{Label: l.tr("menu.stash"), Accelerator: "CmdOrCtrl+Shift+S", Click: send("stash")},
			mygo.Separator(),
			{Label: l.tr("menu.repoTools"), Click: send("repo-tools")},
			{Label: l.tr("menu.remotes"), Click: send("remotes")},
			{Label: l.tr("menu.cleanupBranches"), Click: send("cleanup-branches")},
			{Label: l.tr("menu.resolveConflicts"), Click: send("resolve-conflicts")},
			{Label: l.tr("menu.browseRevision"), Click: send("browse-revision")},
			mygo.Separator(),
			{Label: l.tr("menu.compare"), Click: send("compare")},
			{Label: l.tr("menu.patches"), Click: send("patches")},
			{Label: l.tr("menu.shelves"), Click: send("shelves")},
			{Label: l.tr("menu.journal"), Click: send("journal")},
			mygo.Separator(),
			{Label: l.tr("menu.worktrees"), Click: send("worktrees")},
			{Label: l.tr("menu.submodules"), Click: send("submodules")},
			{Label: l.tr("menu.lfs"), Click: send("lfs")},
			mygo.Separator(),
			{Label: l.tr("menu.showConsole"), Click: send("tab:console")},
		}},
		{Label: l.tr("menu.window"), Submenu: []*mygo.MenuItem{{Role: mygo.RoleMinimize}, {Role: mygo.RoleZoom}}},
	})
}
