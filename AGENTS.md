# Repository Guidelines

GitJet is a native desktop Git client: Go drives the real `git` executable and
parses its output; MyGo draws the window itself. There is no web frontend and
no git reimplementation. MyGo's native UI is the only presentation layer.

## Architecture & Data Flow

Three layers, one direction of control:

1. **`internal/git`** — the only package that executes git. `Repo` holds the
   worktree, executable, git dir and version; every method parses git output
   into plain JSON-tagged structs.
2. **`internal/app`** — the MyGo host and the native UI. `core` holds the open
   repository, metadata and settings. `Workspace` and `Git` are the service
   layer: the window calls their methods directly (they are no longer bound
   for a page). `ui_*.go` build the views; all UI state lives on the main
   thread, and blocking work runs on goroutines that return with
   `mygo.RunOnMain`.
3. **`internal/lsp`** — marker-based language-server detection and JSON-RPC
   framing. `internal/app/ui_lsp.go` is the protocol client.

Request path: view → `Git`/`Workspace` method → `git.Repo` →
`exec.CommandContext(git, "-C", dir, "--no-pager", …)` → parsed struct →
state on the main thread. MyGo redraws when `Window.Invalidate` is called or
a view invalidates itself.

Polling: `core.startPolling` reads status every 1.5 s while active and one
tick in six while inactive; a changed signature calls `core.changed`, which
posts a full reload to the native app. Mutations call `Git.notify`, which also
notifies the native view.

## Key Directories

| Path | Purpose |
|---|---|
| `internal/git/` | Git execution and parsing: `git.go`, `status.go`, `diff.go`, `log.go`, `actions.go`, `blame.go`, `console.go`, `files.go`, `repoinfo.go`, `rewrite.go`, `repo_extra.go`, `lifecycle.go`, `remotes.go`, `lines.go`, `patch.go`, `update.go`, `commit_extra.go`, `localhistory.go`, `commit_selected.go`, `cherry.go`, `images.go`, `trace.go` |
| `internal/app/` | Native host: `ui_app.go` (window, menu, state, reload), `ui_view.go` (shell, commit panel, branches, files, log, console), `ui_tabs.go` (diff/source tabs), `ui_dialogs.go` (dialogs), `ui_actions.go` (operations), `ui_conflict.go` (merge window), `ui_lsp.go`, `ui_graph.go`, `service.go`, `settings.go`, `run.go` (menu), `i18n.go`, `journal.go`, `lsp.go` |
| `internal/proc/` | `HideConsole` (`CREATE_NO_WINDOW` on Windows) for every console child |
| `internal/lsp/` | Language-server detection and message framing |
| `resources/` | `icon.png` |
| `mygo.json` | Native packaging config |

## Development Commands

```sh
go run .                      # run the native app
go tool mygo build            # package into build/<os>-<arch>/
go test ./... && go vet ./... # gate
GOOS=windows GOARCH=amd64 go build ./...
GOOS=darwin  GOARCH=arm64 go build ./...
GOOS=linux   GOARCH=amd64 go build ./...
```

No cgo anywhere; cross-compilation must keep working.

## Code Conventions

### Git execution (non-negotiable)

- All git access goes through `internal/git`. Never `exec.Command("git", …)`
  elsewhere.
- New commands go through `Repo.command` so they inherit `-C <worktree>`,
  `--no-pager`, `gitEnv()` and `proc.HideConsole`.
- `gitEnv()` (`LC_ALL=C`, `GIT_PAGER=cat`, `GIT_EDITOR=true`,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`) is load-bearing.
- Mutating service methods run through `preserveLocalChanges` where the old
  web UI did; `Reset` is deliberately not wrapped.
- Every operation opens a command trace (`git.WithCommandTrace`), so the
  console and journal show the real `$ git …` lines.
- Mutations are serialized by `Repo.write`. Use `writeRun` (locks) or lock
  manually; never call `writeRun` while already holding the lock.
- Parsers assume `status --porcelain=v2 -z`, NUL-separated records, and the
  rename origin as the *next* record. `%x1f`/`%x1e` are the field/record
  separators for log formats. Byte caps (8 MiB text, 2000 commits, 200
  quick-open files) are part of the contract.
- Page-supplied paths no longer exist; repository-relative paths still pass
  `cleanPath`/`cleanPaths`. Revisions and branch names reject empty values
  and a leading `-`.

### Native UI

- One window is one `mygo.NewWindow` with `Content: ui.View(a.view)`. Every
  view is rebuilt each frame from app state; never keep `ui.Element`s or
  `ui.Context`s in app state.
- All UI state is read and written on the main thread. Background work uses
  goroutines and returns with `mygo.RunOnMain`; call `Window.Invalidate` for
  a redraw.
- `ui.Split` for resizable panes, `ui.List` for virtual rows, `ui.Tree`/custom
  flattened rows for file trees, `ui.Tabs`/`ui.ButtonBase` for chrome,
  `ui.Modal` for dialogs, `ui.Menu`/`ContextMenu` for menus.
- Persistent view preferences belong in `Settings` (Go), not localStorage.
- `Settings` changes go through `Workspace.SaveSettings`; it clamps values and
  may reopen the repository when the git executable changes.
- The diff and source editor are `ui/editor`: `editor.DiffState` for diffs,
  `editor.State` for source. Diff texts for worktree/index targets are filled
  by `fillDiffTexts`, because git's own diff for those is a patch only.
- Blame in the source view is a painted column beside the editor, positioned
  from `LineTop`/`ScrollY`; diff blame uses `DiffState.Annotations`.
- LSP is optional: `ensureLSP` probes the repository, starts the server, and
  `ui_lsp.go` owns initialization, document sync, diagnostics, completions,
  hovers and definitions. The no-server fallback is `Git.SearchSymbol`.
- Dialogs live in `ui_dialogs.go`; add a `dialogKind`, a card builder and a
  branch in `dialogCard`. Confirmation actions go through `confirmDialog`.
- Counts and labels are copied from `ChangesSnapshot`/`RepoState`; never
  recompute git status in the view.

### i18n

- Each string is looked up with `a.t("key")`; `internal/app/i18n.go` holds the
  English and Chinese dictionaries. Add both in the same change.
- MyGo's own labels follow `Settings.Language` through `applyMenu` and
  `mygo.App.SetLocale`.

### TypeScript

There is no TypeScript. `src/` was removed with the web frontend.

## Testing & QA

Go: stdlib `testing` only. A real `git` on PATH is required; no skip guard.
`newTestRepo(t)` isolates `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` and the
author identity. Because it calls `t.Setenv`, do not add `t.Parallel`.
Name tests `Test<Situation><Expectation>`; table tests only for pure parsers.
`internal/app` has no tests today; the UI is exercised by running it.

Gate before finishing:

```sh
go test ./... && go vet ./...
```

Cross-builds run separately per GOOS/GOARCH.

## Known Rough Edges

- `internal/app` service methods are exported for the native window and are
  not bound to a page; keep their return types JSON-friendly only if a future
  page returns.
- The native editor ships 32 language definitions; uncommon files are plain
  text.
- `ui_editor` `GutterMark` is a dot, so the per-line blame text is a painted
  column rather than an editor gutter.
- Force-push to a protected branch is refused; ordinary commits ask first.
- The merge editor keeps Git markers for unresolved blocks and stages the
  result when every block is resolved or the user edited the result.
