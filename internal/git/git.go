// Package git runs the git command line and parses what it prints.
//
// GitJet drives the real git executable instead of reimplementing object
// storage, so hooks, filters, credential helpers, signing and every other
// configuration a user already has keep working. This package is the only
// place that runs commands; it returns plain types that the bound services
// hand to the page.
package git

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
)

// Error is a failed git command, with what git wrote to stderr.
type Error struct {
	Args   []string `json:"args"`
	Stderr string   `json:"stderr"`
	Stdout string   `json:"stdout"`
	Code   int      `json:"code"`
	Err    error    `json:"-"`
}

func (e *Error) Error() string {
	msg := strings.TrimSpace(e.Stderr)
	if msg == "" {
		msg = strings.TrimSpace(e.Stdout)
	}
	if msg == "" && e.Err != nil {
		msg = e.Err.Error()
	}
	if msg == "" {
		msg = fmt.Sprintf("git %s failed", strings.Join(e.Args, " "))
	}
	return msg
}

func (e *Error) Unwrap() error { return e.Err }

// Repo is a working tree and the git executable that operates on it.
// Construct one with Open; all methods are safe for concurrent use.
type Repo struct {
	dir     string
	git     string
	prefix  string // path from the git dir to the working tree, "" for the main tree
	gitDir  string
	version string
	// write serializes commands that change the repository, so that two
	// clicks never race for index.lock.
	write sync.Mutex
}

// Open resolves dir to the top of a git working tree and checks that git
// runs. gitPath may be empty, and then the first git found on PATH (or in
// the usual install locations) is used. A bare repository is rejected: the
// app is about working trees.
func Open(ctx context.Context, dir, gitPath string) (*Repo, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, errors.New("no folder was given")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	exe, err := findGit(gitPath)
	if err != nil {
		return nil, err
	}
	r := &Repo{dir: abs, git: exe}
	out, err := r.run(ctx, "rev-parse", "--show-toplevel")
	if err != nil {
		// Not a working tree: a bare repository has no top level.
		if bare, berr := r.run(ctx, "rev-parse", "--is-bare-repository"); berr == nil && strings.TrimSpace(bare) == "true" {
			return nil, errors.New("bare repositories are not supported: open a working tree instead")
		}
		return nil, fmt.Errorf("%s is not a git repository", abs)
	}
	top := strings.TrimSpace(strings.Split(out, "\n")[0])
	if top != "" {
		if resolved, err := filepath.Abs(top); err == nil {
			top = resolved
		}
		r.dir = top
	}
	if out, err := r.run(ctx, "rev-parse", "--show-prefix"); err == nil {
		r.prefix = strings.TrimSpace(out)
	}
	if out, err := r.run(ctx, "rev-parse", "--absolute-git-dir"); err == nil {
		r.gitDir = strings.TrimSpace(out)
	}
	if v, err := GitVersion(ctx, exe); err == nil {
		r.version = v
	}
	return r, nil
}

// Dir returns the absolute path of the working tree's top.
func (r *Repo) Dir() string { return r.dir }

// Git returns the path of the git executable.
func (r *Repo) Git() string { return r.git }

// GitDir returns the repository's git directory.
func (r *Repo) GitDir() string { return r.gitDir }

// Version returns the git version the repository was opened with.
func (r *Repo) Version() string { return r.version }

// AbsPath maps a repository-relative path to an absolute file path.
func (r *Repo) AbsPath(p string) string { return filepath.Join(r.dir, filepath.FromSlash(p)) }

// GitVersion returns the version of a git executable, such as "2.54.0".
func GitVersion(ctx context.Context, gitPath string) (string, error) {
	exe, err := findGit(gitPath)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, exe, "--version")
	prepareCmd(cmd)
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	fields := strings.Fields(string(out))
	if len(fields) < 3 {
		return strings.TrimSpace(string(out)), nil
	}
	return fields[2], nil
}

func findGit(gitPath string) (string, error) {
	if p := strings.TrimSpace(gitPath); p != "" {
		if resolved, err := exec.LookPath(p); err == nil {
			return resolved, nil
		}
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		return "", fmt.Errorf("git executable not found at %s", p)
	}
	if p, err := exec.LookPath("git"); err == nil {
		return p, nil
	}
	for _, p := range commonGitPaths() {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	return "", errors.New("git was not found: install git or set its path in Settings")
}

func commonGitPaths() []string {
	switch runtime.GOOS {
	case "windows":
		var paths []string
		for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramW6432")} {
			if root != "" {
				paths = append(paths, filepath.Join(root, "Git", "cmd", "git.exe"))
				paths = append(paths, filepath.Join(root, "Git", "bin", "git.exe"))
			}
		}
		if local := os.Getenv("LOCALAPPDATA"); local != "" {
			paths = append(paths, filepath.Join(local, "Programs", "Git", "cmd", "git.exe"))
		}
		return paths
	case "darwin":
		return []string{"/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"}
	default:
		return []string{"/usr/bin/git", "/usr/local/bin/git", "/bin/git"}
	}
}

// gitEnv is the environment of every command: no prompts, no pager, no
// editor, and messages in a locale this parser understands.
func gitEnv() []string {
	env := os.Environ()
	env = append(env,
		"LC_ALL=C",
		"LANG=C",
		"GIT_PAGER=cat",
		"PAGER=cat",
		"GIT_EDITOR=true",
		"GIT_SEQUENCE_EDITOR=true",
		"GIT_MERGE_AUTOEDIT=no",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_OPTIONAL_LOCKS=0",
		"GIT_FLUSH=1",
	)
	return env
}

func (r *Repo) command(ctx context.Context, args ...string) *exec.Cmd {
	full := append([]string{"-C", r.dir, "--no-pager"}, args...)
	cmd := exec.CommandContext(ctx, r.git, full...)
	cmd.Env = gitEnv()
	prepareCmd(cmd)
	return cmd
}

// run runs git and returns stdout. A failure carries stderr in *Error.
func (r *Repo) run(ctx context.Context, args ...string) (string, error) {
	cmd := r.command(ctx, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		code := -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return stdout.String(), &Error{Args: args, Stderr: stderr.String(), Stdout: stdout.String(), Code: code, Err: err}
	}
	return stdout.String(), nil
}

// runInput runs git with stdin, for apply and hash-object.
func (r *Repo) runInput(ctx context.Context, input string, args ...string) (string, error) {
	cmd := r.command(ctx, args...)
	cmd.Stdin = strings.NewReader(input)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		code := -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return stdout.String(), &Error{Args: args, Stderr: stderr.String(), Stdout: stdout.String(), Code: code, Err: err}
	}
	return stdout.String(), nil
}

// writeRun serializes a repository change and runs git.
func (r *Repo) writeRun(ctx context.Context, args ...string) (string, error) {
	r.write.Lock()
	defer r.write.Unlock()
	return r.run(ctx, args...)
}

// stream runs git and calls emit for every line it prints, stdout and
// stderr alike, until git exits. It returns git's full output and error.
// Git's progress messages end in carriage returns; those count as lines
// too, so a progress bar reaches the page as it changes.
func (r *Repo) stream(ctx context.Context, emit func(string), args ...string) (string, error) {
	cmd := r.command(ctx, args...)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw
	if err := cmd.Start(); err != nil {
		_ = pw.Close()
		return "", &Error{Args: args, Err: err}
	}
	var all strings.Builder
	done := make(chan struct{})
	go func() {
		defer close(done)
		scanner := bufio.NewScanner(pr)
		scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
		scanner.Split(splitProgress)
		for scanner.Scan() {
			line := scanner.Text()
			all.WriteString(line)
			all.WriteByte('\n')
			if emit != nil {
				emit(line)
			}
		}
	}()
	err := cmd.Wait()
	_ = pw.Close()
	<-done
	out := all.String()
	if err != nil {
		code := -1
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		}
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		return out, &Error{Args: args, Stderr: out, Stdout: out, Code: code, Err: err}
	}
	return out, nil
}

// splitProgress splits on newlines and carriage returns, dropping the
// latter, so that progress bars stream.
func splitProgress(data []byte, atEOF bool) (int, []byte, error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// ---- small helpers ----

// cleanPath validates a repository-relative path from the page and returns
// it with forward slashes. Paths that leave the working tree are rejected.
func cleanPath(p string) (string, error) {
	p = strings.TrimSpace(filepath.ToSlash(p))
	p = strings.TrimPrefix(p, "./")
	if p == "" || p == "." {
		return "", errors.New("empty path")
	}
	if strings.HasPrefix(p, "/") || filepath.IsAbs(p) {
		return "", fmt.Errorf("absolute paths are not allowed: %s", p)
	}
	clean := filepath.ToSlash(filepath.Clean(p))
	if clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("path leaves the repository: %s", p)
	}
	return clean, nil
}

func cleanPaths(paths []string) ([]string, error) {
	out := make([]string, 0, len(paths))
	seen := map[string]bool{}
	for _, p := range paths {
		c, err := cleanPath(p)
		if err != nil {
			return nil, err
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	sort.Strings(out)
	return out, nil
}

func atoi(s string) int {
	n := 0
	neg := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if i == 0 && c == '-' {
			neg = true
			continue
		}
		if c < '0' || c > '9' {
			return 0
		}
		n = n*10 + int(c-'0')
	}
	if neg {
		return -n
	}
	return n
}
