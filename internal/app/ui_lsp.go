package app

import (
	"encoding/json"
	"net/url"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui/editor"
)

// A small LSP client: it owns the protocol, while service.go owns the
// server process. The editor supplies positions and shows what comes back.

type lspClient struct {
	app    *nativeApp
	id     string
	root   string
	name   string
	family string // go, typescript, rust, c, java, python

	starting bool
	ready    bool
	nextID   int
	pending  map[int]func(json.RawMessage, *rpcError)
	docs     map[string]*lspDoc
	diags    map[string][]editor.Diagnostic
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type lspDoc struct {
	uri     string
	path    string
	langID  string
	version int
	sent    string
	at      time.Time
	tab     *docTab
}

type lspMessage struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *rpcError       `json:"error,omitempty"`
}

func (a *nativeApp) lspIncoming(body string) {
	mygo.RunOnMain(func() {
		if a.lsp != nil {
			a.lsp.handle(body)
		}
	})
}

// ensureLSP starts the repository's server once, if it is installed and
// the language it serves is the one open files are written in.
func (a *nativeApp) ensureLSP() {
	if a.lsp != nil {
		if a.lsp.ready {
			a.openLSPDocs()
		}
		return
	}
	if a.lspStarting || !a.repoOpen {
		return
	}
	a.lspStarting = true
	a.c.lspOnMessage = a.lspIncoming
	go func() {
		server, err := a.g.LSPProbe()
		if err != nil || server.Name == "" || !server.Installed {
			mygo.RunOnMain(func() { a.lspStarting = false })
			return
		}
		info, err := a.g.LSPStart()
		if err != nil {
			mygo.RunOnMain(func() { a.lspStarting = false })
			return
		}
		mygo.RunOnMain(func() {
			a.lspStarting = false
			a.lsp = &lspClient{
				app:     a,
				id:      info.ID,
				root:    info.Root,
				name:    info.Name,
				family:  server.Language,
				pending: map[int]func(json.RawMessage, *rpcError){},
				docs:    map[string]*lspDoc{},
				diags:   map[string][]editor.Diagnostic{},
			}
			a.lsp.initialize()
		})
	}()
}

func (c *lspClient) send(method string, params any, id *int) {
	msg := map[string]any{"jsonrpc": "2.0", "method": method}
	if params != nil {
		msg["params"] = params
	}
	if id != nil {
		msg["id"] = *id
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	_ = c.app.g.LSPWrite(c.id, string(b))
}

func (c *lspClient) notify(method string, params any) { c.send(method, params, nil) }

func (c *lspClient) request(method string, params any, fn func(json.RawMessage, *rpcError)) int {
	c.nextID++
	id := c.nextID
	c.pending[id] = fn
	c.send(method, params, &id)
	return id
}

func (c *lspClient) respond(id json.RawMessage, result any, rerr *rpcError) {
	msg := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id)}
	if rerr != nil {
		msg["error"] = rerr
	} else {
		msg["result"] = result
	}
	b, _ := json.Marshal(msg)
	_ = c.app.g.LSPWrite(c.id, string(b))
}

func (c *lspClient) initialize() {
	rootURI := pathToURI(c.root)
	params := map[string]any{
		"processId": nil,
		"rootUri":   rootURI,
		"rootPath":  c.root,
		"clientInfo": map[string]any{
			"name":    "GitJet",
			"version": "0.1.0",
		},
		"workspaceFolders": []map[string]any{{"uri": rootURI, "name": filepath.Base(c.root)}},
		"capabilities": map[string]any{
			"textDocument": map[string]any{
				"synchronization": map[string]any{"didSave": true, "willSave": false},
				"completion": map[string]any{
					"completionItem": map[string]any{
						"documentationFormat": []string{"plaintext", "markdown"},
						"resolveSupport":      map[string]any{"properties": []string{"documentation", "detail"}},
					},
				},
				"hover":              map[string]any{"contentFormat": []string{"plaintext", "markdown"}},
				"definition":         map[string]any{"linkSupport": true},
				"references":         map[string]any{},
				"publishDiagnostics": map[string]any{"relatedInformation": true},
			},
			"workspace": map[string]any{
				"workspaceFolders": true,
				"configuration":    true,
				"applyEdit":        false,
			},
		},
	}
	c.request("initialize", params, func(result json.RawMessage, rerr *rpcError) {
		if rerr != nil {
			return
		}
		c.ready = true
		c.notify("initialized", map[string]any{})
		c.app.openLSPDocs()
		c.app.redraw()
	})
}

func (c *lspClient) handle(body string) {
	var msg lspMessage
	if err := json.Unmarshal([]byte(body), &msg); err != nil {
		return
	}
	if len(msg.ID) > 0 && msg.Method == "" {
		var id int
		if err := json.Unmarshal(msg.ID, &id); err == nil {
			if fn := c.pending[id]; fn != nil {
				delete(c.pending, id)
				fn(msg.Result, msg.Error)
			}
		}
		return
	}
	if msg.Method == "" {
		return
	}
	switch msg.Method {
	case "textDocument/publishDiagnostics":
		c.diagnostics(msg.Params)
	case "workspace/configuration":
		var p struct {
			Items []any `json:"items"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		out := make([]any, len(p.Items))
		c.respond(msg.ID, out, nil)
	case "client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create":
		c.respond(msg.ID, nil, nil)
	case "workspace/applyEdit":
		c.respond(msg.ID, map[string]any{"applied": false, "failureReason": "GitJet applies edits itself"}, nil)
	case "workspace/workspaceFolders":
		c.respond(msg.ID, []map[string]any{{"uri": pathToURI(c.root), "name": filepath.Base(c.root)}}, nil)
	case "window/showMessageRequest":
		c.respond(msg.ID, nil, nil)
	case "window/showDocument":
		var p struct {
			URI string `json:"uri"`
		}
		_ = json.Unmarshal(msg.Params, &p)
		if p.URI != "" {
			if path := uriToPath(p.URI); path != "" {
				c.app.openSource(path, "")
			}
			c.respond(msg.ID, map[string]any{"success": true}, nil)
		}
	default:
		if len(msg.ID) > 0 {
			c.respond(msg.ID, nil, &rpcError{Code: -32601, Message: "not supported"})
		}
	}
}

func (c *lspClient) diagnostics(raw json.RawMessage) {
	var p struct {
		URI         string `json:"uri"`
		Diagnostics []struct {
			Range struct {
				Start struct {
					Line      int `json:"line"`
					Character int `json:"character"`
				} `json:"start"`
				End struct {
					Line      int `json:"line"`
					Character int `json:"character"`
				} `json:"end"`
			} `json:"range"`
			Severity int    `json:"severity"`
			Message  string `json:"message"`
			Source   string `json:"source"`
		} `json:"diagnostics"`
	}
	if json.Unmarshal(raw, &p) != nil {
		return
	}
	path := uriToPath(p.URI)
	if path == "" {
		return
	}
	rel := c.app.relPath(path)
	var ds []editor.Diagnostic
	for _, d := range p.Diagnostics {
		tab := c.app.findSourceTab(rel, "")
		if tab == nil || tab.src == nil {
			continue
		}
		text := tab.src.Buffer.String()
		ds = append(ds, editor.Diagnostic{
			Start:    positionToOffset(text, d.Range.Start.Line, d.Range.Start.Character),
			End:      positionToOffset(text, d.Range.End.Line, d.Range.End.Character),
			Severity: lspSeverity(d.Severity),
			Message:  d.Message,
			Source:   d.Source,
		})
	}
	c.diags[rel] = ds
	for _, tab := range c.app.tabs {
		if tab.kind == tabSource && tab.path == rel && tab.src != nil {
			tab.src.SetDiagnostics(tab.src.Buffer.Version(), ds)
		}
	}
	c.app.redraw()
}

func lspSeverity(n int) editor.Severity {
	switch n {
	case 1:
		return editor.SeverityError
	case 2:
		return editor.SeverityWarning
	case 3:
		return editor.SeverityInfo
	}
	return editor.SeverityHint
}

// openLSPDocs tells the server about the working-tree files the window has
// open.
func (a *nativeApp) openLSPDocs() {
	if a.lsp == nil || !a.lsp.ready {
		return
	}
	for _, tab := range a.tabs {
		if tab.kind == tabSource && tab.src != nil && tab.revision == "" {
			a.lsp.didOpen(tab)
		}
	}
}

func (c *lspClient) didOpen(tab *docTab) {
	if tab.revision != "" || tab.src == nil {
		return
	}
	langID := languageIDFor(tab.path)
	if langID == "" || !c.serves(langID) {
		return
	}
	uri := pathToURI(c.app.absPath(tab.path))
	if doc := c.docs[uri]; doc != nil {
		return
	}
	doc := &lspDoc{uri: uri, path: tab.path, langID: langID, version: 0, sent: tab.src.Buffer.String(), at: time.Now(), tab: tab}
	c.docs[uri] = doc
	c.notify("textDocument/didOpen", map[string]any{
		"textDocument": map[string]any{
			"uri":        uri,
			"languageId": langID,
			"version":    doc.version,
			"text":       doc.sent,
		},
	})
}

func (c *lspClient) didClose(tab *docTab) {
	uri := pathToURI(c.app.absPath(tab.path))
	if _, ok := c.docs[uri]; !ok {
		return
	}
	delete(c.docs, uri)
	c.notify("textDocument/didClose", map[string]any{"textDocument": map[string]any{"uri": uri}})
}

// sync sends a full-text change once the document has been still for a
// moment.
func (c *lspClient) sync(tab *docTab) {
	if tab.src == nil || tab.revision != "" {
		return
	}
	uri := pathToURI(c.app.absPath(tab.path))
	doc := c.docs[uri]
	if doc == nil {
		return
	}
	text := tab.src.Buffer.String()
	if text == doc.sent || time.Since(doc.at) < 250*time.Millisecond {
		return
	}
	doc.version++
	doc.sent = text
	doc.at = time.Now()
	c.notify("textDocument/didChange", map[string]any{
		"textDocument":   map[string]any{"uri": uri, "version": doc.version},
		"contentChanges": []map[string]any{{"text": text}},
	})
}

func (c *lspClient) didSave(tab *docTab) {
	uri := pathToURI(c.app.absPath(tab.path))
	if _, ok := c.docs[uri]; !ok {
		return
	}
	c.notify("textDocument/didSave", map[string]any{"textDocument": map[string]any{"uri": uri}})
}

func (c *lspClient) serves(langID string) bool {
	switch c.family {
	case "typescript":
		return langID == "typescript" || langID == "typescriptreact" || langID == "javascript" || langID == "javascriptreact"
	case "c":
		return langID == "c" || langID == "cpp"
	case "java":
		return langID == "java" || langID == "kotlin"
	}
	return c.family == langID
}

// ----- references -------------------------------------------------------

func (a *nativeApp) findReferences() {
	tab := a.activeSourceTab()
	if tab == nil || tab.src == nil {
		return
	}
	word, _, _ := wordAt(tab.src.Buffer, tab.src.Cursor())
	if word == "" {
		return
	}
	if a.lsp != nil && a.lsp.ready && tab.revision == "" {
		uri := pathToURI(a.absPath(tab.path))
		if a.lsp.docs[uri] == nil {
			a.lsp.didOpen(tab)
		}
		text := tab.src.Buffer.String()
		line, char := offsetToLSP(text, tab.src.Cursor())
		a.lsp.request("textDocument/references", map[string]any{
			"textDocument": map[string]any{"uri": uri},
			"position":     map[string]any{"line": line, "character": char},
			"context":      map[string]any{"includeDeclaration": true},
		}, func(result json.RawMessage, rerr *rpcError) {
			if rerr != nil {
				return
			}
			hits := referenceLocations(result, a)
			if len(hits) > 0 {
				a.dialog = dialogState{kind: dialogReferences, refs: hits, title: a.t("References: ") + word}
				a.redraw()
			}
		})
		return
	}
	a.lookupReferences(word)
}

func (a *nativeApp) lookupReferences(word string) {
	go func() {
		res, err := a.g.SearchSymbol(word, 300)
		mygo.RunOnMain(func() {
			if err != nil {
				a.fail(err)
				return
			}
			hits := make([]refHit, 0, len(res.Hits))
			for _, h := range res.Hits {
				hits = append(hits, refHit{path: h.Path, line: h.Line, col: h.Column, text: h.Text})
			}
			a.dialog = dialogState{kind: dialogReferences, refs: hits, title: a.t("References: ") + word}
			a.redraw()
		})
	}()
}

func referenceLocations(raw json.RawMessage, a *nativeApp) []refHit {
	var locs []struct {
		URI   string `json:"uri"`
		Range struct {
			Start struct {
				Line      int `json:"line"`
				Character int `json:"character"`
			} `json:"start"`
		} `json:"range"`
	}
	if json.Unmarshal(raw, &locs) != nil {
		return nil
	}
	out := make([]refHit, 0, len(locs))
	for _, l := range locs {
		path := a.relPath(uriToPath(l.URI))
		if path == "" {
			continue
		}
		out = append(out, refHit{path: path, line: l.Range.Start.Line + 1, col: l.Range.Start.Character + 1})
	}
	return out
}

func (a *nativeApp) openAt(path string, line int) {
	a.openSource(path, "")
	if tab := a.findSourceTab(path, ""); tab != nil {
		tab.gotoLine = line
		if tab.src != nil && line > 0 {
			tab.src.GoTo(editor.Pos{Line: line - 1})
			tab.src.ScrollTo(line - 1)
		}
	}
}

func (a *nativeApp) activeSourceTab() *docTab {
	if a.activeTab < 0 || a.activeTab >= len(a.tabs) {
		return nil
	}
	tab := a.tabs[a.activeTab]
	if tab.kind == tabSource {
		return tab
	}
	return nil
}

// ----- requests used by the editor -------------------------------------

func (a *nativeApp) lspDefinitionRequest(tab *docTab, offset int) bool {
	if a.lsp == nil || !a.lsp.ready || tab.src == nil || tab.revision != "" {
		return false
	}
	uri := pathToURI(a.absPath(tab.path))
	doc := a.lsp.docs[uri]
	if doc == nil {
		a.lsp.didOpen(tab)
		doc = a.lsp.docs[uri]
		if doc == nil {
			return false
		}
	}
	text := tab.src.Buffer.String()
	line, char := offsetToLSP(text, offset)
	a.lsp.request("textDocument/definition", map[string]any{
		"textDocument": map[string]any{"uri": uri},
		"position":     map[string]any{"line": line, "character": char},
	}, func(result json.RawMessage, rerr *rpcError) {
		if rerr != nil || len(result) == 0 {
			return
		}
		loc := firstLocation(result)
		if loc == "" {
			return
		}
		path := a.relPath(uriToPath(loc))
		if path != "" {
			a.openSource(path, "")
		}
	})
	return true
}

func (a *nativeApp) lspHoverRequest(tab *docTab, r editor.HoverRequest) bool {
	if a.lsp == nil || !a.lsp.ready || tab.src == nil || tab.revision != "" {
		return false
	}
	uri := pathToURI(a.absPath(tab.path))
	if a.lsp.docs[uri] == nil {
		a.lsp.didOpen(tab)
	}
	if a.lsp.docs[uri] == nil {
		return false
	}
	text := tab.src.Buffer.String()
	line, char := offsetToLSP(text, r.Offset)
	a.lsp.request("textDocument/hover", map[string]any{
		"textDocument": map[string]any{"uri": uri},
		"position":     map[string]any{"line": line, "character": char},
	}, func(result json.RawMessage, rerr *rpcError) {
		if rerr != nil {
			return
		}
		body := hoverText(result)
		if body == "" {
			return
		}
		word, start, end := wordAt(tab.src.Buffer, r.Offset)
		_ = word
		tab.src.ShowHover(start, end, body, nil)
	})
	return true
}

func (a *nativeApp) lspCompletionRequest(tab *docTab, r editor.CompletionRequest) bool {
	if a.lsp == nil || !a.lsp.ready || tab.src == nil || tab.revision != "" {
		return false
	}
	uri := pathToURI(a.absPath(tab.path))
	if a.lsp.docs[uri] == nil {
		a.lsp.didOpen(tab)
	}
	if a.lsp.docs[uri] == nil {
		return false
	}
	text := tab.src.Buffer.String()
	line, char := offsetToLSP(text, r.Offset)
	start := r.Offset - len(r.Prefix)
	a.lsp.request("textDocument/completion", map[string]any{
		"textDocument": map[string]any{"uri": uri},
		"position":     map[string]any{"line": line, "character": char},
		"context":      map[string]any{"triggerKind": 1},
	}, func(result json.RawMessage, rerr *rpcError) {
		if rerr != nil {
			return
		}
		items := completionItems(result)
		if len(items) > 0 {
			tab.src.ShowCompletions(start, items)
		}
	})
	return true
}

func completionItems(raw json.RawMessage) []editor.Completion {
	var list struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(raw, &list); err != nil || len(list.Items) == 0 {
		var arr []map[string]any
		if json.Unmarshal(raw, &arr) != nil {
			return nil
		}
		list.Items = arr
	}
	out := make([]editor.Completion, 0, len(list.Items))
	for _, it := range list.Items {
		label, _ := it["label"].(string)
		if label == "" {
			continue
		}
		insert := label
		if s, ok := it["insertText"].(string); ok && s != "" {
			insert = s
		}
		if te, ok := it["textEdit"].(map[string]any); ok {
			if s, ok := te["newText"].(string); ok && s != "" {
				insert = s
			}
		}
		detail, _ := it["detail"].(string)
		doc := documentationText(it["documentation"])
		kind := editor.CompletionText
		if k, ok := it["kind"].(float64); ok {
			switch int(k) {
			case 2, 3:
				kind = editor.CompletionFunction
			case 4:
				kind = editor.CompletionField
			case 5, 6:
				kind = editor.CompletionVariable
			case 7:
				kind = editor.CompletionType
			case 8:
				kind = editor.CompletionModule
			case 9:
				kind = editor.CompletionMethod
			case 14:
				kind = editor.CompletionKeyword
			case 15:
				kind = editor.CompletionSnippet
			case 21:
				kind = editor.CompletionConstant
			}
		}
		out = append(out, editor.Completion{
			Label:         label,
			Detail:        detail,
			Documentation: doc,
			Insert:        insert,
			Kind:          kind,
		})
	}
	return out
}

func documentationText(v any) string {
	switch d := v.(type) {
	case string:
		return d
	case map[string]any:
		if s, ok := d["value"].(string); ok {
			return stripMarkdown(s)
		}
	}
	return ""
}

func hoverText(raw json.RawMessage) string {
	var h struct {
		Contents any `json:"contents"`
	}
	if json.Unmarshal(raw, &h) != nil || h.Contents == nil {
		return ""
	}
	text := documentationText(h.Contents)
	if text == "" {
		if s, ok := h.Contents.(string); ok {
			return stripMarkdown(s)
		}
		if arr, ok := h.Contents.([]any); ok {
			var parts []string
			for _, item := range arr {
				parts = append(parts, documentationText(item))
			}
			return strings.Join(parts, "\n\n")
		}
	}
	return text
}

func stripMarkdown(s string) string {
	s = strings.ReplaceAll(s, "```", "")
	s = strings.ReplaceAll(s, "**", "")
	s = strings.ReplaceAll(s, "`", "")
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "#"))
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func firstLocation(raw json.RawMessage) string {
	var loc struct {
		URI         string `json:"uri"`
		TargetURI   string `json:"targetUri"`
		Range       any    `json:"range"`
		TargetRange any    `json:"targetRange"`
	}
	if json.Unmarshal(raw, &loc) == nil {
		if loc.URI != "" {
			return loc.URI
		}
		if loc.TargetURI != "" {
			return loc.TargetURI
		}
	}
	var arr []struct {
		URI       string `json:"uri"`
		TargetURI string `json:"targetUri"`
	}
	if json.Unmarshal(raw, &arr) == nil && len(arr) > 0 {
		if arr[0].URI != "" {
			return arr[0].URI
		}
		return arr[0].TargetURI
	}
	return ""
}

// ----- positions and URIs ----------------------------------------------

func offsetToLSP(text string, off int) (line, char int) {
	if off > len(text) {
		off = len(text)
	}
	for i := 0; i < off; {
		r, size := utf8.DecodeRuneInString(text[i:])
		if r == '\n' {
			line++
			char = 0
		} else {
			char += len(utf16.Encode([]rune{r}))
		}
		i += size
	}
	return line, char
}

func positionToOffset(text string, line, char int) int {
	i, l, c := 0, 0, 0
	for i < len(text) {
		if l == line && c >= char {
			return i
		}
		r, size := utf8.DecodeRuneInString(text[i:])
		if r == '\n' {
			if l == line {
				return i
			}
			l++
			c = 0
		} else {
			c += len(utf16.Encode([]rune{r}))
		}
		i += size
	}
	return len(text)
}

func pathToURI(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	abs = filepath.ToSlash(abs)
	if !strings.HasPrefix(abs, "/") {
		abs = "/" + abs
	}
	return (&url.URL{Scheme: "file", Path: abs}).String()
}

func uriToPath(uri string) string {
	u, err := url.Parse(uri)
	if err != nil || u.Scheme != "file" {
		return ""
	}
	path := u.Path
	if path == "" {
		path = u.Opaque
	}
	return filepath.FromSlash(path)
}

func languageIDFor(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".go":
		return "go"
	case ".ts":
		return "typescript"
	case ".tsx":
		return "typescriptreact"
	case ".js", ".mjs", ".cjs":
		return "javascript"
	case ".jsx":
		return "javascriptreact"
	case ".rs":
		return "rust"
	case ".c", ".h":
		return "c"
	case ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".m", ".mm":
		return "cpp"
	case ".java":
		return "java"
	case ".kt", ".kts":
		return "kotlin"
	case ".py", ".pyi":
		return "python"
	}
	return ""
}

// relPath turns an absolute path into a repository-relative one.
func (a *nativeApp) relPath(abs string) string {
	root := a.repoRoot()
	if root == "" {
		return abs
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return ""
	}
	return filepath.ToSlash(rel)
}

// findSourceTab returns the open source tab for a path and revision.
func (a *nativeApp) findSourceTab(path, revision string) *docTab {
	for _, tab := range a.tabs {
		if tab.kind == tabSource && tab.path == path && tab.revision == revision {
			return tab
		}
	}
	return nil
}

// sortedDiagFiles is used by the status bar's diagnostics count.
func (a *nativeApp) diagCount() int {
	if a.lsp == nil {
		return 0
	}
	n := 0
	for _, ds := range a.lsp.diags {
		n += len(ds)
	}
	return n
}
