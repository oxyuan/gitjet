package git

import (
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestSearchSymbolFindsWholeWordsOnly(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "main.go", "func Open() {}\n\nfunc OpenAll() { Open() }\n")
	writeFile(t, dir, "other.go", "// Open opens things.\nvar x = OpenAll\n")
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-qm", "files")

	got, err := repo.SearchSymbol(t.Context(), "Open", 0)
	if err != nil {
		t.Fatal(err)
	}
	if got.Truncated {
		t.Fatal("three hits should not truncate")
	}
	var places []string
	for _, hit := range got.Hits {
		places = append(places, filepath.ToSlash(hit.Path)+":"+strconv.Itoa(hit.Line)+":"+strconv.Itoa(hit.Column))
	}
	// One hit per line: git grep reports lines, not occurrences.
	want := []string{"main.go:1:6", "main.go:3:6", "other.go:1:4"}
	if strings.Join(places, " ") != strings.Join(want, " ") {
		t.Fatalf("hits = %v, want %v", places, want)
	}
}

func TestSearchSymbolIncludesUntrackedFiles(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "fresh.go", "func Brand() {}\n")

	got, err := repo.SearchSymbol(t.Context(), "Brand", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Hits) != 1 || got.Hits[0].Path != "fresh.go" || got.Hits[0].Line != 1 {
		t.Fatalf("hits = %+v", got.Hits)
	}
}

func TestSearchSymbolReportsNoMatchAsEmpty(t *testing.T) {
	repo, _ := newTestRepo(t)
	got, err := repo.SearchSymbol(t.Context(), "Nowhere", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Hits) != 0 || got.Query != "Nowhere" {
		t.Fatalf("got %+v", got)
	}
}

func TestSearchSymbolTruncatesAtLimit(t *testing.T) {
	repo, dir := newTestRepo(t)
	var lines strings.Builder
	for range 10 {
		lines.WriteString("hit Hit\n")
	}
	writeFile(t, dir, "many.txt", lines.String())

	got, err := repo.SearchSymbol(t.Context(), "Hit", 4)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Hits) != 4 || !got.Truncated {
		t.Fatalf("hits = %d, truncated = %v", len(got.Hits), got.Truncated)
	}
}

func TestSearchSymbolRejectsEmptyQuery(t *testing.T) {
	repo, _ := newTestRepo(t)
	if _, err := repo.SearchSymbol(t.Context(), "  ", 0); err == nil {
		t.Fatal("an empty query should be refused")
	}
	if _, err := repo.SearchSymbol(t.Context(), "two\nlines", 0); err == nil {
		t.Fatal("a query with a newline should be refused")
	}
}
