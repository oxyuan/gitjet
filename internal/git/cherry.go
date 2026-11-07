package git

import (
	"context"
	"errors"
	"strings"
)

// CherryPicked reports which of the given commits have a patch-equivalent
// commit somewhere else in the repository, which is how IDEA shows that a
// commit was already cherry-picked. The comparison covers the newest 1500
// non-merge commits of every branch, which keeps the cost of a click
// bounded on a large history.
func (r *Repo) CherryPicked(ctx context.Context, hashes []string) ([]string, error) {
	clean := make([]string, 0, len(hashes))
	for _, hash := range hashes {
		hash = strings.TrimSpace(hash)
		if hash == "" || strings.HasPrefix(hash, "-") || strings.ContainsAny(hash, " \t\n") {
			continue
		}
		clean = append(clean, hash)
	}
	if len(clean) == 0 {
		return []string{}, nil
	}
	out, err := r.run(ctx, "log", "--all", "--no-merges", "--no-color", "-n", "1500",
		"--format=commit %H", "-p")
	if err != nil {
		return []string{}, err
	}
	if strings.TrimSpace(out) == "" {
		return []string{}, nil
	}
	ids, err := r.runInput(ctx, out, "patch-id", "--stable")
	if err != nil {
		return []string{}, err
	}
	byPatch := map[string][]string{}
	for _, line := range strings.Split(ids, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		byPatch[fields[0]] = append(byPatch[fields[0]], fields[1])
	}
	wanted := map[string]bool{}
	for _, hash := range clean {
		wanted[hash] = true
	}
	marked := []string{}
	for _, commits := range byPatch {
		if len(commits) < 2 {
			continue
		}
		for _, hash := range commits {
			if wanted[hash] {
				marked = append(marked, hash)
			}
		}
	}
	if len(marked) == 0 {
		return []string{}, nil
	}
	return marked, nil
}

// patchIDs is a helper for tests: the patch id of one commit.
func (r *Repo) patchIDs(ctx context.Context, hashes []string) (map[string]string, error) {
	clean, err := cleanRevisions(hashes)
	if err != nil {
		return nil, err
	}
	out, err := r.run(ctx, append([]string{"log", "--no-merges", "--no-color", "--format=commit %H", "-p"}, clean...)...)
	if err != nil {
		return nil, err
	}
	ids, err := r.runInput(ctx, out, "patch-id", "--stable")
	if err != nil {
		return nil, err
	}
	result := map[string]string{}
	for _, line := range strings.Split(ids, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			result[fields[1]] = fields[0]
		}
	}
	if len(result) == 0 {
		return nil, errors.New("no patch ids")
	}
	return result, nil
}
