// Package lsp starts a language server for the open repository and relays
// its JSON-RPC messages, so the page can speak the language server protocol
// without spawning processes of its own.
package lsp

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Server is the language server a repository type wants.
type Server struct {
	// Name is what the UI calls it, such as "gopls".
	Name string `json:"name"`
	// Language is the language the detection keyed on, such as "go".
	Language string `json:"language"`
	// Command is the resolved executable, empty when it is not installed.
	Command string `json:"command"`
	// Args are passed to Command.
	Args []string `json:"args"`
	// Installed says whether Command was found on PATH.
	Installed bool `json:"installed"`
}

// detectable is one repository marker and the server it asks for.
type detectable struct {
	markers  []string
	name     string
	language string
	command  string
	args     []string
}

// order matters: the first marker that exists decides the server, so a
// repository that is both a Go module and a JavaScript package gets gopls,
// which is the language the code is mostly written in for both.
var detectableServers = []detectable{
	{markers: []string{"go.mod"}, name: "gopls", language: "go", command: "gopls", args: []string{"serve"}},
	{markers: []string{"Cargo.toml"}, name: "rust-analyzer", language: "rust", command: "rust-analyzer"},
	{markers: []string{"compile_commands.json", "CMakeLists.txt"}, name: "clangd", language: "c", command: "clangd"},
	{markers: []string{"tsconfig.json", "package.json"}, name: "typescript-language-server", language: "typescript", command: "typescript-language-server", args: []string{"--stdio"}},
	{markers: []string{"pom.xml", "build.gradle", "build.gradle.kts"}, name: "jdtls", language: "java", command: "jdtls"},
	{markers: []string{"pyproject.toml", "setup.py"}, name: "pyright-langserver", language: "python", command: "pyright-langserver", args: []string{"--stdio"}},
}

// Detect finds the server a repository wants, and whether it is installed.
// It never starts anything.
func Detect(root string) (Server, bool) {
	for _, d := range detectableServers {
		found := false
		for _, marker := range d.markers {
			if _, err := os.Stat(filepath.Join(root, marker)); err == nil {
				found = true
				break
			}
		}
		if !found {
			continue
		}
		s := Server{Name: d.name, Language: d.language, Args: d.args}
		if path, err := exec.LookPath(d.command); err == nil {
			s.Command = path
			s.Installed = true
		}
		return s, true
	}
	return Server{}, false
}

// Frame wraps one JSON-RPC message in the headers LSP requires.
func Frame(body string) string {
	return "Content-Length: " + strconv.Itoa(len(body)) + "\r\n\r\n" + body
}

// ErrClosed says the server went away while reading.
var ErrClosed = errors.New("the language server stopped")

// ReadFrames calls emit for every message body read from r, until the stream
// ends. Bodies are handed over unchanged: the page owns the protocol.
func ReadFrames(r io.Reader, emit func(body string) error) error {
	br := bufio.NewReaderSize(r, 1<<16)
	for {
		length := -1
		for {
			line, err := br.ReadString('\n')
			if err != nil {
				return err
			}
			line = strings.TrimRight(line, "\r\n")
			if line == "" {
				break
			}
			colon := strings.IndexByte(line, ':')
			if colon < 0 {
				continue
			}
			if strings.EqualFold(strings.TrimSpace(line[:colon]), "Content-Length") {
				n, err := strconv.Atoi(strings.TrimSpace(line[colon+1:]))
				if err != nil || n < 0 {
					return fmt.Errorf("bad Content-Length %q", line)
				}
				length = n
			}
		}
		if length < 0 {
			return errors.New("a message had no Content-Length")
		}
		body := make([]byte, length)
		if _, err := io.ReadFull(br, body); err != nil {
			return err
		}
		if err := emit(string(body)); err != nil {
			return err
		}
	}
}
