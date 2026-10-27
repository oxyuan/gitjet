package app

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"gitjet/internal/git"
)

// Settings is the app's configuration, persisted in the user's config
// directory. Repository-specific grouping and message history live in
// RepoMeta instead.
type Settings struct {
	// Version is the schema of this file, so a default that later changes
	// can be migrated once instead of guessed at forever.
	Version          int          `json:"version"`
	GitPath          string       `json:"gitPath"`
	Language         string       `json:"language"` // system, en, zh
	Theme            string       `json:"theme"`    // system, light, dark
	DiffContext      int          `json:"diffContext"`
	IgnoreWhitespace bool         `json:"ignoreWhitespace"`
	ShowIgnored      bool         `json:"showIgnored"`
	AutoFetch        bool         `json:"autoFetch"`
	AutoFetchMinutes int          `json:"autoFetchMinutes"`
	UpdateMethod     string       `json:"updateMethod"` // merge, rebase
	ConfirmForcePush bool         `json:"confirmForcePush"`
	ConfirmRollback  bool         `json:"confirmRollback"`
	OpenInNewWindow  bool         `json:"openInNewWindow"`
	UIScale          int          `json:"uiScale"` // percent, 100 is the design size
	Recent           []RecentRepo `json:"recent"`
}

// RecentRepo is a repository the user opened before.
type RecentRepo struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Opened int64  `json:"opened"`
}

// RepoMeta is the app's metadata for one repository: changelists, the
// active changelist, message history and UI state git does not store.
type RepoMeta struct {
	Active      string            `json:"active"`
	Changelists []git.Changelist  `json:"changelists"`
	Assignments map[string]string `json:"assignments"`
	Messages    []string          `json:"messages"`
	// PushTargets remembers the remote branches this repository pushed to,
	// newest first, so the push dialog starts where the user left off.
	PushTargets []string `json:"pushTargets"`
}

// settingsVersion is bumped whenever a stored default has to be rewritten;
// see the migration in loadSettings.
const settingsVersion = 2

func defaultSettings() Settings {
	return Settings{
		Version:          settingsVersion,
		Language:         "system",
		Theme:            "system",
		DiffContext:      -1,
		UpdateMethod:     "merge",
		ConfirmRollback:  true,
		ConfirmForcePush: true,
		AutoFetchMinutes: 15,
		UIScale:          100,
	}
}

func configDir() string {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "GitJet")
}

func settingsPath() string { return filepath.Join(configDir(), "settings.json") }

func loadSettings() Settings {
	s := defaultSettings()
	b, err := os.ReadFile(settingsPath())
	if err == nil {
		_ = json.Unmarshal(b, &s)
	}
	// The diff used to keep three lines; 2 makes the whole file the default.
	// Only a file older than that is rewritten, so choosing three by hand
	// afterwards sticks.
	if s.Version < 2 && s.DiffContext == 3 {
		s.DiffContext = -1
	}
	s.Version = settingsVersion
	s.clamp()
	return s
}

// clamp forces the values the app can render into their range. It runs on
// load and on every save, so a page cannot store something the diff engine
// would have to guess at.
func (s *Settings) clamp() {
	// -1 is the whole file, 1..100 is a window around each change; anything
	// else (a stale 0, a hand-edited number) goes back to the whole file.
	if s.DiffContext < -1 || s.DiffContext > 100 || s.DiffContext == 0 {
		s.DiffContext = -1
	}
	if s.Theme != "light" && s.Theme != "dark" {
		s.Theme = "system"
	}
	if s.UpdateMethod != "rebase" {
		s.UpdateMethod = "merge"
	}
	if s.AutoFetchMinutes <= 0 {
		s.AutoFetchMinutes = 15
	}
	if s.UIScale < 70 || s.UIScale > 160 {
		s.UIScale = 100
	}
}

func saveSettings(s Settings) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(settingsPath(), b)
}

func repoMetaPath(root string) string {
	sum := sha1.Sum([]byte(root))
	return filepath.Join(configDir(), "repos", hex.EncodeToString(sum[:])+".json")
}

func loadRepoMeta(root string) RepoMeta {
	meta := RepoMeta{
		Active:      "default",
		Assignments: map[string]string{},
		Changelists: []git.Changelist{{
			ID: "default", Name: "Default Changelist", Default: true,
		}},
	}
	if b, err := os.ReadFile(repoMetaPath(root)); err == nil {
		var stored RepoMeta
		if json.Unmarshal(b, &stored) == nil {
			if stored.Active != "" {
				meta.Active = stored.Active
			}
			if len(stored.Changelists) > 0 {
				meta.Changelists = stored.Changelists
			}
			if stored.Assignments != nil {
				meta.Assignments = stored.Assignments
			}
			meta.Messages = stored.Messages
		}
	}
	ensureMeta(&meta)
	return meta
}

func ensureMeta(meta *RepoMeta) {
	if meta.Assignments == nil {
		meta.Assignments = map[string]string{}
	}
	if len(meta.Changelists) == 0 {
		meta.Changelists = []git.Changelist{{ID: "default", Name: "Default Changelist", Default: true}}
	}
	found := false
	for _, cl := range meta.Changelists {
		if cl.ID == meta.Active {
			found = true
			break
		}
	}
	if !found {
		meta.Active = meta.Changelists[0].ID
	}
}

func saveRepoMeta(root string, meta RepoMeta) error {
	dir := filepath.Join(configDir(), "repos")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(repoMetaPath(root), b)
}

// writeFileAtomic writes a file through a temporary file in the same
// directory, so a crash leaves the previous version intact.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// core is the state shared by the bound services: the open repository,
// its metadata and the settings.
type core struct {
	mu       sync.Mutex
	repo     *git.Repo
	meta     RepoMeta
	settings Settings
	lastSig  string
	pollStop chan struct{}
	// lsp is the language server bridge for the open repository.
	lsp   *lspSession
	lspMu sync.Mutex
	// startup is the repository named on the command line, which wins over
	// the last one the app had open.
	startup string
}

func newCore() *core {
	return &core{settings: loadSettings()}
}

// uiLang is the language the native side should speak.
func (c *core) uiLang() lang {
	c.mu.Lock()
	defer c.mu.Unlock()
	return resolveLang(c.settings.Language)
}

func (c *core) currentRepo() (*git.Repo, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.repo == nil {
		return nil, errors.New("no repository is open")
	}
	return c.repo, nil
}

func (c *core) metaCopy() RepoMeta {
	c.mu.Lock()
	defer c.mu.Unlock()
	meta := c.meta
	meta.Assignments = make(map[string]string, len(c.meta.Assignments))
	for k, v := range c.meta.Assignments {
		meta.Assignments[k] = v
	}
	meta.Changelists = append([]git.Changelist(nil), c.meta.Changelists...)
	meta.Messages = append([]string(nil), c.meta.Messages...)
	return meta
}

func (c *core) saveMeta() error {
	c.mu.Lock()
	meta := c.meta
	root := ""
	if c.repo != nil {
		root = c.repo.Dir()
	}
	c.mu.Unlock()
	if root == "" {
		return nil
	}
	return saveRepoMeta(root, meta)
}

// snapshot builds what the commit tool window needs. Changelists get the
// paths of changes that no changelist claimed yet, in the active one.
func (c *core) snapshot(ctx context.Context, includeIgnored bool) (git.ChangesSnapshot, error) {
	repo, err := c.currentRepo()
	if err != nil {
		return git.ChangesSnapshot{}, err
	}
	status, err := repo.Status(ctx, includeIgnored)
	if err != nil {
		return git.ChangesSnapshot{}, err
	}
	snap := git.ChangesSnapshot{State: status.State, Changes: nonNilChanges(status.Changes)}
	if stashes, err := repo.Stashes(ctx); err == nil {
		if stashes == nil {
			stashes = []git.Stash{}
		}
		snap.Stashes = stashes
	}
	if snap.Stashes == nil {
		snap.Stashes = []git.Stash{}
	}
	conflicts := []git.Conflict{}
	for _, ch := range status.Changes {
		if ch.Unmerged {
			cf := git.Conflict{Path: ch.Path, Code: ch.ConflictCode}
			switch ch.ConflictCode {
			case "UU":
				cf.Base, cf.Ours, cf.Theirs = true, true, true
			case "AA":
				cf.Ours, cf.Theirs = true, true
			case "AU":
				cf.Ours = true
			case "UA":
				cf.Theirs = true
			case "DU":
				cf.Theirs = true
			case "UD":
				cf.Ours = true
			}
			conflicts = append(conflicts, cf)
		}
	}
	// Deduplicate conflict paths.
	seen := map[string]bool{}
	unique := conflicts[:0]
	for _, cf := range conflicts {
		if !seen[cf.Path] {
			seen[cf.Path] = true
			unique = append(unique, cf)
		}
	}
	snap.Conflicts = unique
	meta := c.metaCopy()
	changed := false
	for _, ch := range status.Changes {
		if ch.Kind == "ignored" {
			continue
		}
		if _, ok := meta.Assignments[ch.Path]; !ok {
			meta.Assignments[ch.Path] = meta.Active
			changed = true
		}
	}
	// Drop assignments for paths that no longer have changes.
	present := map[string]bool{}
	for _, ch := range status.Changes {
		present[ch.Path] = true
	}
	for p := range meta.Assignments {
		if !present[p] {
			delete(meta.Assignments, p)
			changed = true
		}
	}
	if changed {
		c.mu.Lock()
		c.meta.Assignments = meta.Assignments
		c.mu.Unlock()
		_ = c.saveMeta()
	}
	byList := map[string][]string{}
	for path, id := range meta.Assignments {
		byList[id] = append(byList[id], path)
	}
	items := make([]git.Changelist, 0, len(meta.Changelists))
	for _, cl := range meta.Changelists {
		paths := byList[cl.ID]
		sort.Strings(paths)
		cl.Paths = paths
		if cl.Paths == nil {
			cl.Paths = []string{}
		}
		items = append(items, cl)
	}
	snap.Changelists = git.Changelists{Active: meta.Active, Items: items}
	if snap.Changes == nil {
		snap.Changes = []git.Change{}
	}
	return snap, nil
}

func nonNilChanges(changes []git.Change) []git.Change {
	if changes == nil {
		return []git.Change{}
	}
	return changes
}

func (c *core) addRecent(root, name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now().Unix()
	var out []RecentRepo
	out = append(out, RecentRepo{Path: root, Name: name, Opened: now})
	for _, r := range c.settings.Recent {
		if r.Path == root {
			continue
		}
		out = append(out, r)
	}
	if len(out) > 20 {
		out = out[:20]
	}
	c.settings.Recent = out
	go func(s Settings) { _ = saveSettings(s) }(c.settings)
}

func (c *core) setMetaActive(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	found := false
	for _, cl := range c.meta.Changelists {
		if cl.ID == id {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("no changelist %q", id)
	}
	c.meta.Active = id
	return saveRepoMeta(c.repo.Dir(), c.meta)
}
