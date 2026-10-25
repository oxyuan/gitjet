package git

import (
	"context"
	"errors"
	"fmt"
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

// RunConsole runs a command line from the Git console and streams its
// output. The line may start with "git" or omit it; both forms are accepted.
func (r *Repo) RunConsole(ctx context.Context, command string, emit func(string)) (ConsoleResult, error) {
	res := ConsoleResult{Command: command, ExitCode: 0}
	start := time.Now()
	args, err := SplitCommandLine(command)
	if err != nil {
		return res, err
	}
	if len(args) == 0 {
		return res, errors.New("type a git command")
	}
	if args[0] == "git" {
		args = args[1:]
	}
	switch args[0] {
	case "cd", "exit", "clear", "history":
		return res, fmt.Errorf("%s is not a git command: the Git console runs in the repository root", args[0])
	}
	r.write.Lock()
	out, runErr := r.stream(ctx, emit, args...)
	r.write.Unlock()
	res.Output = out
	res.Duration = time.Since(start).Milliseconds()
	if runErr != nil {
		var gerr *Error
		if errors.As(runErr, &gerr) {
			res.ExitCode = gerr.Code
		} else {
			res.ExitCode = 1
		}
		return res, nil
	}
	return res, nil
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

// ConsoleCompletions suggests commands, options and refs for a prefix.
func (r *Repo) ConsoleCompletions(ctx context.Context, prefix string) []Completion {
	prefix = strings.TrimLeft(prefix, " ")
	word := prefix
	if i := strings.LastIndexAny(prefix, " \t"); i >= 0 {
		word = prefix[i+1:]
	}
	var out []Completion
	matches := func(s string) bool { return strings.HasPrefix(s, word) }
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
