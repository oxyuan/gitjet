# Repository Guidelines

GitJet is a desktop Git client. Go drives the real `git` executable and parses
its output; a React single-page app renders in the system WebView (WKWebView /
WebView2) through MyGo's typed IPC. There is no git reimplementation: hooks,
filters, credential helpers, signing and user config keep working because the
user's own git runs.

## Architecture & Data Flow

Three layers, one direction of control:

1. **`internal/git`** — the only package that executes git. `Repo` holds the
   worktree, executable, git dir and version; every method parses git output
   into plain JSON-tagged structs.
2. **`internal/app`** — the MyGo host. One shared `core` struct, two bound
   services (`Workspace`, `Git`), two events, on-disk settings/metadata, and a
   poll loop.
3. **`src`** — React UI. Calls `src/mygo.ts` (generated) and never composes git
   commands. Source files render in CodeMirror 6 (`src/editor.ts`), which loads
   its grammar lazily from `@codemirror/language-data`.

Request path: React → `call("Git.Stage", paths)` → bound method → `git.Repo` →
`exec.CommandContext(git, "-C", dir, "--no-pager", …)` → parsed struct → JSON →
promise.

Push direction: native menu accelerators broadcast `events.appCommand`
(`"commit"`, `"refresh"`, `"tab:console"`, …) and `AppShell.handleCommand`
switches on the string. `events.repoChanged` fires when the 1500 ms poll sees a
changed `status --porcelain=v2` signature, or after any mutation that calls
`Git.notify()`.

Long operations (`Push`, `Pull`, `Fetch`, `Console`) stream through a trailing
`out *mygo.Channel[string]` parameter. The page must consume the channel with
`for await` *before* awaiting the returned promise, or the call stalls.

There is no router, no state library, no ORM: dock/tab/dialog state lives in
`App.tsx` and flows down as props.

## Key Directories

|Path|Purpose|
|---|---|
|`internal/git/`|Git execution and parsing: `git.go` (spawn/env/paths), `status.go`, `diff.go`, `log.go`, `actions.go`, `blame.go`, `console.go`, `files.go`, `repoinfo.go`, `rewrite.go` (commit plan replay), `repo_extra.go` (worktrees, cleanup, submodules, LFS, shallow), `trace.go` (command echo), `exec_windows.go`|
|`internal/app/`|Host: `run.go` (window/menu/events), `service.go` (bound services, poll), `settings.go` (`core`, persistence), `i18n.go`, `lsp.go` (language server bridge)|
|`src/`|React UI; `*.test.ts` next to the module under test. `EditHistoryDialog.tsx` (rewrite plan) and `RepoExtrasDialog.tsx` (worktrees/submodules/LFS) are the only standalone dialogs; the rest live in `Dialogs.tsx`|
|`src/mygo.ts`|**Generated** bindings — never hand-edit|
|`resources/`|`icon.png` only, copied into the bundle by MyGo|
|`dist/`, `build/`, `.mygo/`|Build output, gitignored|

## Development Commands

```sh
bun install                  # only supported installer (bun.lock is frozen in CI)
bun run dev                  # mygo dev: generates bindings, runs Vite + native window
bun run generate             # regenerate src/mygo.ts after changing a bound type
bun run typecheck            # tsc --noEmit
bun run test:web             # bun test
bun run build:web            # tsc --noEmit && vite build
bun run build                # mygo build: bindings → web build → Go → package

go test ./... && go vet ./...
```

Cross-compilation must keep working (no cgo, everywhere):

```sh
GOOS=windows GOARCH=amd64 go build ./...
GOOS=darwin  GOARCH=arm64 go build ./...
```

`bun run dev:web` is Vite alone — no Go bindings, so every `call()` rejects;
use it only for layout work. Vite's port is pinned to 5173 in **both**
`vite.config.ts` and `mygo.config.ts` (`devUrl`) — change them together.

## Code Conventions & Common Patterns

### Git execution (non-negotiable)

- All git access goes through `internal/git`. Never `exec.Command("git", …)`
  elsewhere; the frontend never builds commands.
- New commands go through `Repo.command` so they inherit `-C <worktree>`,
  `--no-pager`, `gitEnv()` and `prepareCmd`.
- `gitEnv()` (`LC_ALL=C`, `GIT_PAGER=cat`, `GIT_EDITOR=true`,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`) is load-bearing: parsers and
  date ordering depend on the C locale, and `GIT_TERMINAL_PROMPT=0` stops the
  UI hanging on a credential prompt.
- Mutating service methods (`Checkout`, `Merge`, `Rebase`, `CherryPick`,
  `Revert`, `Pull` without `--autostash`, `Rewrite`) run through
  `preserveLocalChanges` (`internal/app/service.go`): a dirty tree is stashed
  as `gitjet: before <action>` and restored with `stash pop --index`; a failed
  restore keeps the stash and says so in the output. `Reset` is deliberately
  not wrapped — a hard reset is asked for to discard changes.
- `Rewrite` replays a plan of cherry-picks, so a conflict leaves the rest of
  the plan in `<git dir>/gitjet-rewrite-plan.json`; `ContinueOperation`
  finishes it and `AbortOperation` resets back to the original tip. Progress
  shows as the `rebase-interactive` operation.
- Every operation opens a command trace (`git.WithCommandTrace`), and its
  output ends with the `$ git …` lines the UI displays, so no command string
  is ever duplicated in TypeScript.
- Pushing to a differently named remote branch is a refspec
  (`refs/heads/a:refs/heads/b`), never a rename: `PushOptions.RemoteBranch`
  carries the target, `PushPreview` reports against that ref, and the dialog's
  editable target re-reads the preview (debounced).
- Mutations are serialized by `Repo.write`. Use `writeRun` (locks) or lock
  manually like `Rollback`/`Commit`; **never** call `writeRun` while already
  holding the lock — `sync.Mutex` is not reentrant. Read methods stay lock-free
  so a poll can run during a long push.
- Any `exec.Cmd` that runs a console program on Windows needs `prepareCmd`
  (`CREATE_NO_WINDOW`); otherwise the 1.5 s poll flashes console windows.
- Parsers assume `status --porcelain=v2 -z`, NUL-separated records, and the
  rename origin as the *next* record. `%x1f`/`%x1e` are the field/record
  separators for log formats. Byte caps (8 MiB text, 2000 commits, 200
  quick-open files) are part of the contract.

### Paths and arguments from the page

- Every page-supplied path passes `cleanPath`/`cleanPaths` (repo-relative,
  rejects absolute and `..`). Note `cleanPaths` **sorts and dedupes**.
- Revisions and branch names reject empty values and a leading `-`; branch
  creation/rename also round-trip `git check-ref-format --branch`.
- `internal/app` only adds its own check for `Reveal` (`filepath.Rel`).

### IPC and errors

- Bound methods return `(T, error)`; the page sees `err.message` verbatim, so
  write messages for humans. Payloads must be JSON-encodable with non-nil
  slices.
- `src/mygo.ts` is generated and committed: run `bun run generate` after
  changing a `mygo.Bind` type or event payload, and commit the diff.
- Frontend error handling: `fail(title, err)` → toast (errors 9 s, else 4 s);
  mutating calls go through `withBusy(fn, label)`; `busy` is a counter.
- Refresh is **never optimistic**: `await Git.x()` → `await reload(false)`
  re-fetches changes/refs/remotes. Add `g.notify()` in `internal/app` so the
  poll re-broadcasts.
- Streaming: build `new Channel<string>()`, start the promise, `for await` the
  lines, then await the promise for the summary.

### UI patterns

- Syntax colour has one source: `src/highlight.ts` exports the tag rules;
  `editor.ts` builds its `HighlightStyle` from them and `syntax.ts` builds the
  diff's class highlighter. Adding a token means one entry there plus a
  `.tok-*` class in `style.css` — never a second tag list.
- The diff paints itself with `paintLine` (tokens × word-diff), so a keyword
  that is also part of a changed word keeps its colour under the change mark.
  `FileDiff.language` is what selects the grammar; it is derived from the path.
- Pure logic lives in React-free modules with a colocated test: `diff.ts`,
  `graph.ts`, `changes.ts`, `branches.ts`, `merge.ts`, `explorer.ts`,
  `syntax.ts`, `paths.ts`, `tabs.ts`. Keep them free of `react`/`dom` imports.
- The dock's tab order is `gitjet.toolTabs`, a stored permutation repaired by
  `normalizeTabOrder` (unknown names dropped, missing ones appended). It is
  edited only in Settings → General ("Dock tabs"), whose arrows call
  `moveItem`; the strip is a plain list of buttons. The arrows write the order
  immediately — it is a view preference, not part of the dialog's draft.
- `useStoredState` (`src/ui.tsx`) persists view preferences under `gitjet.*`
  keys. Its setter takes a **value**, not an updater function. Settings are not
  localStorage — they live in Go (`<config dir>/GitJet/settings.json`).
- Adding a `Settings` field means: `internal/app/settings.go` (default +
  validation), regenerate bindings, and the inline fallback object in
  `App.tsx` (bootstrap failure path). Validation lives once, in
  `Settings.clamp()`, and runs on load *and* on save — the push of a page-sent
  object must not be able to store a value the diff engine would reject.
- `diffContext`: `-1` means the whole file (git gets `-U1000000`), `1..100`
  is a window. `FileDiff.wholeFile` tells the viewer which one it got, and
  `buildDiffRows` only folds long unchanged stretches when the diff is a
  window. A stored default that changes needs a `settingsVersion` bump and a
  migration in `loadSettings`, not a "if the value is X, change it" until.
- i18n has no key files: each component declares `const T = { en, zh }` and
  uses `useT(T)`. Add strings to both languages in the same dictionary;
  placeholders are `{name}`; plurals use `count(n, one, other)`.
- Styling: one hand-written `src/style.css` with CSS custom properties. It is
  append-layered — **the last occurrence of a selector wins**, so edit the last
  block, not the first. Theme tokens exist twice (explicit dark block *and* the
  `prefers-color-scheme` media block) — add new tokens to all three places or
  system-dark breaks. Class names are flat kebab-case with shared modifiers
  (`active`, `selected`, `muted`) applied via `cx(...)`. Inline styles only for
  dynamic geometry.
- Shortcuts are native menu accelerators in `internal/app/run.go` (`CmdOrCtrl`),
  not `keydown` handlers. To add one: menu item + `send("cmd")` + `case` in
  `App.handleCommand` + Go i18n label + README table.

### Editing and language servers

- The source pane is read-only CodeMirror: `EditorState.readOnly`,
  never `EditorView.editable(false)` — the latter makes the DOM unfocusable and
  kills the arrow keys, `⌘B` and copy.
- Change bars come from `Git.diff({target:"worktree"})` hunks, mapped to lines by
  `src/annotate.ts`; clicking a bar calls `Git.applyHunk(..., "rollback")` with
  the same hunk index. Blame comes from `Git.blame`, rendered on the cursor line.
- The editor's state fields must exist from construction (they start empty and
  are filled by effects). Dispatching an effect whose field is absent throws.
- `SourceView` is keyed by document id: without the key, React reuses the pane
  and the old CodeMirror instance keeps the previous file.
- Language servers are optional. `internal/lsp.Detect` maps repo markers to a
  server; `Git.lspStart/lspWrite/lspStop` move bytes between the page and the
  process over `events.gitLsp` (no sockets, no workers). Without a server,
  `Git.searchSymbol` (git grep) backs the same jumps, classified by
  `src/symbols.ts`.
- Attach the LSP plugin only when the server speaks the file's language
  (`lspServes`): a Go module with a `package.json` gets gopls, which must not
  receive TypeScript documents.

### TypeScript

`strict` **and** `noUncheckedIndexedAccess` are on: indexed access is
`T | undefined`, hence the pervasive `arr[i]!` and `?? fallback`. `tsc` runs
over `src` only — `src/**/*.test.ts` is excluded, so type errors in tests are
invisible to CI (and Bun strips types without checking). After regenerating
bindings, re-check hand-written test fixtures (`graph.test.ts`, `branches.test.ts`).

## Important Files

- `main.go` — entry; calls `app.Run`.
- `internal/app/run.go` — app name, bound services, events, window, menu.
- `internal/app/service.go` — `Workspace`/`Git` methods, `Bootstrap`, poll loop.
- `internal/app/settings.go` — `core`, `Settings`, per-repo `RepoMeta`
  (`<config dir>/GitJet/repos/<sha1(root)>.json`).
- `internal/git/git.go` — `Repo`, `Open`, `command`, `gitEnv`, `cleanPath`.
- `internal/git/status.go` — `ChangesSnapshot`, the shape the whole UI reads.
- `internal/git/actions.go` — every mutation (stage, commit, checkout, merge…).
- `src/App.tsx` — all app state, command dispatch, reload, op streaming.
- `src/ui.tsx` — primitives, `useStoredState`, toast, context menu.
- `src/style.css` — tokens and all layout.
- `mygo.config.ts` — dev URL, build commands, `bindings`, `out: "build"`.
- `.github/workflows/ci.yml` — the authoritative gate order.

## Runtime / Tooling Preferences

- Go **1.27.3** (`go.mod`, toolchain floor), module path `gitjet` (no domain).
- **Bun** is the package manager and test runner (no npm/yarn, no Vitest/Jest).
  TypeScript 7, Vite 8, React 19. No ESLint/Prettier/Biome/golangci config
  exists; formatting is 2-space, double quotes, trailing commas.
- `github.com/egoist/mygo` (Go) and `mygo-cli`/`mygo-runtime` (npm) are
  version-coupled at 0.6.4 — bump them together.
- No cgo anywhere (`purego` loads dylibs); platform code uses build-tagged
  files (`internal/git/exec_windows.go`, `internal/app/i18n_windows.go`), not
  runtime switches, for OS-only imports.
- App version appears in three places: `mygo.config.ts`, `package.json`, and
  the constant in `internal/app/service.go`.
- Windows needs WebView2 at runtime (not bundled). Builds are unsigned /
  ad-hoc signed; there is no auto-updater.
- A second window is a second process: `OpenInWindow` re-executes the binary
  with the repo path as `argv[1]`.
- In `mygo dev` the page origin is `localhost:5173`, so localStorage differs
  from the packaged app; settings in the config dir are shared (`SetName`
  unifies them).

## Testing & QA

Go: stdlib `testing` only, in `package git` (white-box), 3 files / 14 tests.
A **real `git` on PATH is required** — no skip guard. `newTestRepo(t)` is the
mandatory fixture: it isolates `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` and the
author identity and inits `main`; drive it with `runGit(t, dir, …)` and
`writeFile(t, dir, …)`. Because it calls `t.Setenv`, **do not add
`t.Parallel`**. Name tests `Test<Situation><Expectation>`; table tests only for
pure parsers (`TestSplitCommandLine`). `internal/app` has zero tests.

Web: `bun test`, `src/<module>.test.ts` mirroring `src/<module>.ts`, importing
`{ describe, expect, it } from "bun:test"`. Only pure modules are tested; there
is no jsdom/RTL/DOM harness, and adding React component tests would be new
territory. Fixtures are per-file factories; `noUncheckedIndexedAccess` forces
`!` in assertions.

Gate (CI order — run it before finishing):

```sh
go test ./... && go vet ./...
bun run typecheck && bun run test:web && bun run build:web
```

Cross-builds run separately per GOOS/GOARCH. No coverage thresholds, no
`-race`, no lint beyond `go vet`.

Test what can break (counters, kinds, ordering keys, `Exists`/`Tracked`,
hunk boundaries, lane geometry). Do not assert user-facing wording, git's
stderr prose, default setting values, or pixel trivia. Tests live beside the
subject, not 1:1 with source files.

Known gaps worth a test before trusting a change: `cleanPath` traversal
rejection, `internal/app` settings clamping and changelist CRUD, blame
porcelain parsing, push/pull/fetch flags, `operation()` for
rebase/am/cherry-pick, diff of renames and binary files, and the console's
`cd`/`exit` rejection.

## Known Rough Edges

- The README's directory listing is stale (`BranchPopup.tsx`, `LogPanel.tsx`
  do not exist; real names are `BranchList.tsx`, `LogDock.tsx`). Trust the
  filesystem.
- `Repo.prefix` is assigned in `Open` and never read.
- The Git console implies `git`: the page prepends it unless the line starts
  with `!` or already names `git`. Keep the input's `autoCapitalize="off"` —
  WebKit capitalises the first letter otherwise, and `Status` is not a
  builtin.
- Several errors are deliberately swallowed (stash listing, meta saves,
  corrupt `settings.json` → defaults); don't "fix" them blindly.
