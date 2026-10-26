package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ConsoleResult is what a command typed in the Git console printed.
type ConsoleResult struct {
	Command  string `json:"command"`
	Output   string `json:"output"`
	ExitCode int    `json:"exitCode"`
	Duration int64  `json:"duration"` // milliseconds
}

// RunConsole runs a command line from the console and streams its output.
//
// The line runs as typed, in the repository root: "git status" and "ls -la"
// both work, because a console that only accepts one program cannot be used
// to look around the tree while debugging. Quoting follows a POSIX shell,
// but nothing else does — there is no pipe, no expansion and no redirection,
// so what runs is what is on the line.
func (r *Repo) RunConsole(ctx context.Context, command string, emit func(string)) (ConsoleResult, error) {
	res := ConsoleResult{Command: command, ExitCode: 0}
	start := time.Now()
	args, err := SplitCommandLine(command)
	if err != nil {
		return res, err
	}
	if len(args) == 0 {
		return res, errors.New("type a command, for example: git status")
	}
	r.write.Lock()
	out, runErr := r.runTyped(ctx, args, emit)
	r.write.Unlock()
	res.Output = out
	res.Duration = time.Since(start).Milliseconds()
	if runErr != nil {
		var gerr *Error
		if !errors.As(runErr, &gerr) {
			// Nothing ran: a line that names a program which does not exist
			// has to say so, not report an exit code and an empty output.
			return res, runErr
		}
		res.ExitCode = gerr.Code
	}
	return res, nil
}

// lookTyped finds the program a console line names. PATH comes first; if that
// fails, the directories Git for Windows installs beside git are searched too,
// so ls, cat, grep and friends work for anyone who has git and nothing else on
// PATH — the same binaries git's own shell uses.
func lookTyped(name, gitPath string) (string, error) {
	if exe, err := exec.LookPath(name); err == nil {
		return exe, nil
	}
	dir := filepath.Dir(gitPath)
	dirs := []string{
		filepath.Join(dir, "..", "usr", "bin"),
		filepath.Join(dir, "..", "bin"),
		filepath.Join(dir, "..", "..", "usr", "bin"),
		filepath.Join(dir, "..", "..", "bin"),
		filepath.Join(dir, "..", "..", "usr", "local", "bin"),
	}
	for _, d := range dirs {
		for _, candidate := range []string{name, name + ".exe"} {
			p := filepath.Join(d, candidate)
			if info, err := os.Stat(p); err == nil && !info.IsDir() {
				return p, nil
			}
		}
	}
	return "", exec.ErrNotFound
}

// runTyped runs one line typed into the console. A line that names git gets
// the same environment and repository flags as every other git call here, so
// the console and the UI cannot disagree about what git sees; anything else
// runs as the user typed it, with the repository root as its directory.
func (r *Repo) runTyped(ctx context.Context, args []string, emit func(string)) (string, error) {
	if args[0] == "git" {
		return r.streamCmd(ctx, r.command(ctx, args[1:]...), args[1:], emit)
	}
	exe, err := lookTyped(args[0], r.git)
	if err != nil {
		switch args[0] {
		case "cd", "exit":
			return "", fmt.Errorf("%s needs a shell: every command already runs in %s", args[0], r.dir)
		}
		return "", fmt.Errorf("%s: command not found", args[0])
	}
	cmd := exec.CommandContext(ctx, exe, args[1:]...)
	cmd.Dir = r.dir
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
	prepareCmd(cmd)
	return r.streamCmd(ctx, cmd, args, emit)
}

// SplitCommandLine splits a console line into arguments, following the
// quoting a POSIX shell would use for spaces, single quotes and double
// quotes. It is not a shell: no expansion, no pipes, no redirection.
func SplitCommandLine(line string) ([]string, error) {
	var args []string
	var cur strings.Builder
	inArg := false
	var quote byte
	escaped := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		if escaped {
			cur.WriteByte(c)
			inArg = true
			escaped = false
			continue
		}
		if quote == '\'' {
			if c == '\'' {
				quote = 0
			} else {
				cur.WriteByte(c)
			}
			continue
		}
		if quote == '"' {
			switch c {
			case '"':
				quote = 0
			case '\\':
				escaped = true
			default:
				cur.WriteByte(c)
			}
			continue
		}
		switch c {
		case '\\':
			escaped = true
			inArg = true
		case '\'':
			quote = '\''
			inArg = true
		case '"':
			quote = '"'
			inArg = true
		case ' ', '\t', '\n', '\r':
			if inArg {
				args = append(args, cur.String())
				cur.Reset()
				inArg = false
			}
		default:
			cur.WriteByte(c)
			inArg = true
		}
	}
	if escaped {
		cur.WriteByte('\\')
	}
	if quote != 0 {
		return nil, errors.New("the command has an unclosed quote")
	}
	if inArg {
		args = append(args, cur.String())
	}
	return args, nil
}

// Completion is one suggestion for the Git console.
type Completion struct {
	Text        string `json:"text"`
	Kind        string `json:"kind"` // command, option, ref, file
	Description string `json:"description"`
}

var gitCommands = []Completion{
	{"add", "command", "Add file contents to the index"},
	{"am", "command", "Apply a series of patches"},
	{"apply", "command", "Apply a patch"},
	{"blame", "command", "Show what revision and author last modified each line"},
	{"branch", "command", "List, create, or delete branches"},
	{"checkout", "command", "Switch branches or restore working tree files"},
	{"cherry-pick", "command", "Apply the changes introduced by some existing commits"},
	{"clean", "command", "Remove untracked files from the working tree"},
	{"commit", "command", "Record changes to the repository"},
	{"config", "command", "Get and set repository or global options"},
	{"diff", "command", "Show changes between commits, commit and working tree"},
	{"fetch", "command", "Download objects and refs from another repository"},
	{"for-each-ref", "command", "Output information on each ref"},
	{"log", "command", "Show commit logs"},
	{"merge", "command", "Join two or more development histories together"},
	{"mv", "command", "Move or rename a file, a directory, or a symlink"},
	{"pull", "command", "Fetch from and integrate with another repository"},
	{"push", "command", "Update remote refs along with associated objects"},
	{"rebase", "command", "Reapply commits on top of another base tip"},
	{"reflog", "command", "Manage reflog information"},
	{"remote", "command", "Manage set of tracked repositories"},
	{"reset", "command", "Reset current HEAD to the specified state"},
	{"restore", "command", "Restore working tree files"},
	{"revert", "command", "Revert some existing commits"},
	{"rev-parse", "command", "Pick out and massage parameters"},
	{"rm", "command", "Remove files from the working tree and from the index"},
	{"shortlog", "command", "Summarize git log output"},
	{"show", "command", "Show various types of objects"},
	{"stash", "command", "Stash the changes in a dirty working directory"},
	{"status", "command", "Show the working tree status"},
	{"submodule", "command", "Initialize, update or inspect submodules"},
	{"switch", "command", "Switch branches"},
	{"tag", "command", "Create, list, delete or verify a tag object"},
	{"worktree", "command", "Manage multiple working trees"},
}

var gitOptions = []Completion{
	{"--all", "option", "Show everything"},
	{"--amend", "option", "Amend the previous commit"},
	{"--cached", "option", "Use the index"},
	{"--force", "option", "Force the operation"},
	{"--force-with-lease", "option", "Force push only if the remote is as expected"},
	{"--no-verify", "option", "Skip pre-commit and commit-msg hooks"},
	{"--oneline", "option", "One line per commit"},
	{"--prune", "option", "Remove stale remote-tracking branches"},
	{"--rebase", "option", "Rebase instead of merge"},
	{"--set-upstream", "option", "Set the upstream of the branch"},
	{"--stat", "option", "Show a diffstat"},
	{"--tags", "option", "Include tags"},
	{"--untracked-files=all", "option", "Show every untracked file"},
	{"-a", "option", "All"},
	{"-b", "option", "Create a branch"},
	{"-m", "option", "Message"},
	{"-n", "option", "Dry run / number"},
	{"-p", "option", "Patch"},
	{"-u", "option", "Set upstream / include untracked"},
	{"-v", "option", "Verbose"},
}

// shellCommands are the programs worth suggesting after the console learned
// to run more than git. They are all read-only, so a mis-click in the
// completion popup cannot change the repository.
var shellCommands = []Completion{
	{"ls", "command", "List the files in the repository"},
	{"pwd", "command", "Print the directory commands run in"},
	{"cat", "command", "Print a file"},
	{"head", "command", "Print the first lines of a file"},
	{"tail", "command", "Print the last lines of a file"},
	{"wc", "command", "Count lines, words and bytes"},
	{"grep", "command", "Search the working tree"},
	{"find", "command", "Find files by name"},
	{"du", "command", "Show the size of files and directories"},
	{"git", "command", "Git command"},
}

// ConsoleCompletions suggests commands, options and refs for a prefix.
func (r *Repo) ConsoleCompletions(ctx context.Context, prefix string) []Completion {
	prefix = strings.TrimLeft(prefix, " ")
	word := prefix
	if i := strings.LastIndexAny(prefix, " \t"); i >= 0 {
		word = prefix[i+1:]
	}
	var out []Completion
	matches := func(s string) bool { return strings.HasPrefix(s, word) }
	firstWord := !strings.ContainsAny(prefix, " \t")
	if firstWord {
		// The first word is the program. Offering subcommands here would only
		// complete lines the console then refuses to run.
		for _, c := range shellCommands {
			if matches(c.Text) {
				out = append(out, c)
			}
		}
		return out
	}
	// Options and refs belong to git. On any other program they would suggest
	// flags it does not have.
	if strings.Fields(prefix)[0] != "git" {
		return nil
	}
	for _, c := range gitCommands {
		if matches(c.Text) {
			out = append(out, c)
		}
	}
	for _, o := range gitOptions {
		if matches(o.Text) {
			out = append(out, o)
		}
	}
	refs, err := r.Refs(ctx)
	if err == nil {
		for _, ref := range refs.Local {
			if matches(ref.Name) {
				out = append(out, Completion{Text: ref.Name, Kind: "ref", Description: ref.Subject})
			}
		}
		for _, ref := range refs.Remote {
			if matches(ref.Name) {
				out = append(out, Completion{Text: ref.Name, Kind: "ref", Description: ref.Subject})
			}
		}
		for _, ref := range refs.Tags {
			if matches(ref.Name) {
				out = append(out, Completion{Text: ref.Name, Kind: "ref", Description: ref.Subject})
			}
		}
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}
