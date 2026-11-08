package app

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestFileBadgeMatchesThePage(t *testing.T) {
	cases := []struct {
		path  string
		label string
		lang  string
	}{
		{"src/App.tsx", "TS", "ts"},
		{"src/style.css", "#", "css"},
		{"README.md", "MD", "markdown"},
		{"main.go", "GO", "go"},
		{"go.mod", "GO", "go"},
		{"package.json", "NP", "npm"},
		{"Cargo.toml", "RS", "rust"},
		{"script.sh", "SH", "shell"},
		{"LICENSE", "LC", "text"},
		{".npmrc", "CFG", "config"},
		{"data.weirdext", "WE", "plain"},
		{"Makefile", "MK", "make"},
		{"types.d.ts", "TS", "ts"},
	}
	for _, tc := range cases {
		label, lang := fileBadge(tc.path)
		if label != tc.label || lang != tc.lang {
			t.Errorf("fileBadge(%q) = %q/%q; want %q/%q", tc.path, label, lang, tc.label, tc.lang)
		}
	}
}

func TestFileBadgeTintUsesThePagePalette(t *testing.T) {
	if got, want := fileBadgeTint("ts", lightColors), ui.Hex("#4a90d9"); got != want {
		t.Errorf("typescript tint = %v; want %v", got, want)
	}
	if got, want := fileBadgeTint("plain", lightColors), ui.Hex(lightColors.muted); got != want {
		t.Errorf("plain tint = %v; want muted %v", got, want)
	}
}
