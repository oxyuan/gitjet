# GitJet

GitJet is a desktop Git client: Go drives the real `git` executable, and a
React frontend runs in the system WebView through MyGo's typed IPC.

## Layout

- `internal/git` — the only package that runs git and parses its output
  (status, diffs, log, refs, actions, blame, console).
- `internal/app` — the application: bound services, settings and repository
  metadata persistence, polling, window and menu.
- `src` — React UI. `src/mygo.ts` is generated from the Go services; never
  edit it by hand.
- `src/merge.ts` — conflict parsing, line alignment and result assembly,
  independent of React so it can be tested.

## Commands

```sh
go test ./... && go vet ./...
bun run typecheck
bun run test:web
bun run build:web
bun run dev        # mygo dev
bun run build      # package for the host platform
```

Cross-compilation must keep working:

```sh
GOOS=windows GOARCH=amd64 go build ./...
GOOS=darwin GOARCH=arm64 go build ./...
```

## Conventions

- Git operations go through `internal/git`; the frontend never builds git
  commands itself.
- Bound methods and event payloads must be JSON-encodable. Run
  `bun run generate` after changing a service.
- Repository writes are serialized in `git.Repo`; don't run mutating
  commands around it.
- UI behavior lives in React; pure logic (diff alignment, graph layout,
  conflict assembly) belongs in a module with unit tests.
- Tests should cover behavior that can break. Don't assert on incidental
  wording or defaults.
