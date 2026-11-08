package app

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestFileBadgeKnownExtensions(t *testing.T) {
	cases := []struct {
		path  string
		label string
		tint  ui.Color
	}{
		{"src/App.tsx", "TS", ui.Hex("#3178c6")},
		{"src/style.css", "CSS", ui.Hex("#8b5cf6")},
		{"README.md", "MD", ui.Hex("#6b7280")},
		{"main.go", "GO", ui.Hex("#00a7d0")},
		{"script.sh", "SH", ui.Hex("#4b5563")},
	}
	for _, tc := range cases {
		label, tint := fileBadge(tc.path)
		if label != tc.label || tint != tc.tint {
			t.Errorf("fileBadge(%q) = %q, %v; want %q, %v", tc.path, label, tint, tc.label, tc.tint)
		}
	}
}

func TestFileBadgeUnknownAndExtensionless(t *testing.T) {
	if label, _ := fileBadge("LICENSE"); label != "·" {
		t.Errorf("extensionless label = %q; want ·", label)
	}
	if label, _ := fileBadge("data.weirdext"); label != "WEI" {
		t.Errorf("long extension label = %q; want WEI", label)
	}
}
