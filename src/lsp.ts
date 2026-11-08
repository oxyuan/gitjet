import { EditorView } from "@codemirror/view";
import {
  LSPClient,
  Workspace,
  languageServerExtensions,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { Git, events } from "./mygo";

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

/** Views that are open, by URI, so a jump can find the one already showing a
 *  file instead of opening it twice. */
const openViews = new Map<string, Set<EditorView>>();
const pending = new Map<string, ((view: EditorView | null) => void)[]>();

let openDocument: ((path: string) => Promise<void>) | null = null;

/** The app supplies how to put a file on screen; the client needs it for
 *  cross-file jumps. */
export function setDocumentOpener(opener: ((path: string) => Promise<void>) | null) {
  openDocument = opener;
}

/** Registers a mounted editor for a URI, and wakes anyone waiting for it. */
export function registerView(uri: string, view: EditorView) {
  const views = openViews.get(uri) ?? new Set();
  views.add(view);
  openViews.set(uri, views);
  const waiting = pending.get(uri);
  if (waiting) {
    pending.delete(uri);
    for (const resolve of waiting) resolve(view);
  }
}

export function unregisterView(uri: string, view: EditorView) {
  const views = openViews.get(uri);
  if (!views) return;
  views.delete(view);
  if (views.size === 0) openViews.delete(uri);
}

function firstView(uri: string, prefer?: EditorView): EditorView | null {
  const views = openViews.get(uri);
  if (!views || views.size === 0) return null;
  if (prefer && views.has(prefer)) return prefer;
  return views.values().next().value ?? null;
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
  const { promise, resolve } = deferred<EditorView | null>();
  const list = pending.get(uri) ?? [];
  list.push(resolve);
  pending.set(uri, list);
  setTimeout(() => {
    const remaining = pending.get(uri);
    if (!remaining) return;
    pending.delete(uri);
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
    const entry: WorkspaceFile = {
      uri,
      languageId,
      version: 1,
      get doc() {
        return view.state.doc;
      },
      getView: (main?: EditorView) => firstView(uri, main),
    };
    return entry;
  }

  syncFiles() {
    return [];
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
  openViews.clear();
  if (current) current.disconnect();
  await Git.lspStop().catch(() => {});
}

/** The extension a source editor adds once a session exists. */
export function lspPlugin(uri: string, languageId: string) {
  return client ? client.plugin(uri, languageId) : [];
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
