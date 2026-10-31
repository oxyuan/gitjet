import {
  Compartment,
  EditorState,
  Prec,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  drawSelection,
  gutter,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type BlockInfo,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, indentOnInput, syntaxHighlighting, type LanguageSupport } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { closeBrackets } from "@codemirror/autocomplete";
import { languages } from "@codemirror/language-data";
import { findReferences, jumpToDefinition } from "@codemirror/lsp-client";
import { editorHighlightStyle } from "./highlight";
import type { BlameLine } from "./mygo";
import { blameDepth, type ChangeRange } from "./annotate";
import { normalizeText } from "./editorText";

/** The editor paints with the app's tokens, so there is one palette, not two. */
const theme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--fg)",
    backgroundColor: "var(--code-bg)",
    fontSize: "12.5px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "6px 0", caretColor: "var(--fg)" },
  ".cm-line": { padding: "0 10px 0 4px" },
  ".cm-gutters": {
    backgroundColor: "var(--code-bg)",
    color: "var(--muted-2)",
    border: "none",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "38px" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-soft)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--fg) 4%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--fg)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 30%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warning) 55%, transparent)" },
});

/** CodeMirror's base theme paints the selection itself: `&light
 *  .cm-selectionBackground` (#d9d9d9), and while focused `&light.cm-focused >
 *  .cm-scroller > .cm-selectionLayer .cm-selectionBackground` (#d7d4f0) —
 *  five classes. A shorter selector loses on specificity, which is why a dark
 *  pane showed a near-white block that swallowed the code. Same shape, same
 *  class count, top precedence, so the token is the one that lands. */
const selectionTheme = Prec.highest(
  EditorView.theme({
    ".cm-selectionBackground": { backgroundColor: "var(--selection-strong)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--accent) 34%, transparent)",
    },
  }),
);

/** Aliases for the language names the Go side reports. */
const languageAliases: Record<string, string> = {
  markup: "html",
  bash: "shell",
  docker: "dockerfile",
  makefile: "makefile",
  toml: "toml",
  scss: "sass",
  c: "cpp",
  cpp: "cpp",
  jsonc: "json",
};

const languageCache = new Map<string, Promise<LanguageSupport | null>>();

/** Loads the grammar for a language name, once. Unknown names get plain text. */
export function loadLanguage(name: string): Promise<LanguageSupport | null> {
  const key = languageAliases[name] ?? name;
  const cached = languageCache.get(key);
  if (cached) return cached;
  const description = languages.find(
    (d) => d.name.toLowerCase() === key || d.alias.includes(key) || d.extensions.includes(key),
  );
  const loading = description
    ? description.load().then((support) => support as LanguageSupport | null, () => null)
    : Promise.resolve(null);
  languageCache.set(key, loading);
  return loading;
}

class ChangeMarker extends GutterMarker {
  constructor(
    readonly hunk: number,
    readonly kind: "add" | "del",
    readonly onClick: (hunk: number, kind: "add" | "del") => void,
    readonly label: string,
  ) {
    super();
  }
  eq(other: ChangeMarker) {
    return other.hunk === this.hunk && other.kind === this.kind && other.label === this.label;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-change cm-change-${this.kind}`;
    el.dataset.hunk = String(this.hunk);
    el.title = this.label;
    // The gutter sits outside the content DOM, where EditorView.domEventHandlers
    // has no ear, so the marker listens for itself.
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onClick(this.hunk, this.kind);
    });
    return el;
  }
}

const setChanges = StateEffect.define<ChangeRange[]>();

/** The change ranges the gutter and its clicks work from. */
const changeField = StateField.define<ChangeRange[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setChanges)) return effect.value;
    }
    return value;
  },
});

/** A gutter column of add/delete bars, clickable per hunk. */
function changeGutter(onClick: (hunk: number, kind: "add" | "del") => void, labels: { add: string; del: string }): Extension {
  return [
    changeField,
    gutter({
      class: "cm-change-gutter",
      markers: (view) => {
        const ranges = view.state.field(changeField);
        if (ranges.length === 0) return RangeSet.empty as RangeSet<GutterMarker>;
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const range of ranges) {
          const line = view.state.doc.line(Math.min(Math.max(range.start, 1), view.state.doc.lines));
          const label = range.kind === "add" ? labels.add : labels.del;
          builder.add(line.from, line.from, new ChangeMarker(range.hunk, range.kind, onClick, label));
        }
        return builder.finish();
      },
    }),
  ];
}

/** Puts the active line's blame at the end of that line, like an IDE does. */
class BlameWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: BlameWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-blame";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const setBlame = StateEffect.define<Map<number, BlameLine>>();

const blameField = StateField.define<Map<number, BlameLine>>({
  create: () => new Map(),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlame)) return effect.value;
    }
    return value;
  },
});

/** English fallback; the app passes its own formatter so the note follows the
 *  UI language. */
function formatBlame(line: BlameLine): string {
  if (line.uncommitted) return "  uncommitted";
  const summary = line.summary ? " " + line.summary : "";
  return `  ${line.author} · ${line.short}${summary} · ${relativeTime(line.time)}`;
}

function relativeTime(unix: number): string {
  if (!unix) return "";
  const seconds = Math.max(0, Date.now() / 1000 - unix);
  if (seconds < 90) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Draws the blame of the line the cursor is on. */
const blameLine = (format?: EditorOptions["blameFormat"]): Extension => [
  blameField,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (update.selectionSet || update.docChanged || update.transactions.some((tr) => tr.effects.some((e) => e.is(setBlame)))) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const blame = view.state.field(blameField, false);
        if (!blame || blame.size === 0) return Decoration.none;
        const lineNo = view.state.doc.lineAt(view.state.selection.main.head).number;
        const entry = blame.get(lineNo);
        if (!entry) return Decoration.none;
        const line = view.state.doc.line(lineNo);
        const text = format ? format(entry, formatBlame(entry)) : formatBlame(entry);
        return Decoration.set([Decoration.widget({ widget: new BlameWidget(text), side: 1 }).range(line.to)]);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
];

export type EditorOptions = {
  doc: string;
  language: string;
  wrap: boolean;
  /** Working-tree files are editable; the index and historical revisions are
   *  read-only. Read-only still leaves the DOM focusable. */
  editable?: boolean;
  /** Reports when the document differs from the last saved text, so the tab
   *  can show a dot and "close unmodified" can leave it alone. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Ctrl/Cmd-S. The page owns the actual write. */
  onSaveRequest?: () => void;
  /** Copy the editor needs, in the reader's language. */
  labels?: { addedHere?: string; deletedHere?: string };
  /** Formats one blame line; the app owns the wording. */
  blameFormat?: (line: BlameLine, fallback: string) => string;
  changes?: ChangeRange[];
  blame?: BlameLine[] | null;
  onRollbackHunk?: (hunk: number) => void;
  onSymbol?: (word: string) => void;
  onJump?: (word: string) => void;
  onReferences?: (word: string) => void;
  /** Fires with the 1-based line under the caret, for things like copying a
   *  path with its line number. */
  onCaret?: (line: number) => void;
  /** Right-click on a line number, with the menu's screen position. */
  onGutterContext?: (line: number, x: number, y: number) => void;
  /** Whether the blame annotation column starts visible. */
  annotate?: boolean;
  /** Formats one annotation cell; the app owns date formatting and wording. */
  annotateFormat?: (line: BlameLine) => { date: string; author: string };
};

/** One row of the blame column: the line's date and author, tinted by how old
 *  the commit is so recent work stands out and old work recedes. */
class AnnotateMarker extends GutterMarker {
  constructor(
    readonly line: number,
    readonly date: string,
    readonly author: string,
    readonly depth: number,
    readonly uncommitted: boolean,
    readonly title: string,
  ) {
    super();
  }
  eq(other: AnnotateMarker) {
    return (
      other.line === this.line &&
      other.date === this.date &&
      other.author === this.author &&
      other.depth === this.depth &&
      other.uncommitted === this.uncommitted &&
      other.title === this.title
    );
  }
  toDOM() {
    const el = document.createElement("div");
    el.className =
      "cm-annotate" +
      (this.depth >= 0 ? ` cm-annotate-depth-${this.depth}` : "") +
      (this.uncommitted ? " cm-annotate-uncommitted" : "");
    el.title = this.title;
    const date = document.createElement("span");
    date.className = "cm-annotate-date";
    date.textContent = this.date;
    const author = document.createElement("span");
    author.className = "cm-annotate-author";
    author.textContent = this.author;
    el.append(date, author);
    return el;
  }
}

/** The annotation column left of the line numbers, IDEA-style: every line
 *  carries the date and author of the commit that last changed it. */
function annotateGutter(opts: EditorOptions): Extension {
  return gutter({
    class: "cm-annotate-gutter",
    lineMarkerChange: (update) =>
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setBlame))),
    markers: (view) => {
      const blame = view.state.field(blameField, false);
      if (!blame || blame.size === 0) return RangeSet.empty as RangeSet<GutterMarker>;
      const entries = [...blame.values()].sort((a, b) => a.line - b.line);
      const builder = new RangeSetBuilder<GutterMarker>();
      for (const entry of entries) {
        const depth = entry.uncommitted ? -1 : blameDepth(entry.time);
        const text = opts.annotateFormat?.(entry) ?? { date: "", author: entry.author };
        const line = view.state.doc.line(Math.min(Math.max(entry.line, 1), view.state.doc.lines));
        const title = entry.uncommitted
          ? entry.summary
          : [entry.short, entry.author, entry.summary].filter(Boolean).join(" · ");
        builder.add(
          line.from,
          line.from,
          new AnnotateMarker(entry.line, text.date, text.author, depth, entry.uncommitted, title),
        );
      }
      return builder.finish();
    },
    domEventHandlers: {
      click: (view, block, event) => openGutterMenu(view, block, event as MouseEvent, opts, false),
      contextmenu: (view, block, event) => openGutterMenu(view, block, event as MouseEvent, opts, true),
    },
  });
}

/** Opens the app's Git menu for the line under the gutter pointer. */
function openGutterMenu(
  view: EditorView,
  block: BlockInfo,
  event: MouseEvent,
  opts: EditorOptions,
  context: boolean,
): boolean {
  if (!opts.onGutterContext) return false;
  if (!context && event.button !== 0) return false;
  event.preventDefault();
  const line = view.state.doc.lineAt(block.from).number;
  // The line the menu is about is also where the caret goes.
  view.dispatch({ selection: { anchor: block.from } });
  opts.onGutterContext(line, event.clientX, event.clientY);
  return true;
}

/** Everything the source pane needs, with the doc replaced in place. */
export class SourceEditor {
  readonly view: EditorView;
  private languageConf = new Compartment();
  private wrapConf = new Compartment();
  private annotateConf = new Compartment();
  private annotateExtension: Extension;
  private currentLanguage = "";
  private savedDoc: string;
  private dirty = false;
  private onDirtyChange?: (dirty: boolean) => void;

  constructor(parent: HTMLElement, opts: EditorOptions) {
    let lastLine = 1;
    const editable = !!opts.editable;
    this.savedDoc = normalizeText(opts.doc);
    this.onDirtyChange = opts.onDirtyChange;
    this.annotateExtension = annotateGutter(opts);
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.savedDoc,
        extensions: [
          // Read-only keeps the document untouchable; the DOM stays editable
          // so the pane can take focus and answer to the arrow keys.
          EditorState.readOnly.of(!editable),
          // The blame column sits left of the line numbers, like an IDE.
          this.annotateConf.of(opts.annotate ? this.annotateExtension : []),
          lineNumbers({
            domEventHandlers: {
              click: (view, block, event) => openGutterMenu(view, block, event as MouseEvent, opts, false),
              contextmenu: (view, block, event) =>
                openGutterMenu(view, block, event as MouseEvent, opts, true),
            },
          }),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          search({ top: true }),
          highlightSelectionMatches(),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            {
              // Mod-b is what the IDE world presses; F12 is the other habit.
              key: "Mod-b",
              run: (view) => {
                if (jumpToDefinition(view)) return true;
                const word = wordAt(view, view.state.selection.main.head);
                if (!word || !opts.onJump) return false;
                opts.onJump(word);
                return true;
              },
            },
            {
              key: "Mod-Shift-b",
              run: (view) => {
                if (findReferences(view)) return true;
                const word = wordAt(view, view.state.selection.main.head);
                if (!word || !opts.onReferences) return false;
                opts.onReferences(word);
                return true;
              },
            },
            {
              // The language server answers when there is one; the text
              // search is the fallback, so the key always does something.
              key: "F12",
              run: (view) => {
                if (jumpToDefinition(view)) return true;
                const word = wordAt(view, view.state.selection.main.head);
                if (!word || !opts.onJump) return false;
                opts.onJump(word);
                return true;
              },
            },
            {
              key: "Shift-F12",
              run: (view) => {
                if (findReferences(view)) return true;
                const word = wordAt(view, view.state.selection.main.head);
                if (!word || !opts.onReferences) return false;
                opts.onReferences(word);
                return true;
              },
            },
            {
              key: "Mod-s",
              run: () => {
                if (opts.onSaveRequest && this.dirty) opts.onSaveRequest();
                return true;
              },
            },
          ]),
          EditorView.domEventHandlers({
            mousedown: (event, view) => {
              if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              const word = wordAt(view, pos);
              if (!word) return false;
              event.preventDefault();
              // Put the cursor on the click before asking the server, which
              // answers about the cursor, not about a mouse position.
              view.dispatch({ selection: { anchor: pos } });
              if (event.altKey) {
                if (!findReferences(view)) opts.onReferences?.(word);
                return true;
              }
              if (!jumpToDefinition(view)) (opts.onSymbol ?? opts.onJump)?.(word);
              return true;
            },
          }),
          syntaxHighlighting(editorHighlightStyle),
          theme,
          selectionTheme,
          this.languageConf.of([]),
          this.wrapConf.of(opts.wrap ? EditorView.lineWrapping : []),
          // Both start empty and fill in when the data arrives, so the
          // effects that carry it always have a field to land in.
          changeGutter(
            (hunk) => opts.onRollbackHunk?.(hunk),
            { add: opts.labels?.addedHere ?? "Changed here", del: opts.labels?.deletedHere ?? "Deleted here" },
          ),
          blameLine(opts.blameFormat),
          // The line the caret sits on is what "copy path with line" means;
          // report it when it moves rather than on every transaction.
          EditorView.updateListener.of((u) => {
            if (u.docChanged) this.noteDoc(u.state.doc.toString());
            if (!u.selectionSet && !u.docChanged) return;
            const n = u.state.doc.lineAt(u.state.selection.main.head).number;
            if (n === lastLine) return;
            lastLine = n;
            opts.onCaret?.(n);
          }),
        ],
      }),
    });
    void this.setLanguage(opts.language);
    if (opts.changes) this.setChanges(opts.changes);
    if (opts.blame) this.setBlame(opts.blame);
    this.setDirty(this.view.state.doc.toString() !== this.savedDoc);
  }

  private noteDoc(text: string) {
    this.setDirty(text !== this.savedDoc);
  }

  private setDirty(dirty: boolean) {
    if (this.dirty === dirty) return;
    this.dirty = dirty;
    this.onDirtyChange?.(dirty);
  }

  /** The text the page would write to disk. */
  getDoc(): string {
    return this.view.state.doc.toString();
  }

  isDirty(): boolean {
    return this.dirty;
  }

  /** Marks the current document as the saved baseline after a successful
   *  write. If the user kept typing during the write, the saved text is the
   *  older snapshot and the document stays dirty. */
  markSaved(saved: string) {
    this.savedDoc = saved;
    this.setDirty(this.view.state.doc.toString() !== saved);
  }

  /** Swaps the shown document without tearing the editor down. The change
   *  bars and the blame belong to the old document, so they are cleared in
   *  the same transaction; the fetch that follows fills them back in. Unsaved
   *  edits win over a refresh from disk. */
  setDoc(doc: string, language: string) {
    const incoming = normalizeText(doc);
    const current = this.view.state.doc.toString();
    if (current !== incoming) {
      if (this.dirty) return;
      this.savedDoc = incoming;
      this.view.dispatch({
        changes: { from: 0, to: this.view.state.doc.length, insert: incoming },
        effects: [setChanges.of([]), setBlame.of(new Map())],
      });
    } else if (this.savedDoc !== incoming) {
      this.savedDoc = incoming;
      this.setDirty(false);
    }
    if (language !== this.currentLanguage) void this.setLanguage(language);
  }

  async setLanguage(name: string) {
    this.currentLanguage = name;
    const support = await loadLanguage(name);
    if (this.currentLanguage !== name) return;
    this.view.dispatch({ effects: this.languageConf.reconfigure(support ?? []) });
  }

  setWrap(wrap: boolean) {
    this.view.dispatch({ effects: this.wrapConf.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  setChanges(ranges: ChangeRange[]) {
    this.view.dispatch({ effects: setChanges.of(ranges) });
  }

  setBlame(lines: BlameLine[] | null) {
    const map = new Map<number, BlameLine>();
    for (const line of lines ?? []) map.set(line.line, line);
    this.view.dispatch({ effects: setBlame.of(map) });
  }

  /** Shows or hides the blame annotation column. */
  setAnnotate(enabled: boolean) {
    this.view.dispatch({
      effects: this.annotateConf.reconfigure(enabled ? this.annotateExtension : []),
    });
  }

  revealLine(line: number, attempt = 0) {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    this.view.dispatch({ selection: { anchor: target.from } });
    // A pane that has not been laid out yet cannot scroll anywhere, and a
    // jump usually happens in the frame the document was created in.
    if (this.view.contentDOM.clientHeight === 0 && attempt < 10) {
      requestAnimationFrame(() => this.revealLine(line, attempt + 1));
      return;
    }
    this.view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
    this.view.focus();
  }

  /** Adds the plugin an LSP session contributes, when one is connected. */
  withExtension(extension: Extension) {
    this.view.dispatch({ effects: StateEffect.appendConfig.of(extension) });
  }

  destroy() {
    this.view.destroy();
  }
}

function wordAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  const isWord = (ch: string) => /[\w$]/.test(ch);
  while (start > 0 && isWord(text[start - 1] ?? "")) start--;
  while (end < text.length && isWord(text[end] ?? "")) end++;
  const word = text.slice(start, end);
  if (!word || /^\d+$/.test(word)) return null;
  return word;
}
