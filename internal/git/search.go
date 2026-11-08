package git

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

// SymbolHit is one place a word appears in the working tree.
type SymbolHit struct {
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Text   string `json:"text"`
}

// SymbolSearch is the answer to a whole-word search over the working tree.
type SymbolSearch struct {
	Query     string      `json:"query"`
	Hits      []SymbolHit `json:"hits"`
	Truncated bool        `json:"truncated"`
}

// maxSymbolQuery keeps a pasted blob from becoming a regex-sized argument.
const maxSymbolQuery = 200

// SearchSymbol finds query as a whole word in every file of the working tree,
// tracked or not, and says where it is. It is the language-agnostic fallback
// for "find usages" when no language server answers: git grep is fast enough
// to run per click, and the page decides which hits look like definitions.
// One hit is reported per line, at the first occurrence, because git grep
// answers per line.
func (r *Repo) SearchSymbol(ctx context.Context, query string, limit int) (SymbolSearch, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return SymbolSearch{}, errors.New("nothing to search for")
	}
	if len(query) > maxSymbolQuery || strings.ContainsAny(query, "\r\n") {
		return SymbolSearch{}, errors.New("that is not a symbol")
	}
	if limit <= 0 {
		limit = 200
	}
	// -z keeps a path out of git's C quoting, --column asks git for the
	// column instead of guessing it from the text.
	out, err := r.run(ctx, "grep", "-n", "-z", "--column", "-I", "--no-color", "--full-name", "--untracked",
		"-w", "-F", "-e", query, "--", ".")
	if err != nil {
		// git grep exits 1 when nothing matched; that is an empty answer,
		// not a failure.
		var failure *Error
		if errors.As(err, &failure) && failure.Code == 1 {
			return SymbolSearch{Query: query, Hits: []SymbolHit{}}, nil
		}
		return SymbolSearch{}, err
	}
	result := SymbolSearch{Query: query, Hits: []SymbolHit{}}
	// Each match is "path\0line\0column\0text", one per line, with every
	// field raw: a path may hold a colon, a space or any UTF-8 byte.
	for _, record := range strings.Split(out, "\n") {
		if record == "" {
			continue
		}
		parts := strings.SplitN(record, "\x00", 4)
		if len(parts) < 4 {
			continue
		}
		number, err := strconv.Atoi(parts[1])
		if err != nil {
			continue
		}
		column, err := strconv.Atoi(parts[2])
		if err != nil {
			column = 0
		}
		if len(result.Hits) >= limit {
			result.Truncated = true
			break
		}
		result.Hits = append(result.Hits, SymbolHit{
			Path:   strings.TrimPrefix(parts[0], "./"),
			Line:   number,
			Column: column,
			Text:   parts[3],
		})
	}
	return result, nil
}
