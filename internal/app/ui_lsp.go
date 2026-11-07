package app

import (
	"github.com/egoist/mygo/ui/editor"
)

// The LSP client is wired here. Until a session answers, the editor falls
// back to git grep and the words of the buffer.

func (a *nativeApp) lspDefinitionRequest(tab *docTab, offset int) bool { return false }

func (a *nativeApp) lspHoverRequest(tab *docTab, r editor.HoverRequest) bool { return false }

func (a *nativeApp) lspCompletionRequest(tab *docTab, r editor.CompletionRequest) bool { return false }
