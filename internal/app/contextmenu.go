package app

import "github.com/egoist/mygo"

// installPageContextMenu strips the web view's browser items from the
// page's right-click menu, leaving a desktop app's: editing, spelling,
// Look Up, Translate and Services, and Inspect Element where the build has
// DevTools. Without it, right-clicking the editor offers Reload, Back and
// Forward, Open Link in New Window, Download and Print, which no native
// text view has and which would take the page out of the app.
func installPageContextMenu(w *mygo.Window) {
	w.Page().OnContextMenu(func(e *mygo.ContextMenuEvent) {
		e.Menu.Remove(
			// The page's navigation, which the app does not do; Reload is
			// in the View menu.
			mygo.ContextMenuBack, mygo.ContextMenuForward, mygo.ContextMenuReload, mygo.ContextMenuStop,
			// Leaving the app: new windows and downloads.
			mygo.ContextMenuOpenLinkInNewWindow, mygo.ContextMenuOpenFrameInNewWindow,
			mygo.ContextMenuOpenImageInNewWindow, mygo.ContextMenuOpenMediaInNewWindow,
			mygo.ContextMenuDownloadLink, mygo.ContextMenuDownloadImage, mygo.ContextMenuDownloadMedia,
			// Browser chrome around the selection.
			mygo.ContextMenuSearchWeb, mygo.ContextMenuShare, mygo.ContextMenuPrint,
		)
	})
}
