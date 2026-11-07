package app

import (
	"strings"
	"testing"

	"gitjet/internal/git"
)

func TestGraphLinearCommitsStayOnOneLane(t *testing.T) {
	commits := []git.Commit{
		{Hash: "c", Parents: []string{"b"}},
		{Hash: "b", Parents: []string{"a"}},
		{Hash: "a"},
	}
	rows := computeGraph(commits)
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3", len(rows))
	}
	for i, row := range rows {
		if row.lane != 0 {
			t.Fatalf("row %d lane = %d, want 0", i, row.lane)
		}
	}
	if len(rows[0].edges) != 1 || rows[0].edges[0] != 0 {
		t.Fatalf("first parent edge = %v, want [0]", rows[0].edges)
	}
}

func TestGraphMergeTakesAnotherLane(t *testing.T) {
	commits := []git.Commit{
		{Hash: "m", Parents: []string{"a", "b"}},
		{Hash: "b", Parents: []string{"root"}},
		{Hash: "a", Parents: []string{"root"}},
		{Hash: "root"},
	}
	rows := computeGraph(commits)
	if rows[0].lane != 0 {
		t.Fatalf("merge lane = %d, want 0", rows[0].lane)
	}
	if len(rows[0].edges) != 2 || rows[0].edges[0] == rows[0].edges[1] {
		t.Fatalf("parent lanes = %v, want two lanes", rows[0].edges)
	}
}

func TestFlattenFilesPutsFoldersFirstAndHidesClosedChildren(t *testing.T) {
	files := []git.RepoFile{{Path: "b.go"}, {Path: "a/x.go"}, {Path: "a/y.go"}}
	rows := flattenFiles(files, map[string]bool{})
	if len(rows) != 2 || rows[0].name != "a" || rows[1].name != "b.go" {
		t.Fatalf("rows = %+v", rows)
	}
	rows = flattenFiles(files, map[string]bool{"a": true})
	if len(rows) != 4 || rows[1].depth != 1 {
		t.Fatalf("open rows = %+v", rows)
	}
}

func TestResolveSimpleTextKeepsTheChangedSide(t *testing.T) {
	working := "a\n<<<<<<< HEAD\nbase\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> branch\nz\n"
	text, left := resolveSimpleText(working)
	if left != 0 {
		t.Fatalf("unresolved = %d, want 0", left)
	}
	if !strings.Contains(text, "theirs") {
		t.Fatalf("resolved text = %q", text)
	}
	if strings.Contains(text, "<<<<<<<") {
		t.Fatalf("markers remain: %q", text)
	}
}

func TestResolveSimpleTextLeavesTwoChangedSides(t *testing.T) {
	working := "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n"
	text, left := resolveSimpleText(working)
	if left != 1 {
		t.Fatalf("unresolved = %d, want 1", left)
	}
	if !strings.Contains(text, "<<<<<<<") || !strings.Contains(text, ">>>>>>>") {
		t.Fatalf("markers lost: %q", text)
	}
}

func TestWrapCommitMessageKeepsIndentAndWidth(t *testing.T) {
	got := wrapCommitMessage("subject\n\n  one two three four five", 12)
	for _, line := range strings.Split(got, "\n") {
		if len(line) > 12 {
			t.Fatalf("line %q is wider than 12", line)
		}
	}
	if !strings.Contains(got, "  one two") {
		t.Fatalf("indent lost: %q", got)
	}
}

func TestOffsetPositionRoundTrip(t *testing.T) {
	text := "a\n\nbç\n"
	for _, off := range []int{0, 1, 2, 3, 4, 6, len(text)} {
		line, char := offsetToLSP(text, off)
		got := positionToOffset(text, line, char)
		if got != off {
			t.Fatalf("offset %d -> %d:%d -> %d", off, line, char, got)
		}
	}
}
