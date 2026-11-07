package git

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// RemoteAdd adds a remote, failing when the name is taken.
func (r *Repo) RemoteAdd(ctx context.Context, name, url string) error {
	name, url, err := cleanRemote(name, url)
	if err != nil {
		return err
	}
	if r.remoteExists(ctx, name) {
		return fmt.Errorf("a remote named %q already exists", name)
	}
	_, err = r.writeRun(ctx, "remote", "add", name, url)
	return err
}

// RemoteSetURL points an existing remote at another URL.
func (r *Repo) RemoteSetURL(ctx context.Context, name, url string) error {
	name, url, err := cleanRemote(name, url)
	if err != nil {
		return err
	}
	if !r.remoteExists(ctx, name) {
		return fmt.Errorf("no remote named %q", name)
	}
	_, err = r.writeRun(ctx, "remote", "set-url", name, url)
	return err
}

// RemoteRemove deletes a remote and its remote-tracking refs.
func (r *Repo) RemoteRemove(ctx context.Context, name string) error {
	name = strings.TrimSpace(name)
	if name == "" || strings.HasPrefix(name, "-") {
		return errors.New("invalid remote")
	}
	if !r.remoteExists(ctx, name) {
		return fmt.Errorf("no remote named %q", name)
	}
	_, err := r.writeRun(ctx, "remote", "remove", name)
	return err
}

// RemoteRename renames a remote.
func (r *Repo) RemoteRename(ctx context.Context, oldName, newName string) error {
	oldName = strings.TrimSpace(oldName)
	newName = strings.TrimSpace(newName)
	if oldName == "" || newName == "" || strings.HasPrefix(oldName, "-") || strings.HasPrefix(newName, "-") {
		return errors.New("invalid remote")
	}
	if r.remoteExists(ctx, newName) {
		return fmt.Errorf("a remote named %q already exists", newName)
	}
	_, err := r.writeRun(ctx, "remote", "rename", oldName, newName)
	return err
}

func (r *Repo) remoteExists(ctx context.Context, name string) bool {
	for _, existing := range r.remoteNames(ctx) {
		if existing == name {
			return true
		}
	}
	return false
}

func cleanRemote(name, url string) (string, string, error) {
	name = strings.TrimSpace(name)
	url = strings.TrimSpace(url)
	if name == "" || strings.HasPrefix(name, "-") {
		return "", "", errors.New("a remote needs a name")
	}
	if strings.ContainsAny(name, " \t\n/") {
		return "", "", errors.New("a remote name cannot contain spaces or slashes")
	}
	if url == "" || strings.HasPrefix(url, "-") {
		return "", "", errors.New("a remote needs a URL")
	}
	if strings.ContainsAny(url, "\n\r") {
		return "", "", errors.New("the URL cannot contain a line break")
	}
	return name, url, nil
}
