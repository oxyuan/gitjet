package app

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo"

	"gitjet/internal/git"
	langpack "gitjet/internal/lang"
	"gitjet/internal/lsp"
	"gitjet/internal/proc"
)

// LSPMessage carries one message from a language server to the page. The
// page reads the envelope, and never the protocol, so the Go side stays a
// pipe: it frames messages and nothing else.
var LSPMessage = mygo.NewEvent[string]("git:lsp")

// lspEnvelope is what LSPMessage carries.
type lspEnvelope struct {
	ID      string `json:"id"`
	Message string `json:"message,omitempty"`
	// Closed says the server exited, so the page stops waiting for more.
	Closed bool `json:"closed,omitempty"`
	// Error explains why a session could not start or ended badly.
	Error string `json:"error,omitempty"`
}

// LSPInfo identifies a running bridge.
type LSPInfo struct {
	ID     string `json:"id"`
	PackID string `json:"packId"`
	Root   string `json:"root"`
	Name   string `json:"name"`
}

// lspSession is one language server process.
type lspSession struct {
	id     string
	packID string
	name   string
	root   string
	cmd    *exec.Cmd
	stdin  io.WriteCloser

	mu     sync.Mutex
	closed bool
}

// write sends one framed message to the server.
func (s *lspSession) write(message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.stdin == nil {
		return errors.New("the language server is not running")
	}
	_, err := io.WriteString(s.stdin, lsp.Frame(message))
	if err != nil {
		return err
	}
	return nil
}

// stop ends the process and its session.
func (s *lspSession) stop() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	stdin := s.stdin
	s.stdin = nil
	s.mu.Unlock()
	if stdin != nil {
		_ = stdin.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
		_ = s.cmd.Wait()
	}
}

// languageOptions snapshots the settings the language catalog needs.
func (c *core) languageOptions() langpack.Options {
	c.mu.Lock()
	defer c.mu.Unlock()
	servers := make(map[string]string, len(c.settings.LanguageServers))
	for _, entry := range c.settings.LanguageServers {
		servers[entry.PackID] = entry.Path
	}
	enabled := make([]string, len(c.settings.LanguagePacks))
	copy(enabled, c.settings.LanguagePacks)
	return langpack.Options{
		Enabled:    enabled,
		Servers:    servers,
		InstallDir: languagePackDir(),
	}
}

// languagePackDir is where managed servers live. It follows XDG when the
// environment asks for it, and otherwise sits beside settings.json.
func languagePackDir() string {
	if data := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); data != "" {
		return filepath.Join(data, "gitjet", "language-packs")
	}
	return filepath.Join(configDir(), "language-packs")
}

// LanguagePacks describes every built-in pack and whether its server is
// available. Nothing is started.
func (w *Workspace) LanguagePacks() []langpack.PackStatus {
	return langpack.Status(w.c.languageOptions())
}

// InstallLanguagePack installs a pack's server into the managed directory,
// streaming the installer's progress, and returns the refreshed catalog.
func (w *Workspace) InstallLanguagePack(id string, out *mygo.Channel[string]) ([]langpack.PackStatus, error) {
	pack, ok := langpack.PackByID(id)
	if !ok {
		return w.LanguagePacks(), errors.New("unknown language pack: " + id)
	}
	// Windows cannot replace a running executable; the page disconnects its
	// clients after the call, which is too late for the file move.
	w.c.stopLSP()
	installer := langpack.NewInstaller(languagePackDir())
	report := func(line string) {
		if out != nil {
			_ = out.Send(line)
		}
	}
	if _, err := installer.Install(pack, report); err != nil {
		return w.LanguagePacks(), err
	}
	return w.LanguagePacks(), nil
}

// RemoveLanguagePack deletes a managed install. A PATH or custom server is
// untouched.
func (w *Workspace) RemoveLanguagePack(id string) ([]langpack.PackStatus, error) {
	pack, ok := langpack.PackByID(id)
	if !ok {
		return w.LanguagePacks(), errors.New("unknown language pack: " + id)
	}
	w.c.stopLSP()
	if err := langpack.NewInstaller(languagePackDir()).Remove(pack); err != nil {
		return w.LanguagePacks(), err
	}
	return w.LanguagePacks(), nil
}

// ChooseLanguageServer shows the native file picker for a server executable.
func (w *Workspace) ChooseLanguageServer(ctx context.Context) (string, error) {
	win := mygo.CallerWindow(ctx)
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      win,
		Title:       w.c.uiLang().tr("dialog.chooseServer"),
		ButtonLabel: w.c.uiLang().tr("dialog.openRepoButton"),
		Message:     w.c.uiLang().tr("dialog.chooseServerMessage"),
	})
	if err != nil || len(paths) == 0 {
		return "", err
	}
	return paths[0], nil
}

// LSPProbe reports every enabled language pack and whether its server is
// installed. Nothing is started.
func (g *Git) LSPProbe() ([]langpack.PackStatus, error) {
	return langpack.Status(g.c.languageOptions()), nil
}

// LSPStart starts one pack's language server for the open repository, or
// returns the running one. The page speaks the protocol; this only moves
// bytes.
func (g *Git) LSPStart(packID string) (LSPInfo, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return LSPInfo{}, err
	}
	var server langpack.PackStatus
	for _, status := range langpack.Status(g.c.languageOptions()) {
		if status.ID == packID {
			server = status
			break
		}
	}
	if server.ID == "" {
		return LSPInfo{}, errors.New("unknown language pack: " + packID)
	}
	if !server.Enabled {
		return LSPInfo{}, errors.New(server.Name + " support is disabled")
	}
	if !server.Installed || server.Command == "" {
		return LSPInfo{}, errors.New(server.ServerName + " is not installed")
	}

	g.c.lspMu.Lock()
	if g.c.lsp == nil {
		g.c.lsp = map[string]*lspSession{}
	}
	if session, ok := g.c.lsp[packID]; ok && session.root == repo.Dir() {
		info := LSPInfo{ID: session.id, PackID: session.packID, Root: session.root, Name: session.name}
		g.c.lspMu.Unlock()
		return info, nil
	}
	old := g.c.lsp[packID]
	delete(g.c.lsp, packID)
	g.c.lspMu.Unlock()
	// Stopping outside the lock: the pump's completion callback takes it.
	stopSession(old)

	dataDir := filepath.Join(configDir(), "lsp-data", packID, pathHash(repo.Dir()))
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return LSPInfo{}, err
	}
	args := langpack.PrepareArgs(server.Args, repo.Dir(), dataDir)
	command, commandArgs := langpack.CommandLine(server.Command, args)
	cmd := exec.Command(command, commandArgs...)
	cmd.Dir = repo.Dir()
	proc.HideConsole(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return LSPInfo{}, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return LSPInfo{}, err
	}
	// Some servers write progress to stderr; it must be drained or they
	// block, and it is not part of the protocol.
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return LSPInfo{}, err
	}
	session := &lspSession{
		id:     newSessionID(),
		packID: packID,
		name:   server.ServerName,
		root:   repo.Dir(),
		cmd:    cmd,
		stdin:  stdin,
	}
	g.c.lspMu.Lock()
	g.c.lsp[packID] = session
	g.c.lspMu.Unlock()
	go pumpLSP(session, stdout, func() { g.c.forgetLSP(packID, session.id) })
	return LSPInfo{ID: session.id, PackID: session.packID, Root: session.root, Name: session.name}, nil
}

// LSPWrite sends one message from the page to the server.
func (g *Git) LSPWrite(id, message string) error {
	g.c.lspMu.Lock()
	var session *lspSession
	for _, candidate := range g.c.lsp {
		if candidate.id == id {
			session = candidate
			break
		}
	}
	g.c.lspMu.Unlock()
	if session == nil {
		return errors.New("the language server session is gone")
	}
	return session.write(message)
}

// LSPStop stops every language server for the open repository.
func (g *Git) LSPStop() error {
	g.c.stopLSP()
	return nil
}

// stopLSP ends every session, for a repository switch, a close or a language
// change.
func (c *core) stopLSP() {
	c.lspMu.Lock()
	sessions := c.lsp
	c.lsp = nil
	c.lspMu.Unlock()
	for _, session := range sessions {
		stopSession(session)
	}
}

func stopSession(session *lspSession) {
	if session != nil {
		session.stop()
	}
}

// forgetLSP drops a session the server itself ended, so a later start does
// not reuse a dead process.
func (c *core) forgetLSP(packID, id string) {
	c.lspMu.Lock()
	if session := c.lsp[packID]; session != nil && session.id == id {
		delete(c.lsp, packID)
	}
	c.lspMu.Unlock()
}

// pumpLSP relays the server's messages until it exits.
func pumpLSP(session *lspSession, stdout io.Reader, done func()) {
	err := lsp.ReadFrames(stdout, func(body string) error {
		payload, _ := json.Marshal(lspEnvelope{ID: session.id, Message: body})
		LSPMessage.Broadcast(string(payload))
		return nil
	})
	if err != nil && !errors.Is(err, io.EOF) {
		payload, _ := json.Marshal(lspEnvelope{ID: session.id, Closed: true, Error: err.Error()})
		LSPMessage.Broadcast(string(payload))
		if done != nil {
			done()
		}
		return
	}
	payload, _ := json.Marshal(lspEnvelope{ID: session.id, Closed: true})
	LSPMessage.Broadcast(string(payload))
	if done != nil {
		done()
	}
}

// newSessionID makes a value the page uses to ignore messages from a server
// that has since been replaced.
func newSessionID() string {
	buf := make([]byte, 8)
	rand.Read(buf)
	return hex.EncodeToString(buf)
}

func pathHash(path string) string {
	sum := sha1.Sum([]byte(path))
	return hex.EncodeToString(sum[:])
}

// SearchSymbol finds a word across the working tree, for jumping to a
// definition or a usage when no language server is available.
func (g *Git) SearchSymbol(query string, limit int) (git.SymbolSearch, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return git.SymbolSearch{}, err
	}
	return repo.SearchSymbol(context.Background(), query, limit)
}
