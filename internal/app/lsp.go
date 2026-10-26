package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os/exec"
	"sync"

	"github.com/egoist/mygo"

	"gitjet/internal/git"
	"gitjet/internal/lsp"
)

// LSPMessage carries one message from the language server to the page. The
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
	ID   string `json:"id"`
	Root string `json:"root"`
	Name string `json:"name"`
}

// lspSession is one language server process.
type lspSession struct {
	id    string
	name  string
	root  string
	cmd   *exec.Cmd
	stdin io.WriteCloser

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

// LSPProbe reports which language server this repository wants, and whether
// it is installed. Nothing is started.
func (g *Git) LSPProbe() (lsp.Server, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return lsp.Server{}, err
	}
	server, ok := lsp.Detect(repo.Dir())
	if !ok {
		return lsp.Server{}, nil
	}
	return server, nil
}

// LSPStart starts the language server for the open repository, or returns the
// running one. The page speaks the protocol; this only moves bytes.
func (g *Git) LSPStart() (LSPInfo, error) {
	repo, err := g.c.currentRepo()
	if err != nil {
		return LSPInfo{}, err
	}
	server, ok := lsp.Detect(repo.Dir())
	if !ok {
		return LSPInfo{}, errors.New("no language server is known for this repository")
	}
	if !server.Installed {
		return LSPInfo{}, errors.New(server.Name + " is not installed")
	}

	g.c.lspMu.Lock()
	defer g.c.lspMu.Unlock()
	if g.c.lsp != nil && g.c.lsp.root == repo.Dir() {
		return LSPInfo{ID: g.c.lsp.id, Root: g.c.lsp.root, Name: g.c.lsp.name}, nil
	}
	if g.c.lsp != nil {
		g.c.lsp.stop()
		g.c.lsp = nil
	}

	cmd := exec.Command(server.Command, server.Args...)
	cmd.Dir = repo.Dir()
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
	session := &lspSession{id: newSessionID(), name: server.Name, root: repo.Dir(), cmd: cmd, stdin: stdin}
	g.c.lsp = session
	go pumpLSP(session, stdout)
	return LSPInfo{ID: session.id, Root: session.root, Name: session.name}, nil
}

// LSPWrite sends one message from the page to the server.
func (g *Git) LSPWrite(id, message string) error {
	g.c.lspMu.Lock()
	session := g.c.lsp
	g.c.lspMu.Unlock()
	if session == nil || session.id != id {
		return errors.New("the language server session is gone")
	}
	return session.write(message)
}

// LSPStop stops the language server, if one is running.
func (g *Git) LSPStop() error {
	g.c.stopLSP()
	return nil
}

// stopLSP ends the current session, for a repository switch, a close or a
// language change.
func (c *core) stopLSP() {
	c.lspMu.Lock()
	session := c.lsp
	c.lsp = nil
	c.lspMu.Unlock()
	if session != nil {
		session.stop()
	}
}

// pumpLSP relays the server's messages until it exits.
func pumpLSP(session *lspSession, stdout io.Reader) {
	err := lsp.ReadFrames(stdout, func(body string) error {
		payload, _ := json.Marshal(lspEnvelope{ID: session.id, Message: body})
		LSPMessage.Broadcast(string(payload))
		return nil
	})
	if err != nil && !errors.Is(err, io.EOF) {
		payload, _ := json.Marshal(lspEnvelope{ID: session.id, Closed: true, Error: err.Error()})
		LSPMessage.Broadcast(string(payload))
		return
	}
	payload, _ := json.Marshal(lspEnvelope{ID: session.id, Closed: true})
	LSPMessage.Broadcast(string(payload))
}

// newSessionID makes a value the page uses to ignore messages from a server
// that has since been replaced.
func newSessionID() string {
	buf := make([]byte, 8)
	rand.Read(buf)
	return hex.EncodeToString(buf)
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
