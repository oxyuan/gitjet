package app

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/editor"

	"gitjet/internal/git"
)

func editorBuffer(text string) *editor.Buffer { return editor.NewBuffer(text) }

func newEditorState(buf *editor.Buffer, readOnly bool) *editor.State {
	return &editor.State{Buffer: buf, ReadOnly: readOnly, LineHeight: 1.5}
}

// wordAt returns the identifier around offset and its byte range.
func wordAt(buf *editor.Buffer, offset int) (string, int, int) {
	text := buf.String()
	if offset > len(text) {
		offset = len(text)
	}
	start := offset
	for start > 0 {
		r, size := runeBefore(text, start)
		if !isWordRune(r) {
			break
		}
		start -= size
	}
	end := offset
	for end < len(text) {
		r, size := runeAt(text, end)
		if !isWordRune(r) {
			break
		}
		end += size
	}
	return text[start:end], start, end
}

func runeBefore(s string, i int) (rune, int) {
	if i <= 0 {
		return 0, 0
	}
	r, size := utf8.DecodeLastRuneInString(s[:i])
	return r, size
}

func runeAt(s string, i int) (rune, int) {
	if i >= len(s) {
		return 0, 0
	}
	return utf8.DecodeRuneInString(s[i:])
}

func isWordRune(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$'
}

// lspDefinition falls back to a whole-word search when no language server
// answers. The LSP client replaces it in ui_lsp.go.
func (a *nativeApp) lspDefinition(tab *docTab, offset int) {
	if tab.src == nil {
		return
	}
	word, _, _ := wordAt(tab.src.Buffer, offset)
	if word == "" {
		return
	}
	if a.lspDefinitionRequest(tab, offset) {
		return
	}
	a.lookupSymbol(word)
}

func (a *nativeApp) lookupSymbol(word string) {
	a.busy++
	go func() {
		res, err := a.g.SearchSymbol(word, 300)
		mygo.RunOnMain(func() {
			a.busy--
			if err != nil {
				a.fail(err)
				return
			}
			if len(res.Hits) == 0 {
				a.setNotice(fmt.Sprintf(a.t("No matches for %s"), word))
				return
			}
			h := res.Hits[0]
			for _, hit := range res.Hits {
				if hit.Line > 0 {
					h = hit
					break
				}
			}
			a.openSource(h.Path, "")
			a.setNotice(fmt.Sprintf("%s · %s:%d", word, h.Path, h.Line))
			a.appendConsole(fmt.Sprintf("%s:%d: %s", h.Path, h.Line, strings.TrimSpace(h.Text)))
		})
	}()
}

// lspHover shows a word and its occurrences when no server answers.
func (a *nativeApp) lspHover(tab *docTab, r editor.HoverRequest) {
	if tab.src == nil {
		return
	}
	if a.lspHoverRequest(tab, r) {
		return
	}
	word, start, end := wordAt(tab.src.Buffer, r.Offset)
	if word == "" {
		return
	}
	n := strings.Count(tab.src.Buffer.String(), word)
	text := fmt.Sprintf("%s — %d occurrence(s)", word, n)
	tab.src.ShowHover(start, end, text, nil)
}

// lspComplete lists the words of the buffer, as the no-server fallback.
func (a *nativeApp) lspComplete(tab *docTab, r editor.CompletionRequest) {
	if tab.src == nil {
		return
	}
	if a.lspCompletionRequest(tab, r) {
		return
	}
	words := map[string]bool{}
	text := tab.src.Buffer.String()
	var cur strings.Builder
	for _, ch := range text {
		if isWordRune(ch) {
			cur.WriteRune(ch)
			continue
		}
		w := cur.String()
		cur.Reset()
		if len(w) > 1 && strings.HasPrefix(w, r.Prefix) && w != r.Prefix {
			words[w] = true
		}
	}
	if w := cur.String(); len(w) > 1 && strings.HasPrefix(w, r.Prefix) {
		words[w] = true
	}
	items := make([]editor.Completion, 0, len(words))
	for w := range words {
		items = append(items, editor.Completion{Label: w, Insert: w})
		if len(items) >= 100 {
			break
		}
	}
	if len(items) > 0 {
		tab.src.ShowCompletions(r.Offset-len(r.Prefix), items)
	}
}

// ----- file operations --------------------------------------------------

func (a *nativeApp) promptNewFile(parent string, dir bool) {
	base := parent
	if !dir {
		base = filepathDir(parent)
	}
	a.dialog = dialogState{kind: dialogPrompt, title: a.t("New File"), message: a.t("Name of the file"), action: "new-file", target: base, text: ""}
}

func (a *nativeApp) promptNewFolder(parent string, dir bool) {
	base := parent
	if !dir {
		base = filepathDir(parent)
	}
	a.dialog = dialogState{kind: dialogPrompt, title: a.t("New Folder"), message: a.t("Name of the folder"), action: "new-folder", target: base, text: ""}
}

func (a *nativeApp) promptRename(path string) {
	a.dialog = dialogState{kind: dialogPrompt, title: a.t("Rename"), message: a.t("New name or path"), action: "rename", target: path, text: filepath.Base(path)}
}

func (a *nativeApp) confirmDelete(path string) {
	a.dialog = dialogState{kind: dialogConfirm, title: a.t("Delete"), message: fmt.Sprintf(a.t("Delete %s?"), path), action: "delete-path", text: path}
}

func filepathDir(p string) string {
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return ""
	}
	return p[:i]
}

// openPreview is in ui_dialogs.go; these keep its imports honest.
var _ = ui.Contain
var _ = git.DiffWorkingTree
