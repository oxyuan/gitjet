import {
  Compartment,
  EditorSelection,
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
  type Command,
  type DecorationSet,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import {
  copyLineDown,
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  toggleBlockComment,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldAll,
  foldCode,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  toggleFold,
  unfoldAll,
  unfoldCode,
  type LanguageSupport,
} from "@codemirror/language";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  gotoLine,
  highlightSelectionMatches,
  replaceAll,
  replaceNext,
  search,
  searchKeymap,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import { autocompletion, closeBrackets, completeAnyWord } from "@codemirror/autocomplete";
import { formatDocument, renameSymbol } from "@codemirror/lsp-client";
import { languages } from "@codemirror/language-data";
import { lspSupports, lookupTargets, lookupUsages, openNavigationTarget } from "./lsp";
import {
  declarationUnderCaret,
  targetPoint,
  type EditorNavigationRequest,
  type NavigationPoint,
  type TargetKind,
} from "./navigation";
import { editorHighlightStyle } from "./highlight";
import type { BlameLine } from "./mygo";
import { blameDepth, type ChangeRange } from "./annotate";
import { normalizeText } from "./editorText";
import { expandSelection } from "./selection";
import { occurrencesIn } from "./occurrences";

/** The editor paints with the app's tokens, so there is one palette, not two. */
export const editorTheme = EditorView.theme({
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
  // A layer, not a colour: a merge band paints the line's background, and the
  // caret's line must tint that band rather than replace it.
  ".cm-activeLine": {
    backgroundColor: "transparent",
    backgroundImage:
      "linear-gradient(color-mix(in srgb, var(--fg) 4%, transparent), color-mix(in srgb, var(--fg) 4%, transparent))",
  },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--fg)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--warning) 30%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--warning) 55%, transparent)" },
  // Completion popup, hover docs and the go-to-line/rename dialogs use the
  // app's palette; CodeMirror's own base theme is light-only.
  ".cm-tooltip": {
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--panel-raised)",
    color: "var(--fg)",
    boxShadow: "var(--shadow-md)",
  },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", maxHeight: "260px" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--selection-strong)",
    color: "var(--fg)",
  },
  ".cm-completionIcon": { color: "var(--muted)" },
  ".cm-completionDetail": { color: "var(--muted)", fontStyle: "normal" },
  ".cm-completionMatchedText": {
    color: "var(--accent)",
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-panels-bottom:has(.cm-dialog)": {
    position: "absolute",
    right: "0",
    bottom: "12%",
    left: "0",
    zIndex: "30",
    display: "flex",
    justifyContent: "center",
    border: "none",
    backgroundColor: "transparent",
  },
  ".cm-dialog": {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--panel-raised)",
    color: "var(--fg)",
    boxShadow: "var(--shadow-md)",
    fontSize: "12px",
  },
  ".cm-dialog form": { display: "flex", alignItems: "center", gap: "8px" },
  ".cm-textfield": {
    height: "26px",
    padding: "0 8px",
    border: "1px solid var(--border-strong)",
    borderRadius: "4px",
    backgroundColor: "var(--input-bg)",
    color: "var(--fg)",
    font: "inherit",
    outline: "none",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--accent)",
    boxShadow: "0 0 0 1px var(--accent-soft)",
  },
  ".cm-button": {
    height: "26px",
    padding: "0 10px",
    border: "1px solid var(--accent)",
    borderRadius: "5px",
    backgroundColor: "var(--accent)",
    color: "var(--accent-fg)",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-dialog-close": {
    padding: "0 4px",
    border: "none",
    backgroundColor: "transparent",
    color: "var(--muted)",
    fontSize: "14px",
    cursor: "pointer",
  },
  ".cm-dialog-close:hover": { color: "var(--fg)" },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 3px",
    color: "var(--muted-2)",
    cursor: "pointer",
  },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--fg)" },
  ".cm-fold-marker": { fontSize: "12px", lineHeight: "1" },
  ".cm-foldPlaceholder": {
    padding: "0 5px",
    border: "1px solid var(--border-strong)",
    borderRadius: "4px",
    backgroundColor: "var(--panel-2)",
    color: "var(--muted)",
  },
});

/** CodeMirror's base theme paints the selection itself: `&light
 *  .cm-selectionBackground` (#d9d9d9), and while focused `&light.cm-focused >
 *  .cm-scroller > .cm-selectionLayer .cm-selectionBackground` (#d7d4f0) —
 *  five classes. A shorter selector loses on specificity, which is why a dark
 *  pane showed a near-white block that swallowed the code. Same shape, same
 *  class count, top precedence, so the token is the one that lands. */
export const editorSelectionTheme = Prec.highest(
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

/** Loads the grammar for a language name, once. Unknown names get plain text.
 *  A grammar is a chunk of its own, fetched the first time its language is
 *  needed, and that fetch can fail by itself — a dev server re-optimizing its
 *  dependencies replaces the chunk's URL under the running page, and a failed
 *  module URL stays failed for the life of the page. Such a failure is not a
 *  grammar, so it is not what "once" remembers, and it is not swallowed: the
 *  page goes plain until it reloads, and the console is the only thing that
 *  can say why. */
export function loadLanguage(name: string): Promise<LanguageSupport | null> {
  const key = languageAliases[name] ?? name;
  const cached = languageCache.get(key);
  if (cached) return cached;
  const description = languages.find(
    (d) => d.name.toLowerCase() === key || d.alias.includes(key) || d.extensions.includes(key),
  );
  if (!description) return Promise.resolve(null);
  const loading = description.load().then(
    (support) => support as LanguageSupport | null,
    (err: unknown) => {
      languageCache.delete(key);
      console.warn(`gitjet: the ${key} grammar did not load; reload the window to try again`, err);
      return null;
    },
  );
  languageCache.set(key, loading);
  return loading;
}

/** Copy for CodeMirror's own dialogs, completion popup and fold gutter, in
 *  the reader's language. The find bar and blame column have their own. */
const PHRASES: Record<"en" | "zh", Record<string, string>> = {
  en: {
    "Go to line": "Go to line",
    go: "Go",
    "New name": "New name",
    rename: "Rename",
    close: "Close",
    Completions: "Completions",
    "current match": "current match",
    "on line": "on line",
    Find: "Find",
    Replace: "Replace",
    all: "All",
    "by word": "Whole word",
    "match case": "Match case",
    next: "Next",
    previous: "Previous",
    regexp: "Regexp",
    "replace all": "Replace all",
    replace: "Replace",
    to: "to",
    "Fold line": "Fold line",
    "Unfold line": "Unfold line",
    "folded code": "folded code",
    unfold: "Unfold",
    "Folded lines": "Folded lines",
    "Unfolded lines": "Unfolded lines",
    "Control character": "Control character",
  },
  zh: {
    "Go to line": "跳转到行",
    go: "跳转",
    "New name": "新名称",
    rename: "重命名",
    close: "关闭",
    Completions: "补全",
    "current match": "当前匹配",
    "on line": "位于行",
    Find: "查找",
    Replace: "替换",
    all: "全部",
    "by word": "全词匹配",
    "match case": "区分大小写",
    next: "下一个",
    previous: "上一个",
    regexp: "正则",
    "replace all": "全部替换",
    replace: "替换",
    to: "到",
    "Fold line": "折叠此行",
    "Unfold line": "展开此行",
    "folded code": "已折叠的代码",
    unfold: "展开",
    "Folded lines": "折叠的行",
    "Unfolded lines": "展开的行",
    "Control character": "控制字符",
  },
};

/** The selections an extend/shrink chain climbed through. Any other move of
 *  the caret, or an edit, starts a new chain, as a click resets the IDE's
 *  selection history. */
const pushSelection = StateEffect.define<EditorSelection>();
const popSelection = StateEffect.define<null>();
const selectionChain = StateField.define<EditorSelection[]>({
  create: () => [],
  update(chain, tr) {
    if (tr.docChanged) return [];
    for (const effect of tr.effects) {
      if (effect.is(pushSelection)) return [...chain, effect.value];
      if (effect.is(popSelection)) return chain.slice(0, -1);
    }
    return tr.selection ? [] : chain;
  },
});

/** IDEA's Extend Selection: ⌥↑ on macOS, and the same chord elsewhere since
 *  Ctrl+W belongs to the tab strip. */
const extendSelection: Command = (view) => {
  const next = expandSelection(view.state);
  if (!next) return false;
  view.dispatch({
    selection: EditorSelection.range(next.from, next.to),
    effects: pushSelection.of(view.state.selection),
    scrollIntoView: true,
  });
  return true;
};

/** IDEA's Shrink Selection: ⌥↓, stepping back through the chain. */
const shrinkSelection: Command = (view) => {
  const chain = view.state.field(selectionChain);
  const previous = chain[chain.length - 1];
  if (!previous) return false;
  view.dispatch({
    selection: previous,
    effects: popSelection.of(null),
    scrollIntoView: true,
  });
  return true;
};

/** IDEA's Duplicate Line or Selection: ⌘D. A selection is copied right after
 *  itself and the copy stays selected; a bare caret duplicates its lines. */
const duplicateLineOrSelection: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  if (state.selection.ranges.every((range) => range.empty)) return copyLineDown(view);
  view.dispatch(
    state.changeByRange((range) => {
      if (range.empty) return { range };
      const text = state.sliceDoc(range.from, range.to);
      return {
        changes: { from: range.to, insert: text },
        range: EditorSelection.range(range.to, range.to + text.length),
      };
    }),
  );
  return true;
};

/** Paints every other occurrence of the identifier under the caret, as the
 *  IDE's "Highlight usages of element at caret" does. It follows the caret,
 *  ignores a selection (the find highlight owns that state) and only scans
 *  the visible document, so a large file costs no more than the screen. */
function symbolOccurrences(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }
      private build(view: EditorView): DecorationSet {
        const selection = view.state.selection;
        if (!selection.main.empty || selection.ranges.length > 1) return Decoration.none;
        const head = selection.main.head;
        const word = wordRangeAt(view, head);
        if (!word) return Decoration.none;
        const marks: { from: number; to: number }[] = [];
        for (const visible of view.visibleRanges) {
          for (const hit of occurrencesIn(view.state.sliceDoc(visible.from, visible.to), word.word)) {
            marks.push({ from: visible.from + hit.from, to: visible.from + hit.to });
          }
        }
        return Decoration.set(
          marks.map((mark) =>
            Decoration.mark({
              class:
                mark.from <= head && mark.to > head
                  ? "cm-occurrence cm-occurrence-current"
                  : "cm-occurrence",
            }).range(mark.from, mark.to),
          ),
        );
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

class ChangeMarker extends GutterMarker {
  constructor(
    readonly hunk: number,
    readonly kind: "add" | "del" | "mod",
    readonly line: number,
    readonly onClick: (
      hunk: number,
      kind: "add" | "del" | "mod",
      line: number,
      alt: boolean,
      x: number,
      y: number,
    ) => void,
    readonly label: string,
  ) {
    super();
  }
  eq(other: ChangeMarker) {
    // The line matters: a reused marker would otherwise fire the handler
    // closed over the line it used to mark.
    return (
      other.hunk === this.hunk &&
      other.kind === this.kind &&
      other.line === this.line &&
      other.label === this.label
    );
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
      this.onClick(this.hunk, this.kind, this.line, event.altKey, event.clientX, event.clientY);
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

/** A gutter column of change bars, one per changed line as an IDE draws
 *  them, clickable per hunk. A deletion has no line of its own, so its wedge
 *  sits on the line the text disappeared from. */
function changeGutter(
  onClick: (hunk: number, kind: "add" | "del" | "mod", line: number, alt: boolean, x: number, y: number) => void,
  labels: { add: string; del: string; mod: string },
): Extension {
  return [
    changeField,
    gutter({
      class: "cm-change-gutter",
      markers: (view) => {
        const ranges = view.state.field(changeField);
        if (ranges.length === 0) return RangeSet.empty as RangeSet<GutterMarker>;
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const range of ranges) {
          const label = range.kind === "add" ? labels.add : range.kind === "mod" ? labels.mod : labels.del;
          // Every line of a span gets its own bar, the way the IDE covers a
          // changed block line by line instead of marking only its head.
          const first = Math.min(Math.max(range.start, 1), view.state.doc.lines);
          const last = Math.min(first + Math.max(range.count - 1, 0), view.state.doc.lines);
          for (let no = first; no <= last; no++) {
            const line = view.state.doc.line(no);
            builder.add(
              line.from,
              line.from,
              new ChangeMarker(range.hunk, range.kind, no, onClick, label),
            );
          }
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

/** Copy for the find bar, in the reader's language. */
const findLabels = {
  en: {
    find: "Find",
    replace: "Replace",
    next: "Next match",
    previous: "Previous match",
    selectAll: "Select all matches",
    selectAllShort: "All",
    close: "Close",
    matchCase: "Match case",
    wholeWord: "Whole word",
    regexp: "Regular expression",
    replaceAll: "Replace all",
    none: "No results",
    of: "{index} / {total}",
    total: "{total} matches",
    totalOne: "{total} match",
  },
  zh: {
    find: "查找",
    replace: "替换",
    next: "下一处",
    previous: "上一处",
    selectAll: "选择全部匹配项",
    selectAllShort: "全选",
    close: "关闭",
    matchCase: "区分大小写",
    wholeWord: "全词匹配",
    regexp: "正则表达式",
    replaceAll: "全部替换",
    none: "无结果",
    of: "{index} / {total}",
    total: "共 {total} 个",
    totalOne: "共 {total} 个",
  },
} as const;

type FindLabels = Record<keyof (typeof findLabels)["en"], string>;

function fill(text: string, vars: Record<string, string | number>): string {
  let out = text;
  for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
  return out;
}

/** At most this many matches are counted; past it the bar says "2000+"
 *  instead of walking a whole file on every keystroke. */
const matchCountCap = 2000;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value as EventListener);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value != null) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
};

/** The find and replace bar: a compact card floating at the top-right of the
 *  text, the way an IDE docks it, instead of CodeMirror's default strip of
 *  text buttons. It drives the same commands the default panel does, so the
 *  keymap, highlighting and announcements keep working. */
class FindBar implements Panel {
  readonly dom: HTMLElement;
  /** Docked to the top of the text, where the panel group puts it. */
  readonly top = true;
  readonly pos = 80;
  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement | null = null;
  private count: HTMLElement;
  private toggles: HTMLButtonElement[];
  /** The field the caret came from; buttons hand the focus back to it. */
  private lastField: HTMLInputElement | null = null;
  private caseSensitive: boolean;
  private wholeWord: boolean;
  private regexp: boolean;
  private query: SearchQuery;

  constructor(
    private view: EditorView,
    private labels: FindLabels,
  ) {
    const current = getSearchQuery(view.state);
    this.query = current;
    this.caseSensitive = current.caseSensitive;
    this.wholeWord = current.wholeWord;
    this.regexp = current.regexp;

    this.searchField = el("input", {
      class: "find-input",
      "main-field": true,
      type: "text",
      placeholder: labels.find,
      "aria-label": labels.find,
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
      autocomplete: "off",
    });
    this.searchField.value = current.search;
    this.searchField.addEventListener("focus", () => (this.lastField = this.searchField));
    this.count = el("span", { class: "find-count" });

    const icon = (title: string, text: string) =>
      el("button", {
        class: "find-icon",
        type: "button",
        title,
        "aria-label": title,
        tabindex: "-1",
      }, [text]);

    const toggle = (title: string, text: string, on: boolean, flip: () => void) => {
      const button = el("button", {
        class: "find-toggle" + (on ? " active" : ""),
        type: "button",
        title,
        "aria-label": title,
        "aria-pressed": on ? "true" : "false",
        tabindex: "-1",
      }, [text]);
      this.press(button, () => {
        flip();
        this.commit();
      });
      return button;
    };

    const first = el("div", { class: "find-row" }, [
      this.searchField,
      this.count,
      this.press(icon(labels.previous, "↑"), () => findPrevious(this.view)),
      this.press(icon(labels.next, "↓"), () => findNext(this.view)),
      this.press(icon(labels.close, "✕"), () => closeSearchPanel(this.view)),
    ]);

    const caseToggle = toggle(labels.matchCase, "Aa", this.caseSensitive, () => {
      this.caseSensitive = !this.caseSensitive;
    });
    const wordToggle = toggle(labels.wholeWord, "ab", this.wholeWord, () => {
      this.wholeWord = !this.wholeWord;
    });
    const reToggle = toggle(labels.regexp, ".*", this.regexp, () => {
      this.regexp = !this.regexp;
    });
    this.toggles = [caseToggle, wordToggle, reToggle];
    const selectAll = el("button", {
      class: "find-text-btn",
      type: "button",
      title: labels.selectAll,
      tabindex: "-1",
    }, [labels.selectAllShort]);
    this.press(selectAll, () => {
      this.commit();
      selectMatches(this.view);
    });
    const second = el("div", { class: "find-row find-options" }, [caseToggle, wordToggle, reToggle, selectAll]);

    const rows = [first, second];
    if (!view.state.readOnly) {
      this.replaceField = el("input", {
        class: "find-input",
        type: "text",
        placeholder: labels.replace,
        "aria-label": labels.replace,
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
        autocomplete: "off",
      });
      this.replaceField.value = current.replace;
      this.replaceField.addEventListener("focus", () => (this.lastField = this.replaceField));
      const replace = el("button", {
        class: "find-text-btn",
        type: "button",
        tabindex: "-1",
      }, [labels.replace]);
      this.press(replace, () => {
        this.commit();
        replaceNext(this.view);
      });
      const replaceAllBtn = el("button", {
        class: "find-text-btn",
        type: "button",
        tabindex: "-1",
      }, [labels.replaceAll]);
      this.press(replaceAllBtn, () => {
        this.commit();
        replaceAll(this.view);
      });
      rows.push(el("div", { class: "find-row" }, [this.replaceField, replace, replaceAllBtn]));
    }

    this.dom = el("div", { class: "find-bar", role: "search" }, rows);
    this.dom.addEventListener("input", () => this.commit());
    this.dom.addEventListener("keydown", (event) => this.keydown(event as KeyboardEvent));
    this.refresh();
  }

  mount() {
    this.searchField.select();
  }

  update(update: ViewUpdate) {
    const query = getSearchQuery(update.state);
    if (!query.eq(this.query)) {
      this.query = query;
      this.searchField.value = query.search;
      if (this.replaceField) this.replaceField.value = query.replace;
      this.syncToggles(query);
    }
    this.refresh();
  }

  /**
   * A button acts on the press, not on the click. Pressing first moves the
   * caret out of the text field, and WebKit spends a press that also clears
   * the field's selection: the toggle only answered the second click and the
   * caret jumped around. Preventing the press keeps the field focused, and
   * the click it would have produced is ignored; keyboard activation still
   * arrives as a plain click.
   */
  private press(button: HTMLElement, action: () => void): HTMLElement {
    let pressed = false;
    button.addEventListener("mousedown", (event) => {
      if ((event as MouseEvent).button !== 0) return;
      event.preventDefault();
      pressed = true;
      action();
    });
    // The click from this press arrives before a zero-delay timer can run;
    // a press that ends elsewhere fires no click and clears the flag anyway.
    button.addEventListener("mouseup", () => window.setTimeout(() => (pressed = false), 0));
    button.addEventListener("click", (event) => {
      if (pressed) {
        event.preventDefault();
        return;
      }
      action();
      this.lastField?.focus();
    });
    return button;
  }

  private syncToggles(query: SearchQuery) {
    const states = [query.caseSensitive, query.wholeWord, query.regexp];
    this.toggles.forEach((toggle, i) => {
      const on = !!states[i];
      toggle.classList.toggle("active", on);
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  private commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      replace: this.replaceField?.value ?? "",
      caseSensitive: this.caseSensitive,
      wholeWord: this.wholeWord,
      regexp: this.regexp,
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.syncToggles(query);
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    this.refresh();
  }

  /** Writes the match count in the bar: the selected one when the caret sits
   *  on a match, the total otherwise. */
  private refresh() {
    const state = this.view.state;
    const query = this.query;
    if (!query.search) {
      this.count.textContent = "";
      this.count.classList.remove("none");
      return;
    }
    let total = 0;
    let index = 0;
    try {
      const selection = state.selection.main;
      const cursor = query.getCursor(state);
      for (let match = cursor.next(); !match.done; match = cursor.next()) {
        total++;
        const { from, to } = match.value;
        if (!selection.empty && from === selection.from && to === selection.to) index = total;
        if (total >= matchCountCap) break;
      }
    } catch {
      this.count.textContent = this.labels.none;
      this.count.classList.add("none");
      return;
    }
    this.count.classList.toggle("none", total === 0);
    if (total === 0) {
      this.count.textContent = this.labels.none;
    } else if (total >= matchCountCap) {
      this.count.textContent = `${matchCountCap}+`;
    } else {
      this.count.textContent = index
        ? fill(this.labels.of, { index, total })
        : fill(total === 1 ? this.labels.totalOne : this.labels.total, { total });
    }
  }

  private keydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearchPanel(this.view);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (target === this.searchField) {
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (target === this.replaceField) {
      this.commit();
      replaceNext(this.view);
    }
  }
}

export type EditorOptions = {
  doc: string;
  /** The text on disk. A document restored from a draft differs from it and
   *  must open dirty, or Save stays disabled until the user types. */
  baseline?: string;
  language: string;
  wrap: boolean;
  /** The reader's language, for the find bar's copy. */
  lang?: "en" | "zh";
  /** Working-tree files are editable; the index and historical revisions are
   *  read-only. Read-only still leaves the DOM focusable. */
  editable?: boolean;
  /** Reports when the document differs from the last saved text, so the tab
   *  can show a dot and "close unmodified" can leave it alone. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Ctrl/Cmd-S. The page owns the actual write. */
  onSaveRequest?: () => void;
  /** Copy the editor needs, in the reader's language. */
  labels?: { addedHere?: string; deletedHere?: string; modifiedHere?: string };
  /** What to say when a language-server command has no server behind it. */
  notices?: { noFormatter: string; noRename: string };
  /** Formats one blame line; the app owns the wording. */
  blameFormat?: (line: BlameLine, fallback: string) => string;
  changes?: ChangeRange[];
  blame?: BlameLine[] | null;
  /** A click on a change bar, with the pointer position for its menu.
   *  Alt-clicking is the quick "roll back this line" path. */
  onChangeClick?: (hunk: number, line: number, alt: boolean, x: number, y: number) => void;
  /** Repository-relative path of the document, so a jump can remember where
   *  it started. */
  path: string;
  /** The revision this editor shows; "" is the working tree. */
  revision: string;
  /** What a declaration, implementation or usage request produced. The app
   *  owns the chooser and the usage list, so the editor never draws them. */
  onNavigate?: (request: EditorNavigationRequest) => void;
  /** A jump the editor performed itself, for the navigation history. */
  onNavigated?: (from: NavigationPoint, to: NavigationPoint) => void;
  /** Back (-1) and forward (1), for the IDE's history keys. */
  onHistory?: (delta: -1 | 1) => void;
  /** Fires with the 1-based line and column under the caret, for the status
   *  readout and for copying a path with its line number. */
  onCaret?: (line: number, column: number) => void;
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

const NAV_LABELS = {
  en: {
    noImplementation: "No implementation found",
    noType: "No type declaration found",
    openFailed: "Could not open the declaration",
  },
  zh: {
    noImplementation: "没有找到该方法的实现",
    noType: "没有找到类型声明",
    openFailed: "无法打开声明所在位置",
  },
} as const;

/** The line and column a jump starts from, for the history. */
function originAt(view: EditorView, pos: number, path: string, revision: string): NavigationPoint {
  const line = view.state.doc.lineAt(pos);
  return { path, line: line.number, column: pos - line.from + 1, revision };
}

/** Where a chooser for this position should appear, when the position is on
 *  screen. */
function anchorAt(view: EditorView, pos: number): { x: number; y: number } | undefined {
  const rect = view.coordsAtPos(pos);
  return rect ? { x: rect.left, y: rect.bottom } : undefined;
}

/** Links symbol under the pointer while Meta or Control is held, so a
 *  Cmd-click reads as a link the way an IDE's does. The decoration follows
 *  the word under the pointer, not the caret. */
function symbolLinks() {
  const setLink = StateEffect.define<{ from: number; to: number } | null>();
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(marks, tr) {
      let next = marks.map(tr.changes);
      for (const effect of tr.effects) {
        if (!effect.is(setLink)) continue;
        next = effect.value
          ? Decoration.set([Decoration.mark({ class: "cm-symbol-link" }).range(effect.value.from, effect.value.to)])
          : Decoration.none;
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const plugin = ViewPlugin.fromClass(
    class {
      private held = false;
      private at: { x: number; y: number } | null = null;
      private linked: { from: number; to: number } | null = null;
      private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Meta" && event.key !== "Control") return;
        this.held = true;
        this.refresh();
      };
      private readonly onKeyUp = (event: KeyboardEvent) => {
        if (event.key !== "Meta" && event.key !== "Control") return;
        this.held = false;
        this.clear();
      };
      private readonly onMove = (event: MouseEvent) => {
        this.at = { x: event.clientX, y: event.clientY };
        this.refresh();
      };
      private readonly onLeave = () => {
        this.at = null;
        this.clear();
      };
      private readonly onBlur = () => {
        this.held = false;
        this.clear();
      };
      constructor(readonly view: EditorView) {
        view.dom.addEventListener("mousemove", this.onMove);
        view.dom.addEventListener("mouseleave", this.onLeave);
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("keyup", this.onKeyUp, true);
        window.addEventListener("blur", this.onBlur);
      }
      private refresh() {
        if (!this.held || !this.at) {
          this.clear();
          return;
        }
        const pos = this.view.posAtCoords(this.at);
        const word = pos === null ? null : wordRangeAt(this.view, pos);
        const next = word ? { from: word.from, to: word.to } : null;
        if (next?.from === this.linked?.from && next?.to === this.linked?.to) return;
        this.linked = next;
        this.view.dispatch({ effects: setLink.of(next) });
      }
      private clear() {
        if (!this.linked && this.view.state.field(field).size === 0) return;
        this.linked = null;
        this.view.dispatch({ effects: setLink.of(null) });
      }
      destroy() {
        this.view.dom.removeEventListener("mousemove", this.onMove);
        this.view.dom.removeEventListener("mouseleave", this.onLeave);
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("keyup", this.onKeyUp, true);
        window.removeEventListener("blur", this.onBlur);
      }
    },
  );
  return [field, plugin];
}

/** Everything the source pane needs, with the doc replaced in place. */
export class SourceEditor {
  readonly view: EditorView;
  /** Runs one of the IDE navigation commands at a document offset, for the
   *  pane's context menu. */
  readonly navigateAt: (
    pos: number,
    command: TargetKind | "usages",
  ) => void;
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
    let lastColumn = 1;
    const editable = !!opts.editable;
    const lang = opts.lang ?? "en";
    this.savedDoc = normalizeText(opts.baseline ?? opts.doc);
    this.onDirtyChange = opts.onDirtyChange;
    this.annotateExtension = annotateGutter(opts);
    const labels = NAV_LABELS[lang];

    // IDEA's Go to Declaration or Usages: a reference jumps to its
    // declaration, while a declaration answers with its usages instead of
    // navigating to the line already on screen.
    const goTo = (view: EditorView, pos: number, kind: TargetKind) => {
      const word = wordAt(view, pos);
      if (!word) return;
      const origin = originAt(view, pos, opts.path, opts.revision);
      const missing = () => {
        if (kind === "definition") {
          opts.onNavigate?.({
            kind: "text",
            word,
            language: opts.language,
            origin,
            action: "jump",
            anchor: anchorAt(view, pos),
          });
        } else {
          opts.onNavigate?.({
            kind: "notice",
            message: kind === "implementation" ? labels.noImplementation : labels.noType,
          });
        }
      };
      void (async () => {
        const lookup = await lookupTargets(view, pos, kind);
        if (!lookup.supported || lookup.failed) {
          missing();
          return;
        }
        if (declarationUnderCaret(kind, opts.revision, lookup.targets, opts.path, origin.line, origin.column)) {
          // The declaration is under the caret. A server that cannot answer
          // references leaves the jump to the text search, as before.
          const usages = await lookupUsages(view, pos, lookup.targets);
          if (!usages.supported || usages.failed) {
            missing();
            return;
          }
          opts.onNavigate?.({
            kind: "usages",
            word,
            targets: usages.targets,
            definitions: usages.definitions,
            origin,
          });
          return;
        }
        if (lookup.targets.length === 0) {
          missing();
          return;
        }
        if (lookup.targets.length === 1) {
          const target = lookup.targets[0]!;
          if (await openNavigationTarget(target, opts.revision === "" ? view : undefined)) {
            opts.onNavigated?.(origin, targetPoint(target));
          } else {
            opts.onNavigate?.({ kind: "notice", message: labels.openFailed });
          }
          return;
        }
        opts.onNavigate?.({
          kind: "targets",
          word,
          targetKind: kind,
          targets: lookup.targets,
          origin,
          anchor: anchorAt(view, pos),
        });
      })();
    };

    const findUsages = (view: EditorView, pos: number) => {
      const word = wordAt(view, pos);
      if (!word) return;
      const origin = originAt(view, pos, opts.path, opts.revision);
      void (async () => {
        const lookup = await lookupUsages(view, pos);
        if (!lookup.supported || lookup.failed) {
          opts.onNavigate?.({ kind: "text", word, language: opts.language, origin, action: "list" });
          return;
        }
        opts.onNavigate?.({
          kind: "usages",
          word,
          targets: lookup.targets,
          definitions: lookup.definitions,
          origin,
        });
      })();
    };

    this.navigateAt = (pos, command) => {
      if (command === "usages") findUsages(this.view, pos);
      else goTo(this.view, pos, command);
    };

    // IDEA's Reformat Code and Rename are language-server commands; without a
    // server (or outside the working tree) the pane says why instead of
    // silently formatting nothing.
    const format = (view: EditorView) => {
      if (!editable || !lspSupports(view, "documentFormattingProvider")) {
        opts.onNavigate?.({
          kind: "notice",
          message: opts.notices?.noFormatter ?? "No formatter is available for this file",
        });
        return true;
      }
      return formatDocument(view);
    };
    const rename = (view: EditorView) => {
      if (!editable || !renameSymbol(view)) {
        opts.onNavigate?.({
          kind: "notice",
          message: opts.notices?.noRename ?? "A language server is needed to rename this symbol",
        });
      }
      return true;
    };
    const clickAddsSelectionRange = EditorView.clickAddsSelectionRange.of((event) => event.altKey);

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
          // IDEA's folding: a chevron on every foldable line, the same state
          // the fold commands act on.
          codeFolding(),
          foldGutter({
            markerDOM: (open) => {
              const marker = document.createElement("span");
              marker.className = open ? "cm-fold-marker" : "cm-fold-marker closed";
              marker.textContent = open ? "⌄" : "›";
              return marker;
            },
          }),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          bracketMatching(),
          closeBrackets(),
          indentOnInput(),
          search({ top: true, createPanel: (view) => new FindBar(view, findLabels[lang]) }),
          highlightSelectionMatches(),
          history(),
          // Completion edits the document, so it belongs to the working tree
          // only. IDEA's basic completion also offers words already in the
          // file; grammars and the language server add their own sources.
          ...(editable ? [autocompletion()] : []),
          ...(editable ? [EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }])] : []),
          EditorState.phrases.of(PHRASES[lang]),
          selectionChain,
          // IDEA's multiple carets: ⌥-click adds one, and the add-caret
          // commands need this facet before they will do anything.
          EditorState.allowMultipleSelections.of(true),
          clickAddsSelectionRange,
          symbolOccurrences(),
          Prec.high(
            keymap.of([
              {
                // IDEA's editing keys. The chords are the IDE's own: ⌘D
                // duplicates, ⌘⌫ deletes a line, ⇧⌘↑/↓ moves a statement,
                // ⌥↑/↓ extend and shrink the selection, ⌘L goes to a line,
                // ⌘. toggles a fold and ⌘⌥L reformats.
                key: "Mod-d",
                run: duplicateLineOrSelection,
                preventDefault: true,
              },
              { key: "Ctrl-y", mac: "Mod-Backspace", run: deleteLine, preventDefault: true },
              { key: "Mod-Shift-ArrowUp", run: moveLineUp, preventDefault: true },
              { key: "Mod-Shift-ArrowDown", run: moveLineDown, preventDefault: true },
              { key: "Alt-ArrowUp", run: extendSelection, preventDefault: true },
              { key: "Alt-ArrowDown", run: shrinkSelection, preventDefault: true },
              { key: "Ctrl-g", mac: "Mod-l", run: gotoLine, preventDefault: true },
              { key: "Mod--", run: foldCode, preventDefault: true },
              { key: "Mod-=", run: unfoldCode, preventDefault: true },
              { key: "Mod-Shift--", run: foldAll, preventDefault: true },
              { key: "Mod-Shift-=", run: unfoldAll, preventDefault: true },
              { key: "Mod-.", run: toggleFold, preventDefault: true },
              { key: "Mod-/", shift: toggleBlockComment },
              { key: "Mod-Alt-/", run: toggleBlockComment, preventDefault: true },
              { key: "Mod-Alt-l", run: format, preventDefault: true },
              { key: "Shift-F6", run: rename, preventDefault: true },
              {
                // The IDE's set: declaration, implementation and type
                // declaration each get their own chord, and the history has the
                // two pairs of keys IDEA accepts. F12/Shift+F12 stay for the
                // editors that use them.
                key: "Mod-b",
                run: (view) => {
                  goTo(view, view.state.selection.main.head, "definition");
                  return true;
                },
              },
              {
                key: "Mod-Alt-b",
                run: (view) => {
                  goTo(view, view.state.selection.main.head, "implementation");
                  return true;
                },
              },
              {
                // IDEA's macOS map binds the type declaration to Ctrl+Shift+B
                // (Meta+Shift+Click); on Windows and Linux the same chord is
                // Ctrl+Shift+B, so one binding serves every platform.
                key: "Ctrl-Shift-b",
                run: (view) => {
                  goTo(view, view.state.selection.main.head, "typeDefinition");
                  return true;
                },
              },
              {
                key: "F12",
                run: (view) => {
                  goTo(view, view.state.selection.main.head, "definition");
                  return true;
                },
              },
              {
                key: "Alt-F7",
                run: (view) => {
                  findUsages(view, view.state.selection.main.head);
                  return true;
                },
              },
              {
                key: "Mod-Alt-F7",
                run: (view) => {
                  findUsages(view, view.state.selection.main.head);
                  return true;
                },
              },
              {
                key: "Shift-F12",
                run: (view) => {
                  findUsages(view, view.state.selection.main.head);
                  return true;
                },
              },
              {
                key: "Mod-Alt-ArrowLeft",
                run: () => {
                  opts.onHistory?.(-1);
                  return true;
                },
              },
              {
                key: "Mod-Alt-ArrowRight",
                run: () => {
                  opts.onHistory?.(1);
                  return true;
                },
              },
              {
                key: "Mod-[",
                run: () => {
                  opts.onHistory?.(-1);
                  return true;
                },
              },
              {
                key: "Mod-]",
                run: () => {
                  opts.onHistory?.(1);
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
          ),
          // CodeMirror's own map keeps the text primitives (arrows, words,
          // undo, comment toggle); foldKeymap adds the editor's fold chords
          // and indentWithTab makes Tab indent instead of leaving the pane.
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...(editable ? [indentWithTab] : []),
          ]),
          EditorView.domEventHandlers({
            mousedown: (event, view) => {
              if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos == null) return false;
              if (!wordAt(view, pos)) return false;
              event.preventDefault();
              // Put the cursor on the click before asking the server, which
              // answers about the cursor, not about a mouse position.
              view.dispatch({ selection: { anchor: pos } });
              // IDEA's mouse map: Meta/Ctrl+Click is declaration or usages,
              // Meta/Ctrl+Shift+Click is the type declaration.
              if (event.shiftKey) goTo(view, pos, "typeDefinition");
              else goTo(view, pos, "definition");
              return true;
            },
          }),
          ...symbolLinks(),
          syntaxHighlighting(editorHighlightStyle),
          editorTheme,
          editorSelectionTheme,
          this.languageConf.of([]),
          this.wrapConf.of(opts.wrap ? EditorView.lineWrapping : []),
          // Both start empty and fill in when the data arrives, so the
          // effects that carry it always have a field to land in.
          changeGutter(
            (hunk, kind, line, alt, x, y) => {
              opts.onChangeClick?.(hunk, line, alt, x, y);
            },
            {
              add: opts.labels?.addedHere ?? "Added here",
              del: opts.labels?.deletedHere ?? "Deleted here",
              mod: opts.labels?.modifiedHere ?? "Modified here",
            },
          ),
          blameLine(opts.blameFormat),
          // The line the caret sits on is what "copy path with line" means;
          // report it when it moves rather than on every transaction.
          EditorView.updateListener.of((u) => {
            if (u.docChanged) this.noteDoc(u.state.doc.toString());
            if (!u.selectionSet && !u.docChanged) return;
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            const column = head - line.from + 1;
            if (line.number === lastLine && column === lastColumn) return;
            lastLine = line.number;
            lastColumn = column;
            opts.onCaret?.(line.number, column);
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

  /** The offset under a client point, for the context menu. */
  posAtClient(x: number, y: number): number | null {
    return this.view.posAtCoords({ x, y });
  }

  /** Moves the caret, as a right-click does before its menu opens. */
  placeCaret(pos: number) {
    this.view.dispatch({ selection: { anchor: pos } });
  }

  revealLine(line: number, column = 1, attempt = 0) {
    const doc = this.view.state.doc;
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines));
    // A jump remembers its column, so Back returns to the caret, not merely
    // to the line.
    const at = target.from + Math.min(Math.max(column - 1, 0), target.length);
    this.view.dispatch({ selection: { anchor: at } });
    // A pane that has not been laid out yet cannot scroll anywhere, and a
    // jump usually happens in the frame the document was created in.
    if (this.view.contentDOM.clientHeight === 0 && attempt < 10) {
      requestAnimationFrame(() => this.revealLine(line, column, attempt + 1));
      return;
    }
    this.view.dispatch({ effects: EditorView.scrollIntoView(at, { y: "center" }) });
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

function wordRangeAt(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  const isWord = (ch: string) => /[\w$]/.test(ch);
  while (start > 0 && isWord(text[start - 1] ?? "")) start--;
  while (end < text.length && isWord(text[end] ?? "")) end++;
  const word = text.slice(start, end);
  if (!word || /^\d+$/.test(word)) return null;
  return { word, from: line.from + start, to: line.from + end };
}

function wordAt(view: EditorView, pos: number): string | null {
  return wordRangeAt(view, pos)?.word ?? null;
}
