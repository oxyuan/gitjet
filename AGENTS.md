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
switches on the string; `"open:<path>"` is a repository the system opened (see
below). `events.repoChanged` fires when the poll sees a changed
`status --porcelain=v2` signature, or after any mutation that calls
`Git.notify()`. The poll reads every 1.5 s while the app is active and one
tick in six while it is not, and reads at once when the app becomes active.

Long operations (`Push`, `Pull`, `Fetch`, `Console`) stream through a trailing
`out *mygo.Channel[string]` parameter. The page must consume the channel with
`for await` *before* awaiting the returned promise, or the call stalls.

There is no router, no state library, no ORM: dock/tab/dialog state lives in
`App.tsx` and flows down as props.

## Key Directories

|Path|Purpose|
|---|---|
|`internal/git/`|Git execution and parsing: `git.go` (spawn/env/paths), `status.go`, `diff.go`, `log.go`, `actions.go`, `blame.go`, `console.go`, `files.go`, `repoinfo.go`, `rewrite.go` (commit plan replay), `repo_extra.go` (worktrees, cleanup, submodules, LFS, shallow), `lifecycle.go` (clone/init), `remotes.go`, `lines.go` (line-level patches), `patch.go` (patches and shelves), `update.go` (update/push subsets), `commit_extra.go` (undo, fixup, commit checks), `localhistory.go` (content snapshots), `commit_selected.go` (the commit machinery: temporary index, real `git commit`), `cherry.go` (patch-id marks), `images.go` (image bytes), `trace.go` (command echo)|
|`internal/proc/`|`HideConsole` (`internal/proc`, `CREATE_NO_WINDOW` on Windows): applied to every console child GitJet starts|
|`internal/app/`|Host: `run.go` (window/menu/events, recents, window tracking), `contextmenu.go` (the page's right-click menu), `service.go` (bound services, poll), `settings.go` (`core`, persistence), `i18n.go`, `lsp.go` (language server bridge)|
|`src/`|React UI; `*.test.ts` next to the module under test. `EditHistoryDialog.tsx` (rewrite plan) and `RepoExtrasDialog.tsx` (worktrees/submodules/LFS) are the only standalone dialogs; the rest live in `Dialogs.tsx`. Navigation is `navigation.ts` (LSP location normalization, usage grouping and history), `TargetPopup.tsx` (the multiple-declaration chooser), `SymbolPanel.tsx` (the grouped, filtered usage list) and `NotificationCenter.tsx` (the status bar bell and session notice history)|
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
bun run build                # prebuild guard → mygo build: bindings → web build → Go → package

go test ./... && go vet ./...
```

`bun run build` first runs `scripts/prebuild.ts`, which stops any process running
from `build/` (Windows cannot rename a directory whose executable is mapped, and
`mygo build` renames `build/<platform>` before recompiling). The guard probes
with a write-capable open, so it costs nothing when nothing is running.

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
  `--no-pager`, `gitEnv()` and `proc.HideConsole`.
- `gitEnv()` (`LC_ALL=C`, `GIT_PAGER=cat`, `GIT_EDITOR=true`,
  `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`) is load-bearing: parsers and
  date ordering depend on the C locale, and `GIT_TERMINAL_PROMPT=0` stops the
  UI hanging on a credential prompt.
- `SaveShelf` captures `git diff HEAD` and verifies it reverse-applies before
  discarding anything: a shelf that skipped the index, as plain `git diff`
  does, lost every staged change to the `reset --hard` that followed.
  `includeUntracked` marks new files intent-to-add for one diff, then resets
  the markers. A shelf also stores the HEAD→index patch, so applying it
  restores which hunks were staged instead of flattening everything into
  the working tree; new files and staged files are covered alike.
- `CommitOptions.StagedOnly` commits the real index and ignores the path
  list (the UI's "Commit staged only"); `CommitAllChanges` enumerates every
  changed path, untracked included, for "Commit All".
- `CheckCommit` always adds the identity, empty-change and GPG checks:
  `git var GIT_AUTHOR_IDENT` failing, a clean status, `commit.gpgsign` with
  a missing `gpg.program`, and signing with no pinentry on PATH (GitJet has
  no terminal to prompt in). The old CRLF/large/name/detached checks stay.
- `CommitFixupBySubject` resolves an exact subject only when one commit
  carries it; `AmendCommit` creates an `amend!` fixup from the staged
  changes and autosquashes with a no-op sequence editor, so descendants are
  replayed by git and a conflict leaves the rebase for Continue/Abort.
- The log page carries its exact `git log` command, and `LogOptions.Refs`
  accepts several refs — the history's branch filter is a multi-select, not
  a single branch.
- A rewrite plan accepts `exec` and `break` steps between commits. `exec`
  runs the user's shell line in the working tree; a failed command or a
  break leaves the plan paused, and Continue skips the failed exec/break.
  `planIsCurrent` treats those steps as current when no cherry-pick is
  pending, because they have no commit to compare.
- A rewrite plan records its branch (`planState.Branch`) and the step git is
  stopped on; `planIsCurrent` accepts it only while `CHERRY_PICK_HEAD` is
  that step (or the plan is paused on that branch). A stale plan is cleared
  without moving HEAD; replaying or aborting it used to reset whatever
  branch happened to be checked out.
- A commit is index-aware: a checked path with a staged change commits the
  index entry, a path with nothing staged is added to a temporary index from
  the working tree, and `git commit` runs, so hooks, signing, `commit.gpgsign`
  and `--amend`'s author preservation are the user's own. A merge,
  cherry-pick or revert commits the real index (git refuses a partial commit
  during one). `Commit` and `CommitSelected` share this machinery in
  `commit_selected.go`.
- Mutating service methods (`Checkout`, `Merge`, `Rebase`, `CherryPick`,
  `Revert`, `Pull` without `--autostash`, `Rewrite`) run through
  `preserveLocalChanges` (`internal/app/service.go`): a dirty tree is stashed
  as `gitjet: before <action>` and restored with `stash pop --index`; the
  entry is found by that message, not assumed to be `stash@{0}`. When the
  operation stops with unmerged paths the stash is deliberately kept (git
  cannot pop into an unmerged index) and the output names it; a failed
  restore keeps the stash and says so. `Reset` is deliberately
  not wrapped — a hard reset is asked for to discard changes.
- Conflict resolution has two entry points that share one repository call:
  `MergePreview` merges the three index stages with `MergeText` (a diff3
  implementation in `threemerge.go`, verified against `git merge-file`), and
  `ResolveInMemory` writes the blob with `hash-object --path` (filters
  included) and replaces the index entry through `update-index --index-info`.
  `SaveResolution` stages the bytes it was handed, never what is on disk.
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
  editable target re-reads the preview (debounced). The dialog starts from
  the branch's configured upstream, not `origin/<local name>`, and only
  proposes `-u` when the branch has no upstream. A detached HEAD pushes
  `HEAD:refs/heads/<target>`.
- Branch cleanup tries `-d` per branch and asks before replacing the
  unmerged remainder with `-D`; it is never a silent force delete.
- Mutations are serialized by `Repo.write`. Use `writeRun` (locks) or lock
  manually like `Rollback`/`Commit`; **never** call `writeRun` while already
  holding the lock — `sync.Mutex` is not reentrant. Read methods stay lock-free
  so a poll can run during a long push.
- Any `exec.Cmd` that runs a console program on Windows needs `proc.HideConsole`
  (`CREATE_NO_WINDOW`, `internal/proc`); otherwise the 1.5 s poll flashes
  console windows and each language server pops one open.
- Parsers assume `status --porcelain=v2 -z`, NUL-separated records, and the
  rename origin as the *next* record. `%x1f`/`%x1e` are the field/record
  separators for log formats. Byte caps (8 MiB text, 2000 commits, 200
  quick-open files) are part of the contract.

### Paths and arguments from the page

- Every page-supplied path passes `cleanPath`/`cleanPaths` (repo-relative,
  rejects absolute and `..`). Note `cleanPaths` **sorts and dedupes**;
  whitespace is part of a git path and is never trimmed.
- Line-level staging takes **signed** line numbers: positive is the new
  side, negative the old side, so an added line 5 cannot select the deleted
  line 5. `ApplyDiffLines` rebuilds the target file from the selection
  instead of applying zero-context patches, which is what makes scattered
  lines and unequal blocks exact.
- A path handed to git as a pathspec goes through `literalPath`: git reads
  `web/[slug]/page.tsx` as a glob and would touch `web/s/page.tsx` too.
  Escaping, not `:(literal)` magic, because `blame` rejects the magic.
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
- A changed run is aligned by content, not by position: `worddiff.ts` ports
  `ByWordRt.compareAndSplit` (words and newlines diffed together, the
  punctuation matcher, the whitespace corrector and `LineFragmentSplitter`),
  so an inserted line no longer steals the word marks from the line after it.
  `buildDiffRows` turns each returned block into rows; a block's character
  ranges are relative to the block text, and `segmentsForLine` cuts them per
  line. Verified block-for-block against the IDE's own `ByWordRt` output.
- Pure logic lives in React-free modules with a colocated test: `diff.ts`,
  `graph.ts`, `changes.ts`, `branches.ts`, `merge.ts`, `explorer.ts`,
  `syntax.ts`, `paths.ts`, `tabs.ts`, `myers.ts`, `ideaDiff.ts`,
  `worddiff.ts`, `wordmerge.ts`, `search.ts`. Keep them free of `react`/`dom`
  imports.
- The conflict view's wand resolves a range with the IDE's own text merge:
  `wordmerge.ts` ports `MergeResolveUtil.tryResolve` (word/newline chunks,
  whitespace-sensitive pass then a whitespace-ignoring one), and `ideaDiff.ts`
  ports `com.intellij.util.diff.Diff` so the alignments match the IDE's.
  Modify/delete conflicts are not auto-resolvable there, exactly as in IDEA:
  they need a side choice. `merge.ts`'s `tryResolveRange` is the one entry
  point; `myers.ts` stays the line diff behind the merge view.
- The diff viewer never drops a line: `buildDiffRows` returns every row and
  `foldRanges` / `visibleRows` (`src/diff.ts`) hide unchanged runs at render
  time, keeping `FOLD_CONTEXT` lines beside each change and none at the file
  edges. A marker reopens exactly its run; the toolbar toggle persists as
  `gitjet.diffFoldUnchanged`. Row indices stay the model's, so selection and
  the apply arrows survive folding, and a hunk's chevron sits on its first
  *visible* row. Wrap is real: `.diff-body.wrap` reflows the text; unwrapped,
  the viewer sets `--diff-left-w` / `--diff-right-w` from `lineWidth`, so a
  line wider than its half scrolls instead of being clipped.
- Ignore-differences is one policy, not flags: `DiffOptions.Whitespace` is
  `none`, `trim` (`--ignore-space-change`), `whitespace` (`-w`) or
  `whitespace-blank` (`-w --ignore-blank-lines`), and the diff toolbar's menu
  mirrors IDEA's four choices.
- The diff viewer follows IDEA's other two view settings as well.
  `gitjet.diffHighlight` is `lines`, `words`, `chars` or `none`
  (`HighlightPolicy`): `buildDiffRows` still aligns a changed run, but only
  computes inner segments for words/chars, and `none` paints no bands at all.
  Word segments carry a kind (`WordSegment.kind`), so a run present on both
  sides is a modification and a one-sided run is a deletion or an insertion;
  the split viewer bands a changed pair in `--diff-mod-bg` and marks moved
  text in `--diff-mod-word`, while the unified viewer keeps the deleted and
  inserted colours IDEA's unified chunk highlighters use. The palette is
  IDEA's own `DIFF_DELETED` (grey), `DIFF_INSERTED` (green) and
  `DIFF_MODIFIED` (blue) trio (the bands are the tone mixed into the editor,
  the word marks take it undiluted), defined in all three theme blocks.
  `gitjet.diffShowWhitespace`
  draws spaces and tabs through `revealWhitespace` (`diff.ts`), which tags the
  runs `ws` so the stylesheet can mute them without losing a change mark.
- The split viewer's divider carries one ribbon per change block, drawn as a
  curved trapezium in an SVG over the row grid (`ribbons.ts`). Geometry is
  measured from the laid-out rows (wrap, annotations and fold markers make
  heights uneven) and re-measured on resize; a side that has no lines tapers
  to a point, as `DiffDividerDrawUtil.DividerPolygon` does. The SVG has
  `pointer-events: none`; the apply buttons are positioned above it.
- A diff opens at its first change, as `SimpleDiffViewer` does with
  `ScrollToPolicy.FIRST_CHANGE`; the counter then reads `1 of N`. A refresh
  keeps the current change unless the block is gone. Clicking the counter
  opens IDEA's "Go to change" list: one row per block with the header git
  printed for it, the current block checked; a click inside a changed row
  makes that block current, as the IDE's counter follows the caret. F7 past
  the last change opens the next changed file (and Shift+F7 the previous
  one), replacing the diff tab, as IDEA's "go to the next file after reaching
  last change" does.
- The diff searches in place, as IDEA's diff editors do: Ctrl/⌘+F opens the
  bar, Enter/F3 and Shift+Enter/Shift+F3 walk the hits, Esc closes. The hit
  list covers both versions (`search.ts`); a context row whose sides are
  identical is one hit that marks both panes, and a hit hidden inside a
  closed fold opens that fold before scrolling. Ctrl/⌘+click on a line number
  opens that side's revision at the line (`diffRevisions` names it), and the
  header's Open File uses the current change's line — the diff's stand-in for
  IDEA's caret.
- A merge band is keyed by what happened to the text, never by the pane that
  holds it: `rangeTone` (`merge.ts`) maps a range's kind to `inserted`,
  `deleted`, `modified` or `conflict`, and every pane the range touches paints
  that one colour — both sides of a conflict carry the same tint, as IDEA's
  `DiffViewerHighlighters` does. The palette is IDEA's own `DIFF_*` /
  `ERROR_STRIPE_COLOR` values (`--merge-*` and `--merge-*-stripe`): a one-sided
  change is a solid band, a conflict is the band mixed 60% into the pane
  background under undiluted word marks, and the gutter keeps its normal
  background with a 3px stripe on the edge facing the text. A side drops its
  band as soon as that side is decided; the result is never "resolved" while
  it differs from the base — `resultTone` bands what the result now holds
  against the base, so a decision replaces the conflict band with a diff band.
  Resolved connectors keep their kind as a dashed outline. The band rules
  outrank CodeMirror's own theme (hence the `.cm-editor .cm-line.cm-merge-line`
  selectors): a caret line must tint a band, not repaint it.
- Every conflict block keeps a way back: `canRevertRange` (`merge.ts`) answers
  for any range that has a decision on either side, so a half-applied conflict
  shows the ↺ gutter button too — in the result pane for any decided range,
  and in the side pane whose arrow was taken, beside its status glyph. Taking
  it restores the range's base lines and clears both sides' states — IDEA's
  `MergeConflictModel.resetResolvedChange`, which is how one conflict is
  cancelled without undoing the others. The decision journal records the
  revert, so Ctrl+Z restores the rejected side.
- The dock's tab order is `gitjet.toolTabs`, a stored permutation repaired by
  `normalizeTabOrder` (unknown names dropped, missing ones appended). It is
  edited only in Settings → General ("Dock tabs"), whose arrows call
  `moveItem`; the strip is a plain list of buttons. The arrows write the order
  immediately — it is a view preference, not part of the dialog's draft.
- The Settings sheet has one height for every tab (`height: min(672px,
  calc(var(--window-h) - 56px))` in `.settings-modal`). The tabs differ a lot
  in volume, and a sheet sized to its content re-centers — the whole dialog's
  top edge jumps on each switch. The frame, the tab strip and the footer stay
  put; only `.modal-body` scrolls (it takes `flex: 1` so the footer is pinned).
  Do not go back to an auto height for a "tighter" sheet.
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
- Transient messages have one home: `noticeHost()` (`src/ui.tsx`) owns the
  single `.notice-stack` in the bottom-right, and both `Toast` and
  `OperationDock` portal into it. Never give a new banner its own
  `position: fixed` corner — add it to the stack and give it an `order`.
- Every `notify()` also appends to `App`'s session notice list, which
  `NotificationCenter` shows from the status bar's bell (unread count,
  timestamps, full message). The toast is only the transient view; do not
  bypass `notify` for an error the reader may need later.
- A tab's `editor-tab-kind` badge is tinted by its own kind colour through
  `currentColor`, so diff, source, merge and commit tabs read apart at a
  glance; the active tab strengthens its kind's tint, it does not turn accent.
- The files panel matches as you type: any keystroke that no text field owns
  (the editor, an input, a `textarea`, a dialog) is appended to a match buffer,
  `↑`/`↓` step the matching rows, `Enter` opens the stepped one, `Esc` clears.
  It highlights, it never filters, and it only ever walks the rows the tree is
  showing (`visibleFiles` in `src/explorer.ts` mirrors `FileTree`'s order), so
  the keyboard cannot land on a file hidden inside a closed folder. The
  listener is registered once and reads the latest buffer and matches through
  a ref: re-subscribing per keystroke could drop characters.
- The explorer's Locate button (crosshair) reveals the file the editor is
  showing: it clears a filter that hides it, opens its ancestor folders
  (`ancestorDirs`), centers the row and focuses it, so the tree, not just the
  editor, owns the keyboard. It is disabled when no file is open or the path
  has no working-tree row.
- `ThreeWayView` (`DiffView.tsx`) is a document kind of its own: three
  read-only panes (HEAD, index, working tree) plus a hunk chip per side.
  Each chip calls the ordinary `ApplyHunk`/`ApplyFile` with the side's own
  `DiffOptions`, so staging code has no second implementation; the backend
  `ThreeWay` reads both transitions through `FileDiff`, including the 8 MiB
  cap and whitespace flags. The commit dialog can open it for any change.
- The commit panel's "Commit staged only" sets `CommitOptions.StagedOnly`;
  "Commit All" runs `Git.commitAll`, independent of the checkboxes. The
  panel's Review action opens `ReviewDialog`, a file list beside the
  existing `DiffView` against HEAD; `LocalHistoryDialog` takes `path:""`
  for repository-wide history. Dialogs stay in `Dialogs.tsx` unless they
  own a standalone file (`EditHistoryDialog.tsx`, `RepoExtrasDialog.tsx`).
- The commit page follows IDEA's names and shape: the default changelist is
  "Changes" (`internal/app/settings.go`; older "Default Changelist" metas are
  migrated in `ensureMeta`), the tracked files sit directly under it, and
  untracked files are one collapsible "Unversioned Files" node with a
  select-all checkbox. Collapse All folds that node too, and a staged file
  stays visible when the staged section is hidden, so no checked file can be
  invisible. The toolbar's Rollback action covers the selection (or every
  local change) and opens `RollbackDialog`, IDEA's file list with the
  "Delete local copies of added files" option: `Repo.Rollback(paths,
  deleteAdded)` keeps an added file's copy unless that option is set. The
  choice is remembered in `Settings.RollbackDeleteAdded`.
- A commit-list file row spends one slot on its icon and colours the name by
  status, as IDEA does; a status letter would push the icon and name one
  column right of a directory row at the same depth. Both views therefore
  share one grid: chevron, checkbox, icon, name, and the flat view's
  directory suffix is the same size as the name.
- Merging follows IDEA's two-part shape: the branch popup's "Merge “x” into
  “y”" runs `Git.merge` with git's defaults at once (`defaultMergeOptions` in
  `App.tsx`), the way `GitBranchPopupActions.MergeAction` calls the brancher
  directly, while Git ▸ Merge… opens `MergeDialog` to name any local or remote
  branch and pick the flags. The dialog starts with no branch selected and
  titles itself from the two names, as `GitMergeDialog` does.
- A control beside a focused text field acts on the press, not on the click:
  pressing elsewhere blurs the field first, and the release click arrives late
  enough to be dropped, so the first click would only take the focus away.
  `usePress` (`src/ui.tsx`) wires that up (`IconButton` takes `pressOnDown`),
  and it swallows the click its own press already handled.
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
- App-wide shortcuts are native menu accelerators in `internal/app/run.go`
  (`CmdOrCtrl`), not `keydown` handlers. To add one: menu item + `send("cmd")`
  + `case` in `App.handleCommand` + Go i18n label + README table. Keys that
  belong to the code editor (declaration, usages, history) live in the
  CodeMirror keymap in `src/editor.ts` instead, because they act on its
  selection.

### Editing and language servers

- The working-tree source pane is editable CodeMirror; the index and historical
  revisions use `EditorState.readOnly`, never `EditorView.editable(false)` — the
  latter makes the DOM unfocusable and kills the arrow keys, `⌘B` and copy.
  Saving goes through `Git.saveFile` (Save All, window deactivation, or the
  opt-in idle timer), which refuses directories and missing paths.
  `src/editorText.ts` folds CRLF for CodeMirror and restores the file's
  separator on write; `Repo.SaveFile` writes a temporary file beside the
  target and renames it over it (IDEA's safe write), keeping the mode.
- Dirty state is owned by `App` (`dirtyDocs`) but is deliberately invisible:
  there is no dot and no unsaved counter, because saving is not a decision the
  reader makes. `SourceView` keeps an inactive dirty tab's text in
  `RightPane`'s `drafts` map; a clean tab is always re-read from `file.text`.
  A refresh from disk never replaces a dirty document.
- Save is IDEA's Save All, not a per-tab write: `RightPane.saveAll` collects
  the mounted editor's text (`EditorSaveHandle`) and every inactive draft,
  writes them through `onSaveFiles`, and refreshes once. The File menu's Save
  All (⌘/Ctrl-S) and the editor's Mod-s call it, but nothing requires it; a
  second request while a write is in flight joins the first. `markSaved`
  adopts the snapshot that reached disk, so typing during the write keeps the
  document dirty, and a failed write keeps its text and blocks the close that
  asked for it.
- Closing a tab is not a save question: `requestCloseDocs` writes the tab's
  text first and closes only when the write succeeded. Opening another
  repository and closing the repository do the same. Nothing prompts for a
  save; a failed write is the only outcome that keeps a tab open, and its
  error names the path.
- Window close and app quit are deferred by the host: the page reports
  `dirtyDocs.size` through `Workspace.SetUnsaved`, `saveGate` in
  `internal/app/run.go` prevents the `OnClose`/`OnBeforeQuit` event while that
  count is non-zero, broadcasts `save-and-close` or `save-and-quit`, and the
  page answers with `Workspace.closeWindow()` or `Workspace.quitApp()` once
  `saveAll` returns no still-dirty id. A failed write leaves the window or the
  quit canceled rather than losing the edits.
- Edits also save the way IDEA saves them: window deactivation
  (`Settings.SaveOnDeactivation`, IDEA's `isSaveOnFrameDeactivation`, on by
  default) writes every unsaved tab, through the same `saveAll` path with
  `quiet` set so no toast appears. IDEA's `autoSaveIfInactive` is opt-in and
  off by default; Settings → General exposes it as `autoSaveIdle` +
  `autoSaveIdleSeconds` (15 s, clamped 1..300), and `RightPane` runs one timer
  restarted by every keystroke. A save must never re-reveal the opening line —
  the reveal effect is keyed on `line`/`reveal`, never on `file.text`, or the
  caret drifts to the top after every write.
- Change bars come from `Git.diff({target:"worktree"})` hunks, mapped to lines by
  `src/annotate.ts`; every line of a span gets its own bar, a replaced block is
  a `mod` and only its surplus an `add`, and a deletion is a wedge on the line
  after it. Clicking a bar opens IDEA's marker menu (Show Diff / Roll back
  This Block / Roll back This Line); Alt-clicking keeps the direct line
  rollback. The menu calls `Git.applyHunk(..., "rollback")` with the same hunk
  index. Blame comes from `Git.blame(path, revision)` (`""` is
  the worktree, `"INDEX"` the staged copy), rendered on the cursor line and in
  the annotation column. Source and diff gutters share `src/blameMenu.ts`, so
  the line-number menu means the same thing in both.
- The editor's state fields must exist from construction (they start empty and
  are filled by effects). Dispatching an effect whose field is absent throws.
- `SourceView` is keyed by document id **and revision**: the working tree and
  HEAD share one `file:<path>` document, and switching revisions replaces that
  tab's content in place, so the key must change with the revision or
  CodeMirror keeps the old text.
- The working tree and HEAD are two states of one file, not two tabs: opening
  a HEAD copy (from a diff side) reuses a clean working-tree tab, and a
  revision view's Working Tree button returns to it. The working-tree file
  itself has no HEAD button — the revision tab usually sits in the strip
  already, and a second HEAD tab would duplicate it; its Diff action is the
  comparison. A **dirty** buffer is never replaced — the other revision opens
  beside it instead, and the index or a historical commit always opens beside
  it. When two tabs would share a base title, the strip appends the revision or
  the diff's base pair (`tabDetail` in `App.tsx`), as IDEA titles a staged
  revision tab; a unique tab keeps the short path.
- The source pane's Diff action follows the view it is on: the working tree
  compares the index with the file, HEAD compares the commit with the working
  tree, the index compares HEAD with the index, and a commit compares it with
  its parent. The worktree target stays the one with hunk/staging actions.
- Language servers are optional. `internal/lsp.Detect` maps repo markers to a
  server; `Git.lspStart/lspWrite/lspStop` move bytes between the page and the
  process over `events.gitLsp` (no sockets, no workers). Without a server,
  `Git.searchSymbol` (git grep) backs the same jumps: `planTextJump`
  (`src/navigation.ts`) reads the hits through `classifyHits`, so a click on
  a usage jumps to the one declaration it finds and a click on a declaration
  lists its uses; several declarations open the same chooser.
- Editors register the **absolute** file URI (`joinRoot(root, file.path)`),
  because that is what a server returns. A jump's display path is a git path
  when it is under the root and absolute when it is not; `resolveOpenPath`
  (`src/paths.ts`) makes that decision, and a target outside the repository
  opens read-only through `Git.ExternalFile` (revision `EXTERNAL`) instead of
  failing `cleanPath`. `openNavigationTarget` opens `fromUri(target.uri)`,
  never the display path.
- Navigation is app-owned, not the LSP package's commands: `lookupTargets`
  (`definition`/`implementation`/`typeDefinition`) and `lookupUsages` (which
  asks `lookupReferences` first) in `src/lsp.ts` return normalized locations
  from `src/navigation.ts`. `Mod-b`/Cmd-click is IDEA's **Go to Declaration or
  Usages**: when a definition target covers the caret, the reader is on the
  declaration and the editor shows its usages instead; otherwise one target
  opens directly and several open `TargetPopup`, which filters as you type.
  A usage search with one reference opens it at once, and none is a notice —
  both as `ShowUsagesAction` does. References are never dropped for unopened
  files: `Git.lineTexts` adds each line's text for `SymbolPanel`, which groups
  by file, filters as you type, and walks `↑`/`↓`/Enter. The panel previews
  the selected row through `Git.UsagePreview` (`internal/git/files.go`: a
  bounded window read from the working tree or an absolute external file,
  with the final newline not counted as a line); a click selects and previews,
  Enter or a double click opens, matching the split Show Usages popup. Text
  search remains the fallback only when the server has no capability or the
  request fails.
- The editor keys mirror IDEA: `Mod-b`/F12 declaration or usages, `Mod-Alt-b`
  implementation, `Ctrl-Shift-b` type declaration (IDEA's macOS chord; on
  Windows/Linux it is the same chord), `Alt-F7`/`Mod-Alt-F7`/`Shift-F12`
  usages, `Mod-Alt-Left`/`Mod-[` back and `Mod-Alt-Right`/`Mod-]` forward.
  Cmd/Ctrl+Click is declaration or usages, Cmd/Ctrl+Shift+Click is the type
  declaration, and holding the modifier underlines the word. The code area's
  context menu offers the same four commands (`SourceEditor.navigateAt`).
  History lives in `App` (`navHistory`): a direct jump records both ends, a
  chooser or usage row records the origin when it opens a target, and the
  toolbar's back/forward arrows use the same stack. A jump places a collapsed
  caret (IDEA does not select the name) and records its column, which Back
  and Forward restore.
- Registered views carry their revision, and `firstView` only reuses a
  working-tree or external pane. The working tree and HEAD share one tab, so
  without that filter a jump made from a HEAD pane moved the caret in the
  read-only revision instead of opening the working-tree target.
- `DockWorkspace.syncFiles` must return the editors' unsynced changes and
  advance each file's version; returning `[]` (as an earlier version did)
  left the server answering about the text it saw on open, so jumps drifted
  after any edit.
- Attach the LSP plugin only when the server speaks the file's language
  (`lspServes`) **and** the view is the working tree: a Go module with a
  `package.json` gets gopls, which must not receive TypeScript documents, and
  a HEAD or index snapshot must not register its text under the working-tree
  URI. Revision views fall back to the text search.

### TypeScript

`strict` **and** `noUncheckedIndexedAccess` are on: indexed access is
`T | undefined`, hence the pervasive `arr[i]!` and `?? fallback`. `tsc` runs
over `src` only — `src/**/*.test.ts` is excluded, so type errors in tests are
invisible to CI (and Bun strips types without checking). After regenerating
bindings, re-check hand-written test fixtures (`graph.test.ts`, `branches.test.ts`).

## Important Files

- `main.go` — entry; calls `app.Run`.
- `internal/app/run.go` — app name, bound services, events, window, menu,
  `App.OnOpenFile` (recents and system-opened repositories).
- `internal/app/contextmenu.go` — what the page's right-click menu offers.
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
  version-coupled at 0.7.4 — bump them together.
- No cgo anywhere (`purego` loads dylibs); platform code uses build-tagged
  files (`internal/proc/hideconsole_windows.go` and `hideconsole_other.go`),
  not runtime switches, for OS-only imports.
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

- The README's screenshots live in `docs/` and were captured from the
  packaged app on a demo repository; refresh them when the layout changes.
- `Repo.prefix` is assigned in `Open` and never read.
- The Git console implies `git`: the page prepends it unless the line starts
  with `!` or already names `git`. Keep the input's `autoCapitalize="off"` —
  WebKit capitalises the first letter otherwise, and `Status` is not a
  builtin.
- Several errors are deliberately swallowed (stash listing, meta saves,
  corrupt `settings.json` → defaults); don't "fix" them blindly.
- The page's context menu removes WebKit's browser items (navigation,
  new windows, downloads, web search, share, print) in
  `internal/app/contextmenu.go`; the app's own React menus still suppress it
  by calling `preventDefault`.
- The app's language setting drives both sides: `resolveLang` reads
  `mygo.App.PreferredLanguages()` for `"system"`, and `applyMenu` calls
  `mygo.App.SetLocale` so MyGo's own labels (role menu items, dialogs) speak
  the same language. The `zh-Hans` catalog import in `run.go` supplies those
  translations.
- The first click in an inactive window reaches the page since MyGo 0.7.4
  (`MyGoWebView` answers `acceptsFirstMouse:` itself); the private AppKit patch
  GitJet used for that on 0.6.4 is gone, and pinning MyGo below 0.7.4 would
  bring the bug back.
