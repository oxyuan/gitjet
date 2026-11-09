// Package git runs the git command line and parses what it prints.
//
// GitJet drives the real git executable instead of reimplementing object
// storage, so hooks, filters, credential helpers, signing and every other
// configuration a user already has keep working. This package is the only
// place that runs commands; it returns plain types that the bound services
// hand to the page.
package git

import (
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
	"strconv"
	"strings"
	"sync"

	"gitjet/internal/proc"
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
	// history serializes the local history index, which the poll and the
	// editor's save both append to.
	history sync.Mutex
	// sshCommand, when set, becomes GIT_SSH_COMMAND for every command.
	sshCommand string
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

// SetSSHCommand makes every command run the given SSH client, which is
// how a repository with a non-default key or agent is reached.
func (r *Repo) SetSSHCommand(command string) {
	command = strings.TrimSpace(command)
	if strings.ContainsAny(command, "\n\r") {
		return
	}
	r.sshCommand = command
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
	proc.HideConsole(cmd)
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
	recordCommand(ctx, args)
	full := append([]string{"-C", r.dir, "--no-pager"}, args...)
	cmd := exec.CommandContext(ctx, r.git, full...)
	env := gitEnv()
	if r.sshCommand != "" {
		env = append(env, "GIT_SSH_COMMAND="+r.sshCommand)
	}
	cmd.Env = env
	proc.HideConsole(cmd)
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

// runLimited runs git and keeps at most limit bytes of stdout. The command
// is killed as soon as that many bytes have arrived, so a 300 MB blob is
// never read into memory: callers that cap what they show get the cap
// instead of an allocation the size of the file.
func (r *Repo) runLimited(ctx context.Context, limit int, args ...string) (stdout string, truncated bool, err error) {
	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := r.command(runCtx, args...)
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		return "", false, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return "", false, &Error{Args: args, Err: err}
	}
	data, readErr := io.ReadAll(io.LimitReader(pipe, int64(limit)+1))
	if len(data) > limit {
		truncated = true
		data = data[:limit]
		// Nothing more is wanted; stop git rather than let it write into a
		// pipe nobody reads.
		cancel()
	}
	waitErr := cmd.Wait()
	if truncated {
		return string(data), true, nil
	}
	if readErr != nil {
		return string(data), false, &Error{Args: args, Err: readErr}
	}
	if waitErr != nil {
		code := -1
		var exit *exec.ExitError
		if errors.As(waitErr, &exit) {
			code = exit.ExitCode()
		}
		if ctx.Err() != nil {
			waitErr = ctx.Err()
		}
		return string(data), false, &Error{Args: args, Stderr: stderr.String(), Stdout: string(data), Code: code, Err: waitErr}
	}
	return string(data), false, nil
}

// runEnv runs git with extra environment variables, which is how a
// temporary index is used without changing anything else.
func (r *Repo) runEnv(ctx context.Context, extra []string, args ...string) (string, error) {
	cmd := r.command(ctx, args...)
	cmd.Env = append(cmd.Env, extra...)
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

// runEnvInput is runEnv with stdin.
func (r *Repo) runEnvInput(ctx context.Context, extra []string, input string, args ...string) (string, error) {
	cmd := r.command(ctx, args...)
	cmd.Env = append(cmd.Env, extra...)
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
//
// The command is the first line it emits: talking to a remote can stay
// silent for seconds while it connects, and the page has to show what it
// is waiting for.
func (r *Repo) stream(ctx context.Context, emit func(string), args ...string) (string, error) {
	if emit != nil {
		emit("$ " + renderCommand(args))
	}
	return r.streamCmd(ctx, r.command(ctx, args...), args, emit)
}

// streamCmd is stream for an already built command. The console uses it to
// run the programs a user types, which are not always git.
//
// The reader never stops before the pipe is closed: a bufio.Scanner gives
// up on a token wider than its buffer and leaves the writer blocked, which
// froze cmd.Wait and, through the write lock, every other command. Lines
// here have no length limit.
func (r *Repo) streamCmd(ctx context.Context, cmd *exec.Cmd, args []string, emit func(string)) (string, error) {
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
		buf := make([]byte, 64*1024)
		var pending []byte
		flush := func(line []byte) {
			all.Write(line)
			all.WriteByte('\n')
			if emit != nil {
				emit(string(line))
			}
		}
		for {
			n, readErr := pr.Read(buf)
			if n > 0 {
				pending = append(pending, buf[:n]...)
				// Progress bars end in a carriage return, so both break a
				// line; the carriage return itself is dropped.
				for {
					i := bytes.IndexAny(pending, "\r\n")
					if i < 0 {
						break
					}
					flush(pending[:i])
					_, pending = pending[:0], pending[i+1:]
				}
			}
			if readErr != nil {
				break
			}
		}
		if len(pending) > 0 {
			flush(pending)
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

// ---- small helpers ----

// unquoteGitPath removes the C-style quoting git applies to a path that
// contains control characters, spaces next to them, or bytes above ASCII.
// "rename from" prints that quoted form, and a quoted name is not a path.
func unquoteGitPath(p string) string {
	if len(p) < 2 || p[0] != '"' {
		return p
	}
	unquoted, err := strconv.Unquote(p)
	if err != nil {
		return p
	}
	return unquoted
}

// literalPath turns a repository path into a pathspec that names exactly
// that file. Git reads an ordinary path as a glob, so "web/[slug]/page.tsx"
// would also match "web/s/page.tsx" and stage the wrong file. Escaping is
// what every path-taking command understands; the ":(literal)" magic is
// rejected by blame.
func literalPath(p string) string {
	if !strings.ContainsAny(p, "*?[\\") {
		return p
	}
	var b strings.Builder
	b.Grow(len(p) + 4)
	for _, r := range p {
		if r == '*' || r == '?' || r == '[' || r == '\\' {
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// literalPaths is literalPath over a list.
func literalPaths(paths []string) []string {
	out := make([]string, len(paths))
	for i, p := range paths {
		out[i] = literalPath(p)
	}
	return out
}

// cleanPath validates a repository-relative path from the page and returns
// it with forward slashes. Paths that leave the working tree are rejected.
func cleanPath(p string) (string, error) {
	p = filepath.ToSlash(p)
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
