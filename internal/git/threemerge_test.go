package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// mergeFileOracle is the merge git itself would produce. Running the real
// command keeps this implementation honest about where the conflict blocks
// fall, which is the part that is easy to get subtly wrong.
func mergeFileOracle(t *testing.T, base, ours, theirs string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range map[string]string{"base": base, "ours": ours, "theirs": theirs} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cmd := exec.Command("git", "-C", dir, "merge-file", "-p", "--diff3",
		"-L", "ours", "-L", "base", "-L", "theirs", "ours", "base", "theirs")
	// A merge with conflicts exits 1 and still prints the merged text.
	out, _ := cmd.Output()
	return string(out)
}

func TestMergeTextAgreesWithGitMergeFile(t *testing.T) {
	cases := []struct {
		name               string
		base, ours, theirs string
		wantConflicts      int
	}{
		{
			name: "only theirs changed",
			base: "a\nb\nc\n", ours: "a\nb\nc\n", theirs: "a\nb\nC\n",
			wantConflicts: 0,
		},
		{
			name: "only ours changed",
			base: "a\nb\nc\n", ours: "a\nB\nc\n", theirs: "a\nb\nc\n",
			wantConflicts: 0,
		},
		{
			name: "both sides made the same change",
			base: "a\nb\nc\n", ours: "a\nX\nc\n", theirs: "a\nX\nc\n",
			wantConflicts: 0,
		},
		{
			name: "both sides changed the same line differently",
			base: "a\nb\nc\n", ours: "a\nOURS\nc\n", theirs: "a\nTHEIRS\nc\n",
			wantConflicts: 1,
		},
		{
			name: "independent edits far apart",
			base: "a\nb\nc\nd\ne\n", ours: "a\nB\nc\nd\ne\n", theirs: "a\nb\nc\nd\nE\n",
			wantConflicts: 0,
		},
		{
			name: "edits on neighbouring lines",
			base: "a\nb\nc\nd\n", ours: "a\nOURS\nc\nd\n", theirs: "a\nb\nTHEIRS\nd\n",
			wantConflicts: 1,
		},
		{
			name: "both sides inserted before the same line",
			base: "a\nb\n", ours: "a\nX\nb\n", theirs: "a\nY\nb\n",
			wantConflicts: 1,
		},
		{
			name: "theirs appended a line",
			base: "a\nb\nc\n", ours: "a\nb\nc\n", theirs: "a\nb\nc\nd\n",
			wantConflicts: 0,
		},
		{
			name: "theirs deleted a line ours kept",
			base: "a\nb\nc\n", ours: "a\nb\nc\n", theirs: "a\nc\n",
			wantConflicts: 0,
		},
		{
			name: "theirs lost the final newline",
			base: "a\nb\nc\n", ours: "a\nb\nc\n", theirs: "a\nb\nc",
			wantConflicts: 0,
		},
		{
			name: "empty base, both added text",
			base: "", ours: "ours\n", theirs: "theirs\n",
			wantConflicts: 1,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, conflicts := MergeText(tc.base, tc.ours, tc.theirs, MergeLabels{})
			want := mergeFileOracle(t, tc.base, tc.ours, tc.theirs)
			if got != want {
				t.Fatalf("merged text differs from git merge-file\n got: %q\nwant: %q", got, want)
			}
			if conflicts != tc.wantConflicts {
				t.Fatalf("conflicts = %d, want %d", conflicts, tc.wantConflicts)
			}
			if counted := CountConflictMarkers(got); counted != tc.wantConflicts {
				t.Fatalf("%d marker blocks in the output, want %d", counted, tc.wantConflicts)
			}
		})
	}
}

func TestMergeTextUsesTheLabelsItIsGiven(t *testing.T) {
	got, conflicts := MergeText(
		"a\nb\n", "a\nX\n", "a\nY\n",
		MergeLabels{Ours: "feature", Base: "merge-base", Theirs: "main"},
	)
	if conflicts != 1 {
		t.Fatalf("conflicts = %d, want 1", conflicts)
	}
	for _, want := range []string{"<<<<<<< feature\n", "||||||| merge-base\n", ">>>>>>> main\n"} {
		if !strings.Contains(got, want) {
			t.Fatalf("output is missing %q:\n%s", want, got)
		}
	}
}

func TestMergeTextBeyondTheTableLimitStillMerges(t *testing.T) {
	// More lines than the match table would allow, so the unique-line
	// anchors carry the merge: one edit on each side, far apart.
	var base, ours, theirs strings.Builder
	for i := 0; i < 3000; i++ {
		line := "line-" + strings.Repeat("x", i%7) + "-" + strconv.Itoa(i) + "\n"
		base.WriteString(line)
		switch i {
		case 10:
			ours.WriteString("ours-edit\n")
			theirs.WriteString(line)
		case 2990:
			ours.WriteString(line)
			theirs.WriteString("theirs-edit\n")
		default:
			ours.WriteString(line)
			theirs.WriteString(line)
		}
	}
	got, conflicts := MergeText(base.String(), ours.String(), theirs.String(), MergeLabels{})
	if conflicts != 0 {
		t.Fatalf("conflicts = %d, want 0", conflicts)
	}
	if !strings.Contains(got, "ours-edit\n") || !strings.Contains(got, "theirs-edit\n") {
		t.Fatal("an edit was lost in the anchor fallback")
	}
}
