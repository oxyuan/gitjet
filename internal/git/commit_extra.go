package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// UndoCommit moves HEAD back one commit and leaves its changes in the
// index and the working tree, which is IDEA's "Undo Commit". The message
// comes back so the page can put it in the commit form again.
func (r *Repo) UndoCommit(ctx context.Context) (CommitResult, error) {
	r.write.Lock()
	defer r.write.Unlock()
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", "HEAD"); err != nil {
		return CommitResult{}, errors.New("there is no commit to undo")
	}
	subject := ""
	if out, err := r.run(ctx, "log", "-1", "--format=%s"); err == nil {
		subject = strings.TrimSpace(out)
	}
	message := ""
	if out, err := r.run(ctx, "log", "-1", "--format=%B"); err == nil {
		message = strings.TrimRight(out, "\n")
	}
	// Having no parent is not the same as being the root commit: a shallow
	// clone stops at a boundary commit, and deleting the ref there would
	// throw the whole branch away.
	if head, herr := r.run(ctx, "rev-parse", "HEAD"); herr == nil {
		if r.isShallowCommit(ctx, strings.TrimSpace(head)) {
			return CommitResult{}, errors.New("this is the first commit of a shallow clone: fetch more history before undoing it")
		}
	}
	parents, err := r.parents(ctx, "HEAD")
	if err != nil {
		return CommitResult{}, err
	}
	if len(parents) == 0 {
		// Deleting HEAD only works while HEAD names a branch; a detached
		// HEAD would lose the file itself.
		if _, err := r.run(ctx, "symbolic-ref", "-q", "HEAD"); err != nil {
			return CommitResult{}, errors.New("HEAD is detached and this is its first commit: nothing is left to undo it to")
		}
		// The root commit: dropping HEAD leaves everything staged, which
		// git spells as deleting the ref.
		if _, err := r.run(ctx, "update-ref", "-d", "HEAD"); err != nil {
			return CommitResult{}, err
		}
	} else {
		if _, err := r.run(ctx, "reset", "--soft", "HEAD^"); err != nil {
			return CommitResult{}, err
		}
	}
	return CommitResult{Subject: subject, Output: message}, nil
}

// isShallowCommit reports whether hash is one of the boundary commits a
// shallow clone stops at. Those look like root commits but are not.
func (r *Repo) isShallowCommit(ctx context.Context, hash string) bool {
	if hash == "" {
		return false
	}
	out, err := r.run(ctx, "rev-parse", "--is-shallow-repository")
	if err != nil || strings.TrimSpace(out) != "true" {
		return false
	}
	data, err := os.ReadFile(filepath.Join(r.gitDir, "shallow"))
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(line) == hash {
			return true
		}
	}
	return false
}

// CommitFixup records the staged changes as a fixup! or squash! commit for
// hash, which an autosquash rebase folds into it.
func (r *Repo) CommitFixup(ctx context.Context, hash string, squash bool) (CommitResult, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" || strings.HasPrefix(hash, "-") {
		return CommitResult{}, errors.New("invalid revision")
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", hash+"^{commit}"); err != nil {
		return CommitResult{}, fmt.Errorf("%s is not a commit", hash)
	}
	flag := "--fixup="
	if squash {
		flag = "--squash="
	}
	out, err := r.writeRun(ctx, "commit", "--no-verify", flag+hash)
	if err != nil {
		return CommitResult{}, err
	}
	res := CommitResult{Output: out}
	if h, err := r.run(ctx, "rev-parse", "HEAD"); err == nil {
		res.Hash = strings.TrimSpace(h)
		res.Short = short(res.Hash)
	}
	if subject, err := r.run(ctx, "log", "-1", "--format=%s"); err == nil {
		res.Subject = strings.TrimSpace(subject)
	}
	return res, nil
}

// ResolveSubject turns an exact commit subject into its hash. A subject
// shared by several commits is refused: picking one silently could fix up
// the wrong history.
func (r *Repo) ResolveSubject(ctx context.Context, subject string) (string, error) {
	subject = strings.TrimSpace(subject)
	if subject == "" || strings.HasPrefix(subject, "-") {
		return "", errors.New("a commit subject is required")
	}
	out, err := r.run(ctx, "log", "--all", "--format=%H%x1f%s")
	if err != nil {
		return "", err
	}
	matches := []string{}
	seen := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.SplitN(strings.TrimRight(line, "\r"), "\x1f", 2)
		if len(f) != 2 || strings.TrimSpace(f[1]) != subject {
			continue
		}
		hash := strings.TrimSpace(f[0])
		if hash != "" && !seen[hash] {
			seen[hash] = true
			matches = append(matches, hash)
		}
	}
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("no commit has the subject %q", subject)
	case 1:
		return matches[0], nil
	default:
		shorts := make([]string, 0, len(matches))
		for _, h := range matches {
			shorts = append(shorts, short(h))
		}
		return "", fmt.Errorf("%d commits have the subject %q (%s); pick one by hash", len(matches), subject, strings.Join(shorts, ", "))
	}
}

// CommitFixupBySubject records the staged changes as a fixup! or squash!
// commit for the one commit whose subject is exactly subject.
func (r *Repo) CommitFixupBySubject(ctx context.Context, subject string, squash bool) (CommitResult, error) {
	hash, err := r.ResolveSubject(ctx, subject)
	if err != nil {
		return CommitResult{}, err
	}
	return r.CommitFixup(ctx, hash, squash)
}

// AmendCommit folds the staged changes into an older commit and replays
// its descendants, which is IDEA's "Amend Commit" for a specific commit.
// It builds an "amend!" fixup commit from the index and runs an autosquash
// rebase, so hooks, signing and conflict handling stay git's own.
func (r *Repo) AmendCommit(ctx context.Context, hash, message string) (CommitResult, error) {
	hash = strings.TrimSpace(hash)
	if hash == "" || strings.HasPrefix(hash, "-") {
		return CommitResult{}, errors.New("invalid revision")
	}
	if _, err := r.run(ctx, "rev-parse", "--verify", "--quiet", hash+"^{commit}"); err != nil {
		return CommitResult{}, fmt.Errorf("%s is not a commit", hash)
	}
	if _, err := r.run(ctx, "merge-base", "--is-ancestor", hash, "HEAD"); err != nil {
		return CommitResult{}, fmt.Errorf("%s is not on the current branch", short(hash))
	}
	r.write.Lock()
	defer r.write.Unlock()
	if r.sequencerBusy() {
		return CommitResult{}, errors.New("finish the operation in progress before amending a commit")
	}
	if _, err := r.run(ctx, "diff", "--cached", "--quiet", "HEAD", "--"); err == nil {
		return CommitResult{}, errors.New("stage the changes to amend into " + short(hash))
	}
	subject := ""
	if out, err := r.run(ctx, "log", "-1", "--format=%s", hash); err == nil {
		subject = strings.TrimSpace(out)
	}
	// amend! makes autosquash replace both the content and the message of
	// the target; plain fixup keeps the target message.
	if strings.TrimSpace(message) == "" {
		if _, err := r.run(ctx, "commit", "--no-verify", "--fixup="+hash); err != nil {
			return CommitResult{}, err
		}
	} else {
		if _, err := r.run(ctx, "commit", "--no-verify", "--fixup=amend:"+hash); err != nil {
			return CommitResult{}, err
		}
		body := "amend! " + subject + "\n\n" + strings.TrimRight(message, "\n") + "\n"
		if _, err := r.runInput(ctx, body, "commit", "--amend", "--no-verify", "-F", "-"); err != nil {
			return CommitResult{}, err
		}
	}
	args := []string{"rebase", "-i", "--autosquash"}
	if parents, perr := r.parents(ctx, hash); perr == nil && len(parents) > 0 {
		args = append(args, hash+"^")
	} else {
		args = append(args, "--root")
	}
	env := []string{"GIT_SEQUENCE_EDITOR=true", "GIT_EDITOR=true"}
	if out, err := r.runEnv(ctx, env, args...); err != nil {
		return CommitResult{Output: strings.TrimSpace(out)}, err
	}
	res := CommitResult{}
	if h, err := r.run(ctx, "rev-parse", "HEAD"); err == nil {
		res.Hash = strings.TrimSpace(h)
		res.Short = short(res.Hash)
	}
	if s, err := r.run(ctx, "log", "-1", "--format=%s"); err == nil {
		res.Subject = strings.TrimSpace(s)
	}
	if res.Subject != "" {
		res.Output = fmt.Sprintf("%s %s", res.Short, res.Subject)
	}
	return res, nil
}

// CommitCheckOptions is what the settings say to look at before a commit.
type CommitCheckOptions struct {
	CRLF bool `json:"crlf"`
	// LargeFileMB warns about files above this many megabytes; zero is off.
	LargeFileMB int  `json:"largeFileMB"`
	BadNames    bool `json:"badNames"`
	Detached    bool `json:"detached"`
}

// CommitWarning is one problem found before committing.
type CommitWarning struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"` // crlf, large, name, detached, identity, empty, gpg, pinentry
	Message string `json:"message"`
}

// CheckCommit looks for the problems IDEA warns about before a commit:
// missing identity, an empty change set, GPG signing that cannot prompt,
// CRLF line separators, very large files, names Windows cannot check out,
// and a detached HEAD.
func (r *Repo) CheckCommit(ctx context.Context, paths []string, opts CommitCheckOptions) ([]CommitWarning, error) {
	clean, err := cleanPaths(paths)
	if err != nil {
		return nil, err
	}
	warnings := []CommitWarning{}
	if _, err := r.run(ctx, "var", "GIT_AUTHOR_IDENT"); err != nil {
		warnings = append(warnings, CommitWarning{
			Kind:    "identity",
			Message: "git has no user.name and user.email to sign this commit with; set them in Settings or git config",
		})
	}
	if st, serr := r.Status(ctx, false); serr == nil {
		changed := 0
		for _, c := range st.Changes {
			if !c.Unmerged && c.Kind != "ignored" {
				changed++
			}
		}
		if changed == 0 && !st.State.Unborn {
			warnings = append(warnings, CommitWarning{
				Kind:    "empty",
				Message: "there are no changes to commit",
			})
		}
	}
	if signed, _ := r.configBool(ctx, "commit.gpgsign"); signed {
		program := "gpg"
		if out, cerr := r.run(ctx, "config", "--get", "gpg.program"); cerr == nil {
			if p := strings.TrimSpace(out); p != "" {
				program = p
			}
		}
		if _, lerr := exec.LookPath(program); lerr != nil {
			warnings = append(warnings, CommitWarning{
				Kind:    "gpg",
				Message: fmt.Sprintf("commit.gpgsign is on but %s was not found on PATH", program),
			})
		} else if !hasPinentry() {
			warnings = append(warnings, CommitWarning{
				Kind:    "pinentry",
				Message: "commit.gpgsign is on but no pinentry program was found; signing may wait for a passphrase prompt GitJet cannot show",
			})
		}
	}
	if opts.Detached {
		if out, err := r.run(ctx, "symbolic-ref", "-q", "--short", "HEAD"); err != nil || strings.TrimSpace(out) == "" {
			warnings = append(warnings, CommitWarning{Kind: "detached", Message: "HEAD is detached: the commit will not belong to a branch"})
		}
	}
	limit := opts.LargeFileMB * 1024 * 1024
	lfsHint := ""
	if limit > 0 {
		if _, err := r.run(ctx, "lfs", "version"); err == nil {
			lfsHint = "; consider Git LFS"
		}
	}
	for i, path := range clean {
		if i > 2000 {
			break
		}
		abs := r.AbsPath(path)
		st, err := os.Stat(abs)
		if err != nil || st.IsDir() {
			continue
		}
		if opts.BadNames {
			if bad := badPathName(path); bad != "" {
				warnings = append(warnings, CommitWarning{Path: path, Kind: "name", Message: bad})
			}
		}
		if limit > 0 && st.Size() > int64(limit) {
			warnings = append(warnings, CommitWarning{
				Path:    path,
				Kind:    "large",
				Message: fmt.Sprintf("%.1f MB is larger than the %d MB limit%s", float64(st.Size())/1024/1024, opts.LargeFileMB, lfsHint),
			})
		}
		if opts.CRLF && st.Size() <= 4*1024*1024 {
			if data, err := os.ReadFile(abs); err == nil && hasCRLF(data) {
				warnings = append(warnings, CommitWarning{Path: path, Kind: "crlf", Message: "the file uses CRLF line separators"})
			}
		}
	}
	return warnings, nil
}

// configBool reads one boolean git config value.
func (r *Repo) configBool(ctx context.Context, key string) (bool, error) {
	out, err := r.run(ctx, "config", "--bool", "--get", key)
	if err != nil {
		return false, err
	}
	switch strings.TrimSpace(out) {
	case "true", "yes", "on", "1":
		return true, nil
	}
	return false, nil
}

// hasPinentry reports whether a pinentry program git's GPG can use is on
// PATH. GitJet has no terminal of its own, so signing that needs a console
// prompt would wait forever.
func hasPinentry() bool {
	for _, name := range []string{"pinentry", "pinentry-mac", "pinentry-gnome3", "pinentry-gtk-2", "pinentry-curses"} {
		if _, err := exec.LookPath(name); err == nil {
			return true
		}
	}
	return false
}

// badPathName reports the part of a path Windows cannot check out. The
// check is about the repository, not the host, so a Windows user can still
// clone what a macOS user committed.
func badPathName(path string) string {
	for _, part := range strings.Split(filepath.ToSlash(path), "/") {
		if part == "" {
			continue
		}
		if strings.ContainsAny(part, `<>:"|?*`) {
			return fmt.Sprintf("%q contains a character Windows does not allow", part)
		}
		if strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return fmt.Sprintf("%q ends with a dot or a space", part)
		}
		base := part
		if i := strings.IndexByte(base, '.'); i > 0 {
			base = base[:i]
		}
		switch strings.ToUpper(base) {
		case "CON", "PRN", "AUX", "NUL",
			"COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
			"LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9":
			return fmt.Sprintf("%q is a reserved name on Windows", part)
		}
	}
	return ""
}

// hasCRLF says whether a text file still has CRLF separators. A file with
// a NUL byte is binary and has no line separators to warn about.
func hasCRLF(data []byte) bool {
	if bytes.IndexByte(data, 0) >= 0 {
		return false
	}
	return bytes.Contains(data, []byte("\r\n"))
}
