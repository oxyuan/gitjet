package lang

import (
	"path/filepath"
	"strings"
)

// grammarByExt is the one extension-to-grammar table. The diffs, the source
// viewer and the explorer all colour by it, and the language packs use the
// grammar names as their routing keys.
var grammarByExt = map[string]string{
	".go":       "go",
	".ts":       "typescript",
	".mts":      "typescript",
	".cts":      "typescript",
	".tsx":      "tsx",
	".js":       "javascript",
	".mjs":      "javascript",
	".cjs":      "javascript",
	".jsx":      "jsx",
	".json":     "json",
	".jsonc":    "json",
	".css":      "css",
	".scss":     "scss",
	".html":     "markup",
	".htm":      "markup",
	".xml":      "markup",
	".svg":      "markup",
	".md":       "markdown",
	".markdown": "markdown",
	".py":       "python",
	".pyi":      "python",
	".sh":       "bash",
	".bash":     "bash",
	".zsh":      "bash",
	".yml":      "yaml",
	".yaml":     "yaml",
	".java":     "java",
	".kt":       "kotlin",
	".kts":      "kotlin",
	".rs":       "rust",
	".c":        "c",
	".h":        "c",
	".cc":       "cpp",
	".cpp":      "cpp",
	".hpp":      "cpp",
	".cxx":      "cpp",
	".sql":      "sql",
	".toml":     "toml",
	".rb":       "ruby",
	".php":      "php",
	".swift":    "swift",
}

var grammarByFilename = map[string]string{
	"Dockerfile": "docker",
	"Makefile":   "makefile",
}

// GrammarForPath names the CodeMirror grammar for a file, "plain" when the
// app has none.
func GrammarForPath(path string) string {
	base := filepath.Base(path)
	if grammar, ok := grammarByFilename[base]; ok {
		return grammar
	}
	if grammar, ok := grammarByExt[strings.ToLower(filepath.Ext(base))]; ok {
		return grammar
	}
	return "plain"
}
