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
	out, err := r.run(ctx, "grep", "-n", "-I", "--no-color", "--full-name", "--untracked",
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
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		// path:line:text — the path may itself contain a colon, the text
		// certainly does, so only the first two separators count.
		first := strings.IndexByte(line, ':')
		if first < 0 {
			continue
		}
		second := strings.IndexByte(line[first+1:], ':')
		if second < 0 {
			continue
		}
		second += first + 1
		number, err := strconv.Atoi(line[first+1 : second])
		if err != nil {
			continue
		}
		text := line[second+1:]
		column := strings.Index(text, query)
		if column < 0 {
			continue
		}
		if len(result.Hits) >= limit {
			result.Truncated = true
			break
		}
		result.Hits = append(result.Hits, SymbolHit{
			Path:   strings.TrimPrefix(line[:first], "./"),
			Line:   number,
			Column: column + 1,
			Text:   text,
		})
	}
	return result, nil
}
