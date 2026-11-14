package lang

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestGrammarForPath(t *testing.T) {
	cases := map[string]string{
		"main.go":            "go",
		"Main.java":          "java",
		"src/app.tsx":        "tsx",
		"src/app.jsx":        "jsx",
		"README.md":          "markdown",
		"Makefile":           "makefile",
		"build/Dockerfile":   "docker",
		"include/vector.hpp": "cpp",
		"header.h":           "c",
		"notes.unknown":      "plain",
	}
	for path, want := range cases {
		if got := GrammarForPath(path); got != want {
			t.Errorf("GrammarForPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestPackForGrammar(t *testing.T) {
	pack, ok := PackForGrammar("tsx")
	if !ok || pack.ID != "typescript" {
		t.Fatalf("tsx pack = %v, %v", pack.ID, ok)
	}
	pack, ok = PackForGrammar("cpp")
	if !ok || pack.ID != "cpp" {
		t.Fatalf("cpp pack = %v, %v", pack.ID, ok)
	}
	if _, ok := PackForGrammar("markdown"); ok {
		t.Fatal("markdown should have no server pack")
	}
}

func TestNormalizeEnabledKeepsCatalogOrder(t *testing.T) {
	got := NormalizeEnabled([]string{"python", "go", "go", "removed"})
	want := []string{"go", "python"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("NormalizeEnabled = %v, want %v", got, want)
	}
	if NormalizeEnabled(nil) != nil {
		t.Fatal("nil means the defaults and must stay nil")
	}
	if got := NormalizeEnabled([]string{}); len(got) != 0 {
		t.Fatalf("empty list = %v, want empty", got)
	}
}

func TestStatusTreatsEmptyAsEverythingDisabled(t *testing.T) {
	statuses := Status(Options{Enabled: []string{}})
	for _, status := range statuses {
		if status.Enabled {
			t.Fatalf("%s is enabled by an empty list", status.ID)
		}
	}
	statuses = Status(Options{Enabled: nil})
	for _, status := range statuses {
		if !status.Enabled {
			t.Fatalf("%s is disabled by the defaults", status.ID)
		}
	}
}

func TestStatusDetectsCustomPathAndEnabledState(t *testing.T) {
	dir := t.TempDir()
	binary := filepath.Join(dir, "my-jdtls")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	statuses := Status(Options{
		Enabled: []string{"java"},
		Servers: map[string]string{"java": binary},
	})
	if len(statuses) != len(Catalog()) {
		t.Fatalf("statuses = %d", len(statuses))
	}
	java := findStatus(t, statuses, "java")
	if !java.Enabled || !java.Installed {
		t.Fatalf("java = %+v", java)
	}
	if java.Command != binary {
		t.Fatalf("command = %q, want %q", java.Command, binary)
	}
	goStatus := findStatus(t, statuses, "go")
	if goStatus.Enabled {
		t.Fatal("go should be disabled when only java is listed")
	}
}

func TestStatusFindsServerOnPath(t *testing.T) {
	dir := t.TempDir()
	name := "fake-gopls"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(""), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	statuses := Status(Options{Enabled: []string{"go"}})
	goStatus := findStatus(t, statuses, "go")
	if goStatus.Installed {
		// gopls is not installed under that name; this asserts the probe
		// looks for the catalog command, not any binary in PATH.
		t.Fatalf("go server found unexpectedly: %+v", goStatus)
	}
	if err := os.Rename(path, filepath.Join(dir, "gopls")); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" {
		os.Rename(filepath.Join(dir, "gopls"), filepath.Join(dir, "gopls.exe"))
	}
	statuses = Status(Options{Enabled: []string{"go"}})
	if !findStatus(t, statuses, "go").Installed {
		t.Fatal("gopls on PATH was not found")
	}
}

func findStatus(t *testing.T, statuses []PackStatus, id string) PackStatus {
	t.Helper()
	for _, status := range statuses {
		if status.ID == id {
			return status
		}
	}
	t.Fatalf("no status for %s", id)
	return PackStatus{}
}

func TestPrepareArgs(t *testing.T) {
	got := PrepareArgs([]string{"-data", "{data}", "{root}"}, "/repo", "/data")
	want := []string{"-data", "/data", "/repo"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("PrepareArgs = %v, want %v", got, want)
		}
	}
}

func TestInstallerExtractsPinnedArchive(t *testing.T) {
	archive := makeTarGz(t, map[string]string{
		"bin/jdtls":     "#!/bin/sh\n",
		"plugins/core":  "jar",
		"bin/jdtls.bat": "@echo off\n",
	})
	sum := sha256.Sum256(archive)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(archive)
	}))
	defer server.Close()

	pack := Pack{
		ID:         "java",
		Name:       "Java",
		ServerName: "jdtls",
		Install: &Install{
			Kind:        "archive",
			Version:     "1.63.0",
			URL:         server.URL,
			SHA256:      hex.EncodeToString(sum[:]),
			Executables: []string{"bin/jdtls", "bin/jdtls.bat"},
		},
	}
	installer := NewInstaller(t.TempDir())
	var lines []string
	version, err := installer.Install(pack, func(line string) { lines = append(lines, line) })
	if err != nil {
		t.Fatal(err)
	}
	if version != "1.63.0" {
		t.Fatalf("version = %q", version)
	}
	command, managedVersion := installer.Command(pack)
	if command == "" || managedVersion != "1.63.0" {
		t.Fatalf("command = %q, version = %q", command, managedVersion)
	}
	if !strings.HasSuffix(filepath.ToSlash(command), "bin/jdtls") {
		t.Fatalf("command = %q", command)
	}
	if len(lines) == 0 {
		t.Fatal("installer reported no progress")
	}
	if err := installer.Remove(pack); err != nil {
		t.Fatal(err)
	}
	if command, _ := installer.Command(pack); command != "" {
		t.Fatalf("after remove command = %q", command)
	}
}

func TestInstallerRejectsBadChecksum(t *testing.T) {
	archive := makeTarGz(t, map[string]string{"bin/server": "x"})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(archive)
	}))
	defer server.Close()
	pack := Pack{ID: "bad", Install: &Install{Kind: "archive", URL: server.URL, SHA256: strings.Repeat("0", 64), Executables: []string{"bin/server"}}}
	installer := NewInstaller(t.TempDir())
	if _, err := installer.Install(pack, nil); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("Install error = %v", err)
	}
}

func TestExtractTarGzRejectsTraversal(t *testing.T) {
	archive := makeTarGz(t, map[string]string{"../escape": "bad"})
	dir := t.TempDir()
	path := filepath.Join(dir, "a.tar.gz")
	if err := os.WriteFile(path, archive, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := extractTarGz(path, filepath.Join(dir, "out")); err == nil {
		t.Fatal("traversal was accepted")
	}
}

func makeTarGz(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		mode := int64(0o644)
		if strings.HasPrefix(name, "bin/") {
			mode = 0o755
		}
		h := &tar.Header{Name: name, Mode: mode, Size: int64(len(body)), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestJavaMajor(t *testing.T) {
	cases := []struct {
		output string
		major  int
		ok     bool
	}{
		{`openjdk version "25.0.5" 2026-10-24`, 25, true},
		{`java version "1.8.0_202"`, 8, true},
		{`java version "21" 2023-09-19`, 21, true},
		{"no version here", 0, false},
	}
	for _, c := range cases {
		major, ok := javaMajor(c.output)
		if major != c.major || ok != c.ok {
			t.Errorf("javaMajor(%q) = %d, %v; want %d, %v", c.output, major, ok, c.major, c.ok)
		}
	}
}
