package lsp

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestFrameReportsByteLength(t *testing.T) {
	body := `{"jsonrpc":"2.0","id":1}`
	frame := Frame(body)
	want := "Content-Length: " + strconv.Itoa(len(body)) + "\r\n\r\n" + body
	if frame != want {
		t.Fatalf("Frame = %q, want %q", frame, want)
	}
}

func TestFrameCountsBytesNotRunes(t *testing.T) {
	body := `{"s":"中文"}`
	frame := Frame(body)
	head, _, _ := strings.Cut(frame, "\r\n\r\n")
	if head != "Content-Length: 14" {
		t.Fatalf("header = %q, want Content-Length: 14", head)
	}
}

func TestReadFramesReadsEveryMessage(t *testing.T) {
	stream := Frame(`{"id":1}`) + Frame(`{"id":2}`)
	var bodies []string
	err := ReadFrames(strings.NewReader(stream), func(body string) error {
		bodies = append(bodies, body)
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "EOF") {
		t.Fatalf("err = %v, want EOF when the stream ends", err)
	}
	if len(bodies) != 2 || bodies[0] != `{"id":1}` || bodies[1] != `{"id":2}` {
		t.Fatalf("bodies = %v", bodies)
	}
}

func TestReadFramesIgnoresOtherHeaders(t *testing.T) {
	body := `{"id":1}`
	stream := "Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 8\r\n\r\n" + body
	var got []string
	_ = ReadFrames(strings.NewReader(stream), func(b string) error {
		got = append(got, b)
		return nil
	})
	if len(got) != 1 || got[0] != body {
		t.Fatalf("got %v", got)
	}
}

func TestReadFramesRejectsMissingLength(t *testing.T) {
	err := ReadFrames(strings.NewReader("Content-Type: text/plain\r\n\r\n{}"), func(string) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "no Content-Length") {
		t.Fatalf("err = %v", err)
	}
}

func TestDetectPicksByMarker(t *testing.T) {
	dir := t.TempDir()
	if _, ok := Detect(dir); ok {
		t.Fatal("an empty directory should want no server")
	}
	if err := writeFile(dir, "go.mod", "module x\n"); err != nil {
		t.Fatal(err)
	}
	s, ok := Detect(dir)
	if !ok || s.Name != "gopls" || s.Language != "go" {
		t.Fatalf("server = %+v, ok = %v", s, ok)
	}
	if s.Installed {
		t.Fatalf("%s should not be treated as installed by this test", s.Command)
	}
}

func TestDetectResolvesInstalledCommand(t *testing.T) {
	dir := t.TempDir()
	if err := writeFile(dir, "package.json", "{}\n"); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	if err := writeFile(bin, "typescript-language-server", "#!/bin/sh\n"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	s, ok := Detect(dir)
	if !ok || s.Name != "typescript-language-server" || !s.Installed {
		t.Fatalf("server = %+v, ok = %v", s, ok)
	}
	if s.Command != bin+"/typescript-language-server" {
		t.Fatalf("command = %q", s.Command)
	}
}

func writeFile(dir, name, content string) error {
	return os.WriteFile(filepath.Join(dir, name), []byte(content), 0o755)
}
