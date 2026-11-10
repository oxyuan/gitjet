import {
  Compartment,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  gutterLineClass,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
  keymap,
  lineNumbers,
  type BlockInfo,
  type DecorationSet,
  type GutterMarker as GutterMarkerType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, redo, undo } from "@codemirror/commands";
import { codeFolding, foldEffect, syntaxHighlighting, unfoldAll } from "@codemirror/language";
import { blockText, type MergeTone } from "./merge";
import { editorHighlightStyle } from "./highlight";
import { editorSelectionTheme, editorTheme, loadLanguage } from "./editor";
import { ARROW_LEFT, ARROW_RIGHT } from "./icons";

export interface MergePaneBlock {
  id: number;
  from: number;
  to: number;
  tone: MergeTone;
  /** A conflict band is a wash under the word marks, as in the IDE; a
   *  one-sided change takes the undiluted type colour. */
  soft?: boolean;
  /** A side pane offers this arrow; the result pane keeps its status dot. */
  apply?: "ours" | "theirs";
  /** A change the reader can dismiss back to the base text. */
  ignore?: boolean;
  /** A decided block the reader can take back to its pre-decision text. */
  revert?: boolean;
  /** Word-level differences inside a conflicting line. */
  marks?: { from: number; to: number }[];
  title?: string;
}

export interface MergePaneOptions {
  doc: string;
  editable: boolean;
  language: string;
  blocks?: MergePaneBlock[];
  onApplyBlock?: (id: number) => void;
  onIgnoreBlock?: (id: number) => void;
  onRevertBlock?: (id: number) => void;
  /** Tooltips for the gutter actions. */
  actionLabels?: { apply: string; ignore: string; revert?: string };
  /** Which edge carries the gutter: the inner one faces the result. */
  side?: "before" | "after";
  /** Line numbers on the inner edge(s) instead of the outer one, the way the
   *  IDE lines every pane up against the result's numbering. */
  numbers?: "before" | "after" | "both";
  onChange?: (doc: string, blocks: MergePaneBlock[]) => void;
  onScroll?: (topLine: number) => void;
  onSelection?: (start: number, end: number, empty: boolean) => void;
  onSaveRequest?: () => void;
  /** Undo/redo go to the owner first: decisions are its history, typing is the
   *  editor's, and only the owner can put them in the right order. */
  onUndoRequest?: () => void;
  onRedoRequest?: () => void;
  wrap?: boolean;
  whitespace?: boolean;
}

const setBlocks = StateEffect.define<MergePaneBlock[]>();
function lineRange(view: EditorView, block: MergePaneBlock): { first: number; last: number } {
  const doc = view.state.doc;
  const from = Math.max(0, Math.min(block.from, doc.length));
  const to = Math.max(from, Math.min(block.to, doc.length));
  if (to <= from) {
    const line = doc.lineAt(from).number;
    return { first: line, last: line };
  }
  return { first: doc.lineAt(from).number, last: doc.lineAt(to - 1).number };
}

function buildDecorations(blocks: MergePaneBlock[], state: EditorState): DecorationSet {
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  for (const block of blocks) {
    const from = Math.max(0, Math.min(block.from, state.doc.length));
    const to = Math.max(from, Math.min(block.to, state.doc.length));
    if (to <= from) continue;
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to - 1);
    for (let n = first.number; n <= last.number; n++) {
      const lineFrom = state.doc.line(n).from;
      ranges.push({
        from: lineFrom,
        to: lineFrom,
        deco: Decoration.line({
          class: `cm-merge-line ${block.tone}${block.soft ? " soft" : ""}`,
        }),
      });
    }
    for (const mark of block.marks ?? []) {
      const markFrom = Math.max(from, Math.min(mark.from, to));
      const markTo = Math.max(markFrom, Math.min(mark.to, to));
      if (markTo <= markFrom) continue;
      ranges.push({
        from: markFrom,
        to: markTo,
        deco: Decoration.mark({ class: `cm-merge-word ${block.tone}` }),
      });
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.deco);
  return builder.finish();
}

/** A block row's tint, carried into the gutters so a change reads as one band
 *  across the pane instead of a stripe of text with dark margins. */
class BlockLineMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(tone: MergeTone, soft: boolean) {
    super();
    this.elementClass = `cm-merge-gutterline ${tone}${soft ? " soft" : ""}`;
  }

  eq(other: GutterMarkerType) {
    return other instanceof BlockLineMarker && other.elementClass === this.elementClass;
  }
}

/** One line number, for a gutter the built-in lineNumbers cannot put on the
 *  inner edge of a pane. */
class NumberMarker extends GutterMarker {
  constructor(readonly label: string) {
    super();
  }

  eq(other: GutterMarkerType) {
    return other instanceof NumberMarker && other.label === this.label;
  }

  toDOM() {
    const el = document.createElement("span");
    el.textContent = this.label;
    return el;
  }
}

/** Line numbers on the given edge, so the result can carry them on both sides
 *  and a version pane can put them against the result's column. */
function lineNumbersOn(side: "before" | "after") {
  return gutter({
    class: `cm-merge-numbers${side === "after" ? " side-after" : ""}`,
    side,
    renderEmptyElements: false,
    lineMarker: (view, line) =>
      new NumberMarker(String(view.state.doc.lineAt(line.from).number)),
    lineMarkerChange: () => false,
  });
}

class ApplyMarker extends GutterMarker {
  constructor(
    readonly id: number,
    readonly apply: "ours" | "theirs" | undefined,
    readonly ignore: boolean,
    readonly revert: boolean,
    readonly tone: MergeTone,
    readonly soft: boolean,
    readonly title: string,
    readonly applyLabel: string,
    readonly ignoreLabel: string,
    readonly revertLabel: string,
  ) {
    super();
  }

  eq(other: GutterMarkerType) {
    return (
      other instanceof ApplyMarker &&
      other.id === this.id &&
      other.apply === this.apply &&
      other.ignore === this.ignore &&
      other.revert === this.revert &&
      other.tone === this.tone &&
      other.soft === this.soft &&
      other.title === this.title &&
      other.applyLabel === this.applyLabel &&
      other.ignoreLabel === this.ignoreLabel &&
      other.revertLabel === this.revertLabel
    );
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-merge-actions ${this.tone}${this.soft ? " soft" : ""}`;
    el.title = this.title;
    const button = (
      action: "apply" | "ignore" | "revert",
      content: string | SVGElement,
      title: string,
      extra: string,
    ) => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = `cm-merge-action ${extra}`;
      b.dataset.mergeAction = action;
      b.dataset.mergeBlock = String(this.id);
      b.title = title;
      b.append(content);
      el.append(b);
    };
    // The status glyph is the block's state; the buttons beside it are what
    // the reader can do to it, the way IDEA's gutter toolbar works.
    if (!this.apply && !this.ignore) {
      const mark = document.createElement("span");
      mark.className = `cm-merge-gutter-mark ${this.tone}`;
      mark.textContent = this.tone === "conflict" ? "!" : "✓";
      el.append(mark);
    }
    if (this.revert) button("revert", "↺", this.revertLabel, "revert");
    if (this.ignore) button("ignore", "✕", this.ignoreLabel, "ignore");
    if (this.apply) {
      button("apply", arrow(this.apply === "ours" ? ARROW_RIGHT : ARROW_LEFT), this.applyLabel, `apply ${this.apply}`);
    }
    return el;
  }
}

/** A guillemet at 11px is punctuation, not a control: draw the arrow itself. */
function arrow(d: string): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function buildGutter(
  view: EditorView,
  blocks: MergePaneBlock[],
  labels: { apply: string; ignore: string; revert: string; status: string },
): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const sorted = [...blocks].sort((a, b) => a.from - b.from);
  for (const block of sorted) {
    const range = lineRange(view, block);
    const line = view.state.doc.line(range.first);
    const title = block.title ?? labels.status;
    builder.add(
      line.from,
      line.from,
      new ApplyMarker(
        block.id,
        block.apply,
        block.ignore === true,
        block.revert === true,
        block.tone,
        block.soft === true,
        title,
        labels.apply,
        labels.ignore,
        labels.revert,
      ),
    );
  }
  return builder.finish();
}

const blocksField = StateField.define<MergePaneBlock[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = next.map((block) => ({
        ...block,
        from: tr.changes.mapPos(block.from, -1),
        to: tr.changes.mapPos(block.to, 1),
      }));
    }
    for (const effect of tr.effects) if (effect.is(setBlocks)) next = effect.value;
    return next;
  },
  provide: (field) =>
    EditorView.decorations.compute([field, "doc"], (state) =>
      buildDecorations(state.field(field), state),
    ),
});

/** Which rows of every gutter belong to a change block. */
const blockGutterLines = gutterLineClass.compute([blocksField], (state) => {
  const builder = new RangeSetBuilder<GutterMarker>();
  const doc = state.doc;
  for (const block of state.field(blocksField)) {
    const from = Math.max(0, Math.min(block.from, doc.length));
    const to = Math.max(from, Math.min(block.to, doc.length));
    if (to <= from) continue;
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to - 1).number;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      builder.add(line.from, line.from, new BlockLineMarker(block.tone, block.soft === true));
    }
  }
  return builder.finish();
});

function blockAtLine(view: EditorView, line: number): MergePaneBlock | null {
  const blocks = view.state.field(blocksField);
  const info = view.state.doc.line(line);
  for (const block of blocks) {
    if (block.from === block.to) {
      if (info.from === block.from) return block;
    } else if (info.from >= block.from && info.from < block.to) {
      return block;
    }
  }
  return null;
}

export class MergePane {
  readonly view: EditorView;
  private language = new Compartment();
  private wrap = new Compartment();
  private whitespace = new Compartment();
  private opts: MergePaneOptions;
  private scrollHandler: () => void;

  constructor(parent: HTMLElement, opts: MergePaneOptions) {
    this.opts = opts;
    const editable = opts.editable;
    this.scrollHandler = () => opts.onScroll?.(this.topLine());
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: opts.doc,
        extensions: [
          EditorState.readOnly.of(!editable),
          ...(opts.numbers === "after" ? [] : [lineNumbers()]),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          this.language.of([]),
          codeFolding(),
          this.wrap.of(opts.wrap ? EditorView.lineWrapping : []),
          this.whitespace.of(opts.whitespace ? highlightWhitespace() : []),
          blocksField,
          blockGutterLines,
          gutter({
            class: this.opts.side === "after" ? "cm-merge-gutter side-after" : "cm-merge-gutter",
            side: this.opts.side === "after" ? "after" : "before",
            markers: (view) =>
              buildGutter(view, view.state.field(blocksField), {
                apply: this.opts.actionLabels?.apply ?? "Apply",
                ignore: this.opts.actionLabels?.ignore ?? "Ignore",
                revert: this.opts.actionLabels?.revert ?? "Revert",
                status: "Conflict block",
              }),
            domEventHandlers: {
              mousedown: (view, line: BlockInfo, event) => {
                const target = (event.target as HTMLElement).closest("[data-merge-action]") as HTMLElement | null;
                if (!target) return false;
                // The marker carries its block id: two blocks can start on the
                // same line, and the line alone must not pick between them.
                const id = Number(target.dataset.mergeBlock);
                const block = Number.isFinite(id)
                  ? view.state.field(blocksField).find((candidate) => candidate.id === id) ?? null
                  : blockAtLine(view, view.state.doc.lineAt(line.from).number);
                if (!block) return false;
                const action = target.dataset.mergeAction;
                if (action === "ignore" && this.opts.onIgnoreBlock) {
                  event.preventDefault();
                  this.opts.onIgnoreBlock(block.id);
                  return true;
                }
                if (action === "revert" && this.opts.onRevertBlock) {
                  event.preventDefault();
                  this.opts.onRevertBlock(block.id);
                  return true;
                }
                if (action === "apply" && block.apply && this.opts.onApplyBlock) {
                  event.preventDefault();
                  this.opts.onApplyBlock(block.id);
                  return true;
                }
                return false;
              },
            },
          }),
          ...(opts.numbers === "after" || opts.numbers === "both" ? [lineNumbersOn("after")] : []),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                this.opts.onSaveRequest?.();
                return true;
              },
            },
            ...(editable && this.opts.onUndoRequest
              ? [
                  {
                    key: "Mod-z",
                    run: () => {
                      this.opts.onUndoRequest?.();
                      return true;
                    },
                  },
                  {
                    key: "Mod-Shift-z",
                    run: () => {
                      this.opts.onRedoRequest?.();
                      return true;
                    },
                  },
                  {
                    key: "Mod-y",
                    run: () => {
                      this.opts.onRedoRequest?.();
                      return true;
                    },
                  },
                ]
              : []),
            ...defaultKeymap,
            ...(editable ? historyKeymap : []),
          ]),
          ...(editable ? [history()] : []),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet && this.opts.onSelection) {
              const doc = update.state.doc;
              const sel = update.state.selection.main;
              this.opts.onSelection(
                doc.lineAt(sel.from).number,
                doc.lineAt(sel.to).number,
                sel.from === sel.to,
              );
            }
            if (!update.docChanged) return;
            this.opts.onChange?.(
              update.state.doc.toString(),
              update.state.field(blocksField),
            );
          }),
          syntaxHighlighting(editorHighlightStyle),
          editorTheme,
          editorSelectionTheme,
        ],
      }),
    });
    this.view.scrollDOM.addEventListener("scroll", this.scrollHandler, { passive: true });
    void this.setLanguage(opts.language);
    if (opts.blocks) this.setBlocks(opts.blocks);
  }

  undo(): boolean {
    return undo(this.view);
  }

  redo(): boolean {
    return redo(this.view);
  }

  setBlocks(blocks: MergePaneBlock[]) {
    this.view.dispatch({ effects: setBlocks.of(blocks) });
  }

  getBlocks(): MergePaneBlock[] {
    return this.view.state.field(blocksField);
  }

  getDoc(): string {
    return this.view.state.doc.toString();
  }

  setViewOptions(options: { wrap?: boolean; whitespace?: boolean }) {
    const effects = [];
    if (options.wrap !== undefined) {
      effects.push(this.wrap.reconfigure(options.wrap ? EditorView.lineWrapping : []));
    }
    if (options.whitespace !== undefined) {
      effects.push(this.whitespace.reconfigure(options.whitespace ? highlightWhitespace() : []));
    }
    if (effects.length > 0) this.view.dispatch({ effects });
  }

  /** Folds every stretch between change blocks, or unfolds everything. */
  setCollapsed(collapsed: boolean) {
    if (!collapsed) {
      unfoldAll(this.view);
      return;
    }
    const doc = this.view.state.doc;
    const blocks = [...this.getBlocks()].sort((a, b) => a.from - b.from);
    const folds: { from: number; to: number }[] = [];
    const addGap = (from: number, to: number) => {
      const start = Math.max(0, Math.min(from, doc.length));
      const end = Math.max(start, Math.min(to, doc.length));
      if (end <= start) return;
      const first = doc.lineAt(start).number;
      // The gap ends where the next block starts, so that line stays visible.
      const last = doc.lineAt(end > start ? end - 1 : end).number;
      if (last > first) folds.push({ from: doc.line(first).from, to: doc.line(last).to });
    };
    let cursor = 0;
    for (const block of blocks) {
      addGap(cursor, block.from);
      cursor = Math.max(cursor, block.to);
    }
    addGap(cursor, doc.length);
    if (folds.length > 0) {
      this.view.dispatch({ effects: folds.map((range) => foldEffect.of(range)) });
    }
  }

  async setLanguage(language: string) {
    const support = await loadLanguage(language);
    this.view.dispatch({ effects: this.language.reconfigure(support ?? []) });
  }

  /** Replaces the whole document, used by "resolve using left/right". The
   *  caller owns that history, so it can leave the editor's own undo stack
   *  alone. */
  replaceAll(text: string, options: { history?: boolean } = {}) {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
      annotations: options.history === false ? [Transaction.addToHistory.of(false)] : undefined,
    });
  }

  /** Applies several blocks at once. Overlapping blocks are skipped. */
  replaceBlocks(
    changes: { id: number; lines: string[] }[],
    options: { history?: boolean } = {},
  ): number {
    const blocks = this.getBlocks();
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const doc = this.view.state.doc.toString();
    const edits: { from: number; to: number; insert: string }[] = [];
    // Edits are applied from the end so earlier positions stay valid. Walk the
    // blocks in descending order and reject one that overlaps the block after
    // it; `lastTo` would reject every earlier block.
    let lastFrom = Number.MAX_SAFE_INTEGER;
    for (const change of [...changes].sort((a, b) => (byId.get(b.id)?.from ?? 0) - (byId.get(a.id)?.from ?? 0))) {
      const block = byId.get(change.id);
      if (!block || block.to > lastFrom) continue;
      edits.push({ from: block.from, to: block.to, insert: blockText(doc, block, change.lines) });
      lastFrom = block.from;
    }
    if (edits.length === 0) return 0;
    this.view.dispatch({
      changes: edits,
      annotations: options.history === false ? [Transaction.addToHistory.of(false)] : undefined,
    });
    return edits.length;
  }

  topLine(): number {
    const height = this.view.scrollDOM.scrollTop;
    const block = this.view.lineBlockAtHeight(Math.max(0, height));
    return this.view.state.doc.lineAt(block.from).number;
  }

  scrollToLine(line: number) {
    const doc = this.view.state.doc;
    const target = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const top = this.view.lineBlockAt(target.from).top;
    this.view.scrollDOM.scrollTop = Math.max(0, top - 4);
  }

  /** Viewport-relative pixel span of a character range, for the connectors
   *  drawn between panes. */
  spanFor(from: number, to: number): { top: number; bottom: number } {
    const doc = this.view.state.doc;
    const start = doc.lineAt(Math.max(0, Math.min(from, doc.length)));
    const end = doc.lineAt(Math.max(0, Math.min(to > from ? to - 1 : to, doc.length)));
    return this.span(start.from, end.from);
  }

  /** Viewport-relative pixel span of lines [first, last], both 1-based. */
  lineSpan(first: number, last: number): { top: number; bottom: number } {
    const doc = this.view.state.doc;
    const start = doc.line(Math.max(1, Math.min(first, doc.lines)));
    const end = doc.line(Math.max(start.number, Math.min(last, doc.lines)));
    return this.span(start.from, end.from);
  }

  private span(from: number, to: number): { top: number; bottom: number } {
    const scroll = this.view.scrollDOM.scrollTop;
    const top = this.view.lineBlockAt(from);
    const bottom = this.view.lineBlockAt(to);
    return { top: top.top - scroll, bottom: bottom.top + bottom.height - scroll };
  }

  requestMeasure() {
    this.view.requestMeasure();
  }

  caretLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
  }

  /** The line under a viewport point, for a context menu that must act on what
   *  the pointer is over rather than on a selection the click did not move. */
  lineAtCoords(x: number, y: number): number | null {
    const pos = this.view.posAtCoords({ x, y });
    return pos == null ? null : this.view.state.doc.lineAt(pos).number;
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
    this.view.destroy();
  }
}
