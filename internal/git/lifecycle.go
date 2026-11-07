package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Clone clones url into dest, streaming git's progress. dest must not
// exist or must be an empty directory; the repository is cloned in place,
// which is what the "Clone" dialog's target folder means.
func Clone(ctx context.Context, gitPath, url, dest string, emit func(string)) (string, error) {
	url = strings.TrimSpace(url)
	dest = strings.TrimSpace(dest)
	if url == "" {
		return "", errors.New("a repository URL is required")
	}
	if strings.HasPrefix(url, "-") {
		return "", errors.New("the URL cannot start with a dash")
	}
	if dest == "" {
		return "", errors.New("a target folder is required")
	}
	abs, err := filepath.Abs(dest)
	if err != nil {
		return "", err
	}
	if st, err := os.Stat(abs); err == nil {
		if !st.IsDir() {
			return "", fmt.Errorf("%s is a file", abs)
		}
		entries, err := os.ReadDir(abs)
		if err != nil {
			return "", err
		}
		if len(entries) > 0 {
			return "", fmt.Errorf("%s is not empty: choose an empty folder or a new one", abs)
		}
	}
	exe, err := findGit(gitPath)
	if err != nil {
		return "", err
	}
	parent := filepath.Dir(abs)
	if _, err := os.Stat(parent); err != nil {
		return "", fmt.Errorf("%s does not exist", parent)
	}
	// A throwaway Repo gives the clone the same environment, trace and
	// streaming behaviour every other command has.
	r := &Repo{dir: parent, git: exe}
	return r.stream(ctx, emit, "clone", "--progress", "--", url, filepath.Base(abs))
}

// InitRepo creates a repository in dir, making the directory when it does
// not exist, and names the initial branch.
func InitRepo(ctx context.Context, gitPath, dir, branch string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", errors.New("a folder is required")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	if strings.HasPrefix(branch, "-") {
		return "", errors.New("invalid branch name")
	}
	exe, err := findGit(gitPath)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return "", err
	}
	r := &Repo{dir: abs, git: exe}
	if out := r.runQuiet(ctx, "rev-parse", "--show-toplevel"); out != "" {
		return "", fmt.Errorf("%s is already inside a git repository", abs)
	}
	args := []string{"init"}
	if _, err := r.run(ctx, "check-ref-format", "--branch", branch); err == nil {
		args = append(args, "-b", branch)
	}
	args = append(args, ".")
	return r.run(ctx, args...)
}

// runQuiet is run for probes whose failure is an answer.
func (r *Repo) runQuiet(ctx context.Context, args ...string) string {
	out, err := r.run(ctx, args...)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}
