package lsp

import (
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
