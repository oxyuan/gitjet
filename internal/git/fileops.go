package git

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// cleanWorkPath is cleanPath plus the one path no file operation may touch:
// the git directory itself. Everything else under the working tree is fair
// game, including ignored files.
func cleanWorkPath(p string) (string, error) {
	clean, err := cleanPath(p)
	if err != nil {
		return "", err
	}
	if clean == ".git" || strings.HasPrefix(clean, ".git/") {
		return "", errors.New("the .git directory is not part of the working tree")
	}
	return clean, nil
}

// CreateFile creates an empty file, making missing parent directories. It
// refuses to truncate a path that already exists.
func (r *Repo) CreateFile(ctx context.Context, path string) error {
	clean, err := cleanWorkPath(path)
	if err != nil {
		return err
	}
	r.write.Lock()
	defer r.write.Unlock()
	abs := r.AbsPath(clean)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(abs, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return fmt.Errorf("%s already exists", clean)
		}
		return err
	}
	return f.Close()
}

// CreateDir creates a directory, making missing parents. An existing path is
// an error rather than a silent success, so the page can say why nothing new
// appeared.
func (r *Repo) CreateDir(ctx context.Context, path string) error {
	clean, err := cleanWorkPath(path)
	if err != nil {
		return err
	}
	r.write.Lock()
	defer r.write.Unlock()
	abs := r.AbsPath(clean)
	if _, err := os.Lstat(abs); err == nil {
		return fmt.Errorf("%s already exists", clean)
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(abs, 0o755)
}

// RenamePath moves a file or directory, keeping git's rename staging when
// git knows the source. Untracked paths are moved on disk and left alone.
func (r *Repo) RenamePath(ctx context.Context, from, to string) error {
	src, err := cleanWorkPath(from)
	if err != nil {
		return err
	}
	dst, err := cleanWorkPath(to)
	if err != nil {
		return err
	}
	if src == dst {
		return nil
	}
	r.write.Lock()
	defer r.write.Unlock()
	absDst := r.AbsPath(dst)
	if _, err := os.Lstat(absDst); err == nil {
		return fmt.Errorf("%s already exists", dst)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(absDst), 0o755); err != nil {
		return err
	}
	tracked := r.tracks(ctx, src)
	if tracked {
		if _, err := r.run(ctx, "mv", "--", src, dst); err == nil {
			return nil
		}
	}
	if err := os.Rename(r.AbsPath(src), absDst); err != nil {
		return err
	}
	if !tracked {
		return nil
	}
	// git refused the move (a mixed tracked/untracked directory, for one),
	// so stage the index side of the move by hand.
	_, err = r.run(ctx, "add", "-A", "--", src, dst)
	return err
}

// tracks reports whether git has an index entry at or below path.
func (r *Repo) tracks(ctx context.Context, path string) bool {
	_, err := r.run(ctx, "ls-files", "--error-unmatch", "--", path)
	return err == nil
}

// DeletePath removes a file or directory from disk and stages the deletion of
// anything git tracked there. Untracked content goes with it, which is what
// deleting the row means.
func (r *Repo) DeletePath(ctx context.Context, path string) error {
	clean, err := cleanWorkPath(path)
	if err != nil {
		return err
	}
	r.write.Lock()
	defer r.write.Unlock()
	tracked := r.tracks(ctx, clean)
	if err := os.RemoveAll(r.AbsPath(clean)); err != nil {
		return err
	}
	if !tracked {
		return nil
	}
	_, err = r.run(ctx, "add", "-A", "--", clean)
	return err
}
