// Package lang is the app's language catalog: which languages a file can be,
// which language server speaks them, and how that server is installed.
//
// The catalog is data, not a switch in the page: a pack owns its extensions,
// its server command and its install strategy, and the host and the page both
// read the same description. Grammar names are CodeMirror language names; a
// pack's Languages are the grammars its server answers for.
package lang

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Install describes how a pack's server is obtained. Kind is "go" (run
// `go install`), "archive" (download and extract a pinned archive), or empty
// for a server the user locates themselves.
type Install struct {
	Kind         string   `json:"kind,omitempty"`
	Package      string   `json:"package,omitempty"`
	URL          string   `json:"url,omitempty"`
	SHA256       string   `json:"sha256,omitempty"`
	Version      string   `json:"version,omitempty"`
	Executables  []string `json:"executables,omitempty"`
	RequiresJava bool     `json:"requiresJava,omitempty"`
	Hint         string   `json:"hint,omitempty"`
}

// Pack is one language's support: the file names it claims, the server it
// starts, and the grammars that server serves.
type Pack struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Languages   []string `json:"languages"`
	Extensions  []string `json:"extensions"`
	ServerName  string   `json:"serverName,omitempty"`
	LanguageID  string   `json:"languageId,omitempty"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
	Install     *Install `json:"install,omitempty"`
}

// PackStatus is what the settings page shows and what the LSP probe returns:
// the pack plus whether this machine can start its server.
type PackStatus struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Languages   []string `json:"languages"`
	Extensions  []string `json:"extensions"`
	ServerName  string   `json:"serverName,omitempty"`
	LanguageID  string   `json:"languageId,omitempty"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
	Installed   bool     `json:"installed"`
	Managed     bool     `json:"managed"`
	Version     string   `json:"version,omitempty"`
	Enabled     bool     `json:"enabled"`
	Installable bool     `json:"installable"`
	Hint        string   `json:"hint,omitempty"`
}

// Options are the user's choices, kept out of the catalog so the host can
// pass a settings snapshot without a cycle.
type Options struct {
	// Enabled is the enabled pack ids. An empty slice means none; a nil
	// slice means the defaults (all built-in packs).
	Enabled    []string
	Servers    map[string]string
	InstallDir string
}

var packs = []Pack{
	{
		ID:          "go",
		Name:        "Go",
		Description: "Go modules, gopls",
		Languages:   []string{"go"},
		Extensions:  []string{".go"},
		ServerName:  "gopls",
		LanguageID:  "go",
		Command:     "gopls",
		Args:        []string{"serve"},
		Install: &Install{
			Kind:        "go",
			Package:     "golang.org/x/tools/gopls@v0.24.0",
			Version:     "v0.24.0",
			Executables: []string{"gopls"},
			Hint:        "go install golang.org/x/tools/gopls@latest",
		},
	},
	{
		ID:          "java",
		Name:        "Java",
		Description: "Java projects, Eclipse JDT Language Server",
		Languages:   []string{"java"},
		Extensions:  []string{".java"},
		ServerName:  "jdtls",
		LanguageID:  "java",
		Command:     "jdtls",
		Args:        []string{"-data", "{data}"},
		Install: &Install{
			Kind:         "archive",
			Version:      "1.63.0",
			URL:          "https://download.eclipse.org/jdtls/milestones/1.63.0/jdt-language-server-1.63.0-202610191322.tar.gz",
			SHA256:       "b1f2abe0b3cccb462cf64fb4a5587c7d09df60cf8be7748b152cbd89d018bdc4",
			Executables:  []string{"bin/jdtls", "bin/jdtls.bat"},
			RequiresJava: true,
			Hint:         "Eclipse JDT LS needs JDK 21+",
		},
	},
	{
		ID:          "kotlin",
		Name:        "Kotlin",
		Description: "Kotlin sources, kotlin-language-server",
		Languages:   []string{"kotlin"},
		Extensions:  []string{".kt", ".kts"},
		ServerName:  "kotlin-language-server",
		LanguageID:  "kotlin",
		Command:     "kotlin-language-server",
		Install:     &Install{Hint: "brew install kotlin-language-server, or download a release from github.com/Kotlin/kotlin-lsp"},
	},
	{
		ID:          "rust",
		Name:        "Rust",
		Description: "Cargo projects, rust-analyzer",
		Languages:   []string{"rust"},
		Extensions:  []string{".rs"},
		ServerName:  "rust-analyzer",
		LanguageID:  "rust",
		Command:     "rust-analyzer",
		Install:     &Install{Hint: "rustup component add rust-analyzer"},
	},
	{
		ID:          "cpp",
		Name:        "C / C++",
		Description: "C and C++ sources, clangd",
		Languages:   []string{"c", "cpp"},
		Extensions:  []string{".c", ".h", ".cc", ".cpp", ".hpp", ".cxx"},
		ServerName:  "clangd",
		LanguageID:  "cpp",
		Command:     "clangd",
		Install:     &Install{Hint: "Install clangd with Xcode Command Line Tools, LLVM, or your package manager"},
	},
	{
		ID:          "typescript",
		Name:        "TypeScript / JavaScript",
		Description: "TS, TSX, JS and JSX, typescript-language-server",
		Languages:   []string{"typescript", "tsx", "javascript", "jsx"},
		Extensions:  []string{".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"},
		ServerName:  "typescript-language-server",
		LanguageID:  "typescript",
		Command:     "typescript-language-server",
		Args:        []string{"--stdio"},
		Install:     &Install{Hint: "npm install -g typescript-language-server typescript"},
	},
	{
		ID:          "python",
		Name:        "Python",
		Description: "Python sources, Pyright",
		Languages:   []string{"python"},
		Extensions:  []string{".py", ".pyi"},
		ServerName:  "pyright-langserver",
		LanguageID:  "python",
		Command:     "pyright-langserver",
		Args:        []string{"--stdio"},
		Install:     &Install{Hint: "npm install -g pyright"},
	},
}

// Catalog returns a copy of the built-in packs.
func Catalog() []Pack {
	out := make([]Pack, len(packs))
	copy(out, packs)
	return out
}

// PackByID finds a built-in pack.
func PackByID(id string) (Pack, bool) {
	for _, pack := range packs {
		if pack.ID == id {
			return pack, true
		}
	}
	return Pack{}, false
}

// AllIDs lists the built-in pack ids in catalog order.
func AllIDs() []string {
	out := make([]string, 0, len(packs))
	for _, pack := range packs {
		out = append(out, pack.ID)
	}
	return out
}

// PackForGrammar finds the pack whose server serves a grammar name.
func PackForGrammar(grammar string) (Pack, bool) {
	for _, pack := range packs {
		for _, language := range pack.Languages {
			if language == grammar {
				return pack, true
			}
		}
	}
	return Pack{}, false
}

// Enabled answers whether a pack is switched on. A nil list means the
// defaults, which is every built-in pack.
func Enabled(list []string, id string) bool {
	if list == nil {
		return true
	}
	for _, item := range list {
		if item == id {
			return true
		}
	}
	return false
}

// NormalizeEnabled drops unknown and duplicate ids, keeping catalog order.
func NormalizeEnabled(list []string) []string {
	if list == nil {
		return nil
	}
	wanted := make(map[string]bool, len(list))
	for _, id := range list {
		wanted[id] = true
	}
	out := make([]string, 0, len(wanted))
	for _, pack := range packs {
		if wanted[pack.ID] {
			out = append(out, pack.ID)
			delete(wanted, pack.ID)
		}
	}
	return out
}

// Status describes every pack for the settings page and the LSP probe.
func Status(opts Options) []PackStatus {
	installer := NewInstaller(opts.InstallDir)
	out := make([]PackStatus, 0, len(packs))
	for _, pack := range packs {
		command, managed, version := resolve(pack, opts.Servers[pack.ID], installer)
		status := PackStatus{
			ID:          pack.ID,
			Name:        pack.Name,
			Description: pack.Description,
			Languages:   pack.Languages,
			Extensions:  pack.Extensions,
			ServerName:  pack.ServerName,
			LanguageID:  pack.LanguageID,
			Args:        pack.Args,
			Command:     command,
			Installed:   command != "",
			Managed:     managed,
			Version:     version,
			Enabled:     Enabled(opts.Enabled, pack.ID),
			Installable: pack.Install != nil && pack.Install.Kind != "",
			Hint:        installHint(pack),
		}
		out = append(out, status)
	}
	return out
}

func installHint(pack Pack) string {
	if pack.Install == nil {
		return ""
	}
	return pack.Install.Hint
}

func resolve(pack Pack, custom string, installer *Installer) (string, bool, string) {
	if pack.Command == "" {
		return "", false, ""
	}
	if path := lookupCommand(strings.TrimSpace(custom)); path != "" {
		return path, false, ""
	}
	if path, version := installer.Command(pack); path != "" {
		return path, true, version
	}
	if path := lookupCommand(pack.Command); path != "" {
		return path, false, ""
	}
	return "", false, ""
}

func lookupCommand(command string) string {
	if command == "" {
		return ""
	}
	command = expandHome(command)
	if strings.ContainsAny(command, `/\`) {
		if st, err := os.Stat(command); err == nil && !st.IsDir() {
			return command
		}
		return ""
	}
	if path, err := exec.LookPath(command); err == nil {
		return path
	}
	return ""
}

func expandHome(path string) string {
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[1:])
		}
	}
	return path
}

// PrepareArgs fills the placeholders a pack's arguments may use: {data} is a
// per-repository server data directory, {root} the repository root.
func PrepareArgs(args []string, root, dataDir string) []string {
	out := make([]string, len(args))
	for i, arg := range args {
		arg = strings.ReplaceAll(arg, "{data}", dataDir)
		arg = strings.ReplaceAll(arg, "{root}", root)
		out[i] = arg
	}
	return out
}

// CommandLine turns a resolved command into an exec-able pair. Windows batch
// files (jdtls's launcher) need cmd.exe, which CreateProcess does not do.
func CommandLine(command string, args []string) (string, []string) {
	if runtime.GOOS == "windows" {
		lower := strings.ToLower(command)
		if strings.HasSuffix(lower, ".bat") || strings.HasSuffix(lower, ".cmd") {
			return "cmd", append([]string{"/c", command}, args...)
		}
	}
	return command, args
}
