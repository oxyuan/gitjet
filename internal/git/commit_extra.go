package git

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
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
	parents, err := r.parents(ctx, "HEAD")
	if err != nil {
		return CommitResult{}, err
	}
	if len(parents) == 0 {
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
	Kind    string `json:"kind"` // crlf, large, name, detached
	Message string `json:"message"`
}

// CheckCommit looks for the problems IDEA warns about before a commit:
// CRLF line separators, very large files, names Windows cannot check out,
// and a detached HEAD.
func (r *Repo) CheckCommit(ctx context.Context, paths []string, opts CommitCheckOptions) ([]CommitWarning, error) {
	clean, err := cleanPaths(paths)
	if err != nil {
		return nil, err
	}
	warnings := []CommitWarning{}
	if opts.Detached {
		if out, err := r.run(ctx, "symbolic-ref", "-q", "--short", "HEAD"); err != nil || strings.TrimSpace(out) == "" {
			warnings = append(warnings, CommitWarning{Kind: "detached", Message: "HEAD is detached: the commit will not belong to a branch"})
		}
	}
	limit := opts.LargeFileMB * 1024 * 1024
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
				Message: fmt.Sprintf("%.1f MB is larger than the %d MB limit", float64(st.Size())/1024/1024, opts.LargeFileMB),
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
