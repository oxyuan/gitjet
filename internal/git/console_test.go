package git

import (
	"context"
	"strings"
	"testing"
)

// The console runs the line as typed. A bare subcommand is a mistake worth
// naming, not something to paper over with an invisible prefix.
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

	if _, err := repo.RunConsole(context.Background(), "status", func(string) {}); err == nil {
		t.Fatal("a line without git was accepted")
	} else if !strings.Contains(err.Error(), "start the line with git") {
		t.Errorf("error = %q, want it to ask for the git prefix", err)
	}
}

func TestRunConsoleRefusesShellCommands(t *testing.T) {
	repo, _ := newTestRepo(t)
	if _, err := repo.RunConsole(context.Background(), "git cd ..", func(string) {}); err == nil {
		t.Fatal("git cd was accepted")
	}
}
