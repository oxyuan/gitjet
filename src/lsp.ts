import { EditorView } from "@codemirror/view";
import type { ChangeSet, Text } from "@codemirror/state";
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  languageServerExtensions,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { Git, events } from "./mygo";
import { normalizeTargets, type NavigationTarget, type TargetKind } from "./navigation";
import { repoRelative } from "./paths";

/** One message the Go side relays from the language server. */
type Envelope = { id: string; message?: string; closed?: boolean; error?: string };

/** file:// URIs, which the protocol speaks, in both directions. */
export function toUri(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized)) return "file:///" + encodePath(normalized);
  return "file://" + encodePath(normalized.startsWith("/") ? normalized : "/" + normalized);
}

export function fromUri(uri: string): string {
  let path = uri.replace(/^file:\/\//, "");
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  try {
    path = decodeURI(path);
  } catch {
    // A malformed escape stays as it came.
  }
  return path;
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part).replaceAll("%24", "$").replaceAll("%40", "@").replaceAll("%3A", ":"))
    .join("/");
}

/** A mounted editor and the revision it shows. Navigation targets are
 *  working-copy places: a HEAD or index pane must never be mistaken for the
 *  file a jump targets, or the caret would move in a read-only revision. */
type OpenView = { view: EditorView; revision: string };

/** Views that are open, by URI, so a jump can find the one already showing a
 *  file instead of opening it twice. */
const openViews = new Map<string, Set<OpenView>>();
const pending = new Map<string, ((view: EditorView | null) => void)[]>();

/** Windows file URIs are case-insensitive; the rest are not. */
function viewKey(uri: string): string {
  return /^file:\/\/\/[A-Za-z]:\//.test(uri) ? uri.toLowerCase() : uri;
}

/** The working tree and a file outside the repository are the only states a
 *  language server speaks about; HEAD and the index are read-only snapshots
 *  of the same URI. */
function navigable(revision: string): boolean {
  return revision === "" || revision === "EXTERNAL";
}

let openDocument: ((path: string) => Promise<void>) | null = null;

/** The app supplies how to put a file on screen; the client needs it for
 *  cross-file jumps. */
export function setDocumentOpener(opener: ((path: string) => Promise<void>) | null) {
  openDocument = opener;
}

/** Registers a mounted editor for a URI, and wakes anyone waiting for it. */
export function registerView(uri: string, view: EditorView, revision = "") {
  const key = viewKey(uri);
  const views = openViews.get(key) ?? new Set();
  views.add({ view, revision });
  openViews.set(key, views);
  const waiting = pending.get(key);
  if (waiting && navigable(revision)) {
    pending.delete(key);
    for (const resolve of waiting) resolve(view);
  }
}

export function unregisterView(uri: string, view: EditorView) {
  const key = viewKey(uri);
  const views = openViews.get(key);
  if (!views) return;
  for (const entry of [...views]) {
    if (entry.view === view) views.delete(entry);
  }
  if (views.size === 0) openViews.delete(key);
}

function firstView(uri: string, prefer?: EditorView): EditorView | null {
  const views = openViews.get(viewKey(uri));
  if (!views || views.size === 0) return null;
  let fallback: EditorView | null = null;
  for (const entry of views) {
    if (!navigable(entry.revision)) continue;
    if (prefer && entry.view === prefer) return entry.view;
    fallback ??= entry.view;
  }
  return fallback;
}

/** A promise and its resolver. `Promise.withResolvers` is newer than this
 *  app's ES2022 target, and a WebView is the one place a missing built-in
 *  cannot be polyfilled away. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Resolves the view for a URI, opening the file in a dock tab when needed. */
async function ensureView(uri: string): Promise<EditorView | null> {
  const existing = firstView(uri);
  if (existing) return existing;
  if (!openDocument) return null;
  const key = viewKey(uri);
  const { promise, resolve } = deferred<EditorView | null>();
  const list = pending.get(key) ?? [];
  list.push(resolve);
  pending.set(key, list);
  setTimeout(() => {
    const remaining = pending.get(key);
    if (!remaining) return;
    pending.delete(key);
    for (const settle of remaining) settle(firstView(uri));
  }, 3000);
  void openDocument(fromUri(uri));
  return promise;
}

/** A workspace backed by the app's dock documents, so definition jumps open
 *  the file instead of failing. */
class DockWorkspace extends Workspace {
  files: WorkspaceFile[] = [];

  private entry(uri: string, view: EditorView, languageId = "plaintext"): WorkspaceFile {
    return {
      uri,
      languageId,
      version: 0,
      doc: view.state.doc,
      getView: (main?: EditorView) => firstView(uri, main),
    };
  }

  /** Sends what the editors have typed since the last request, and advances
   *  each file's version. Returning no updates, as an earlier version of
   *  this workspace did, left the server reading the text it saw on open. */
  syncFiles(): { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] {
    const updates: { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet }[] = [];
    for (const file of this.files) {
      const view = file.getView();
      if (!view) continue;
      const plugin = LSPPlugin.get(view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (changes.empty) continue;
      updates.push({ file, prevDoc: file.doc, changes });
      file.doc = view.state.doc;
      file.version += 1;
      plugin.clear();
    }
    return updates;
  }

  async requestFile(uri: string): Promise<WorkspaceFile | null> {
    return this.files.find((file) => file.uri === uri) ?? null;
  }

  openFile(uri: string, languageId: string, view: EditorView) {
    if (this.files.some((file) => file.uri === uri)) return;
    const entry = this.entry(uri, view, languageId);
    this.files.push(entry);
    this.client.didOpen(entry);
  }

  closeFile(uri: string) {
    const index = this.files.findIndex((file) => file.uri === uri);
    if (index < 0) return;
    this.files.splice(index, 1);
    this.client.didClose(uri);
  }

  async displayFile(uri: string): Promise<EditorView | null> {
    const view = await ensureView(uri);
    if (view && !this.files.some((file) => file.uri === uri)) {
      this.openFile(uri, "plaintext", view);
    }
    return view;
  }
}

/** The transport is the app's own IPC: no socket, no port, no worker. */
function createTransport(session: string): Transport {
  const handlers = new Set<(value: string) => void>();
  events.gitLsp.on((raw) => {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.id !== session) return;
    if (envelope.message) for (const handler of handlers) handler(envelope.message);
    if (envelope.closed) handlers.clear();
  });
  return {
    send(message: string) {
      void Git.lspWrite(session, message).catch(() => {});
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
  };
}

let client: LSPClient | null = null;
let starting: Promise<LSPClient | null> | null = null;
let serverName = "";
let serverLanguage = "";
let repositoryRoot = "";

/** What the probe found, for the UI to explain itself. */
export function lspServerName(): string {
  return serverName;
}

/** A repository is one language to the server: a Go module with a package.json
 *  still gets gopls, and gopls has nothing to say about a .tsx file. */
export function lspServes(language: string): boolean {
  if (serverLanguage === "") return false;
  const family: Record<string, string> = {
    typescript: "typescript",
    tsx: "typescript",
    javascript: "typescript",
    jsx: "typescript",
    go: "go",
    rust: "rust",
    c: "c",
    cpp: "c",
    java: "java",
    kotlin: "java",
    python: "python",
  };
  return family[language] === serverLanguage;
}

export function isConnected(): boolean {
  return client?.connected ?? false;
}

/** Connects to the repository's language server, once. Resolves null when
 *  there is no server, or it is not installed, and never throws. */
export function connectLSP(): Promise<LSPClient | null> {
  if (client) return Promise.resolve(client);
  if (starting) return starting;
  starting = (async () => {
    const server = await Git.lspProbe();
    if (!server || !server.name) return null;
    serverName = server.name;
    serverLanguage = server.language;
    if (!server.installed) return null;
    const info = await Git.lspStart();
    repositoryRoot = info.root;
    const next = new LSPClient({
      rootUri: toUri(info.root),
      extensions: languageServerExtensions(),
      workspace: (c) => new DockWorkspace(c),
      timeout: 10000,
      sanitizeHTML,
    });
    next.connect(createTransport(info.id));
    await next.initializing.catch(() => null);
    if (!next.serverCapabilities) {
      next.disconnect();
      return null;
    }
    client = next;
    return next;
  })()
    .catch(() => null)
    .finally(() => {
      starting = null;
    });
  return starting;
}

/** Ends the session, for a repository switch or a close. */
export async function disconnectLSP() {
  const current = client;
  client = null;
  starting = null;
  repositoryRoot = "";
  openViews.clear();
  if (current) current.disconnect();
  await Git.lspStop().catch(() => {});
}

/** The extension a source editor adds once a session exists. */
export function lspPlugin(uri: string, languageId: string) {
  return client ? client.plugin(uri, languageId) : [];
}

/** What a jump request could get out of the server. `supported` separates
 *  "this server cannot answer" from "it answered with nothing", which is the
 *  difference between falling back to a text search and reporting a miss. */
export type LspLookup = {
  supported: boolean;
  failed: boolean;
  targets: NavigationTarget[];
};

export type LspUsageLookup = LspLookup & {
  definitions: NavigationTarget[];
};

const lookups: Record<TargetKind, { method: string; capability: string }> = {
  definition: { method: "textDocument/definition", capability: "definitionProvider" },
  implementation: { method: "textDocument/implementation", capability: "implementationProvider" },
  typeDefinition: { method: "textDocument/typeDefinition", capability: "typeDefinitionProvider" },
};

function supports(plugin: LSPPlugin, capability: string): boolean {
  const caps = plugin.client.serverCapabilities as unknown as Record<string, unknown> | null;
  if (!caps) return false;
  const value = caps[capability];
  return value !== undefined && value !== null && value !== false;
}

function pluginFor(view: EditorView): LSPPlugin | null {
  return LSPPlugin.get(view);
}

/** Whether the server behind this editor advertises one LSP capability. A
 *  pane without a plugin (no server, or a read-only revision) answers false. */
export function lspSupports(view: EditorView, capability: string): boolean {
  const plugin = pluginFor(view);
  return !!plugin && supports(plugin, capability);
}

/** A server's file URI as the page names it: a git path inside the
 *  repository, an absolute path for a library outside it. */
function displayPath(uri: string): string {
  const absolute = fromUri(uri);
  return repoRelative(repositoryRoot, absolute) ?? absolute;
}

/** Asks the server for the definitions (or implementations, or types) at a
 *  position. Never throws: a server that errors reads as a miss. */
export async function lookupTargets(
  view: EditorView,
  pos: number,
  kind: TargetKind,
): Promise<LspLookup> {
  const plugin = pluginFor(view);
  const lookup = lookups[kind];
  if (!plugin || !supports(plugin, lookup.capability)) {
    return { supported: false, failed: false, targets: [] };
  }
  plugin.client.sync();
  try {
    const result = await plugin.client.request<Record<string, unknown>, unknown>(lookup.method, {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(pos),
    });
    return { supported: true, failed: false, targets: normalizeTargets(result, displayPath) };
  } catch {
    return { supported: true, failed: true, targets: [] };
  }
}

/** Asks the server for the references at a position. Never throws: a server
 *  that errors reads as a miss. */
async function lookupReferences(view: EditorView, pos: number): Promise<LspLookup> {
  const plugin = pluginFor(view);
  if (!plugin || !supports(plugin, "referencesProvider")) {
    return { supported: false, failed: false, targets: [] };
  }
  plugin.client.sync();
  try {
    const result = await plugin.client.request<Record<string, unknown>, unknown>("textDocument/references", {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(pos),
      context: { includeDeclaration: true },
    });
    return { supported: true, failed: false, targets: normalizeTargets(result, displayPath) };
  } catch {
    return { supported: true, failed: true, targets: [] };
  }
}

/** Finds the usages of the symbol at a position, plus its declaration so the
 *  list can mark which row is the source. `known` is a declaration the caller
 *  already has, which is the case when the jump started on the declaration
 *  itself; it saves a second definition request. */
export async function lookupUsages(
  view: EditorView,
  pos: number,
  known?: NavigationTarget[],
): Promise<LspUsageLookup> {
  const plugin = pluginFor(view);
  if (!plugin) return { supported: false, failed: false, targets: [], definitions: [] };
  const references = await lookupReferences(view, pos);
  if (!references.supported) {
    return { ...references, targets: [], definitions: known ?? [] };
  }
  if (references.failed) {
    return { ...references, definitions: known ?? [] };
  }
  let definitions = known;
  if (!definitions) {
    if (!supports(plugin, "definitionProvider")) {
      definitions = [];
    } else {
      plugin.client.sync();
      const result = await plugin.client
        .request<Record<string, unknown>, unknown>("textDocument/definition", {
          textDocument: { uri: plugin.uri },
          position: plugin.toPosition(pos),
        })
        .catch(() => null);
      definitions = result ? normalizeTargets(result, displayPath) : [];
    }
  }
  return { supported: true, failed: false, targets: references.targets, definitions };
}

/** The offset a 1-based line and column stands for in a view's document.
 *  The plugin's own conversion needs the plugin, which a file opened by a
 *  jump may not have attached yet. */
function offsetFor(view: EditorView, line: number, column: number): number {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
  return Math.min(target.from + Math.max(column - 1, 0), target.to);
}

/** Puts a target on screen: opens its file when needed, selects the reported
 *  range and gives it focus. Resolves false when the file could not open. */
export async function openNavigationTarget(
  target: NavigationTarget,
  prefer?: EditorView,
): Promise<boolean> {
  // Open the server's own file, not the display path: a library target is
  // absolute, and a repository target is relative, but both have a URI.
  // Re-encode so the view registration and this key agree.
  const uri = toUri(fromUri(target.uri));
  const view = firstView(uri, prefer) ?? (await ensureView(uri));
  if (!view) return false;
  // IDEA puts the caret at the target's offset and leaves it collapsed; it
  // does not select the declaration's name.
  const anchor = offsetFor(view, target.line, target.column);
  view.dispatch({
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "select.definition",
  });
  view.focus();
  return true;
}

/** Keeps hover text from becoming script execution: the server is a local
 *  process, but what it says still arrives as HTML. */
function sanitizeHTML(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("script, style, iframe, object, embed")) {
    element.remove();
  }
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && value.startsWith("javascript:"))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.innerHTML;
}

export type { WorkspaceFile };
