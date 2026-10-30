package git

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestConsoleHelperProcess is not a test: it is the program the console runs
// in TestRunConsoleRunsAProgramOtherThanGit, so a non-git executable exists
// on every platform.
func TestConsoleHelperProcess(t *testing.T) {
	if os.Getenv("GITJET_CONSOLE_HELPER") != "1" {
		return
	}
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	fmt.Println("cwd=" + wd)
	fmt.Println("args=" + strings.Join(os.Args[1:], " "))
	fmt.Fprintln(os.Stderr, "on stderr")
}

// The console runs the line as typed. A git line keeps the repository flags
// and environment every other call uses, so the console and the UI cannot
// disagree about what git sees.
func TestRunConsoleRunsTheLineAsTyped(t *testing.T) {
	repo, dir := newTestRepo(t)
	writeFile(t, dir, "b.txt", "new\n")

	var lines []string
	res, err := repo.RunConsole(context.Background(), "git status --porcelain", func(line string) {
		lines = append(lines, line)
	})
	if err != nil {
		t.Fatalf("RunConsole: %v", err)
	}
	if res.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", res.ExitCode)
	}
	if !strings.Contains(res.Output, "b.txt") {
		t.Errorf("Output = %q, want the untracked file", res.Output)
	}
	if strings.TrimSpace(strings.Join(lines, "")) == "" {
		t.Error("no output was streamed")
	}

	// A bare subcommand is not git, and is not silently prefixed either.
	if _, err := repo.RunConsole(context.Background(), "status --porcelain", func(string) {}); err == nil {
		t.Error("a bare subcommand should not be run as git")
	}
}

// Any other program runs as typed, in the repository root, so the tree can be
// inspected while debugging: this is what makes "ls" and "pwd" useful.
func TestRunConsoleRunsAProgramOtherThanGit(t *testing.T) {
	repo, dir := newTestRepo(t)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GITJET_CONSOLE_HELPER", "1")

	// Forward slashes so the quotes in the line stay a quoting test and not a
	// test of how backslashes inside a string are escaped.
	var lines []string
	line := `"` + filepath.ToSlash(exe) + `" -test.run=TestConsoleHelperProcess`
	res, err := repo.RunConsole(context.Background(), line, func(l string) { lines = append(lines, l) })
	if err != nil {
		t.Fatalf("RunConsole: %v", err)
	}
	if res.ExitCode != 0 {
		t.Fatalf("exit code = %d, output = %q", res.ExitCode, res.Output)
	}
	out := strings.Join(lines, "\n")
	if !strings.Contains(out, "on stderr") {
		t.Errorf("stderr was not streamed with stdout: %q", out)
	}
	// The child reports the kernel's view of the directory, which on macOS
	// resolves /var to /private/var; compare the resolved paths.
	wantDir := strings.TrimSpace(dir)
	if resolved, err := filepath.EvalSymlinks(wantDir); err == nil {
		wantDir = resolved
	}
	if !strings.Contains(out, "cwd="+wantDir) {
		t.Errorf("cwd is not the repository root (%s): %q", dir, out)
	}
	if !strings.Contains(out, "-test.run=TestConsoleHelperProcess") {
		t.Errorf("arguments were not passed through: %q", out)
	}
}

// A program that cannot be found is reported as such: the user typed
// something that never ran, and an exit code with empty output hides that.
func TestRunConsoleReportsAnUnknownProgram(t *testing.T) {
	repo, _ := newTestRepo(t)
	if _, err := repo.RunConsole(context.Background(), "gitjet-no-such-program", func(string) {}); err == nil {
		t.Fatal("an unknown program was accepted")
	} else if !strings.Contains(err.Error(), "command not found") {
		t.Errorf("error = %q, want it to name the missing program", err)
	}
	if _, err := repo.RunConsole(context.Background(), "   ", func(string) {}); err == nil {
		t.Fatal("an empty line was accepted")
	}
}

// cd cannot work: the console keeps one working directory per run, and a
// silent no-op would be worse than saying so.
func TestRunConsoleExplainsCd(t *testing.T) {
	repo, dir := newTestRepo(t)
	_, err := repo.RunConsole(context.Background(), "cd ..", func(string) {})
	if err == nil {
		t.Fatal("cd was accepted")
	}
	if !strings.Contains(err.Error(), dir) {
		t.Errorf("error = %q, want it to name the directory commands run in", err)
	}
}

// A line that names another program completes against that program, not
// against git: `mvn cl` offers Maven goals and `go te` offers Go commands.
func TestConsoleCompletionsFollowTheProgram(t *testing.T) {
	repo, _ := newTestRepo(t)
	ctx := context.Background()

	mvn := repo.ConsoleCompletions(ctx, "mvn cl")
	if !hasCompletion(mvn, "clean") {
		t.Errorf("mvn cl = %v, want the clean goal", mvn)
	}
	if hasCompletion(mvn, "--oneline") {
		t.Errorf("mvn cl offered a git option: %v", mvn)
	}

	golang := repo.ConsoleCompletions(ctx, "go te")
	if !hasCompletion(golang, "test") {
		t.Errorf("go te = %v, want the test command", golang)
	}
	if hasCompletion(golang, "status") {
		t.Errorf("go te offered a git subcommand: %v", golang)
	}

	// The first word lists the programs the console can prefix with.
	programs := repo.ConsoleCompletions(ctx, "mv")
	if !hasCompletion(programs, "mvn") {
		t.Errorf("mv = %v, want mvn", programs)
	}
}

func hasCompletion(list []Completion, text string) bool {
	for _, c := range list {
		if c.Text == text {
			return true
		}
	}
	return false
}
