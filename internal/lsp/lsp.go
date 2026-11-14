// Package lsp starts a language server for the open repository and relays
// its JSON-RPC messages, so the page can speak the language server protocol
// without spawning processes of its own.
package lsp

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

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
