import {
  Compartment,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
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
import { editorHighlightStyle } from "./highlight";
import { editorSelectionTheme, editorTheme, loadLanguage } from "./editor";

export type MergePaneTone = "ours" | "theirs" | "conflict" | "resolved" | "ignored";

export interface MergePaneBlock {
  id: number;
  from: number;
  to: number;
  tone: MergePaneTone;
  /** A side pane offers this arrow; the result pane keeps its status dot. */
  apply?: "ours" | "theirs";
  /** A change the reader can dismiss back to the base text. */
  ignore?: boolean;
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
  /** Tooltips for the gutter actions. */
  actionLabels?: { apply: string; ignore: string };
  /** Which edge carries the gutter: the inner one faces the result. */
  side?: "before" | "after";
  onChange?: (doc: string, blocks: MergePaneBlock[]) => void;
  onScroll?: (topLine: number) => void;
  onSelection?: (start: number, end: number, empty: boolean) => void;
  onSaveRequest?: () => void;
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
        deco: Decoration.line({ class: `cm-merge-line ${block.tone}` }),
      });
    }
    for (const mark of block.marks ?? []) {
      const markFrom = Math.max(from, Math.min(mark.from, to));
      const markTo = Math.max(markFrom, Math.min(mark.to, to));
      if (markTo <= markFrom) continue;
      ranges.push({
        from: markFrom,
        to: markTo,
        deco: Decoration.mark({ class: `cm-merge-word ${block.apply ?? block.tone}` }),
      });
    }
  }
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, range.deco);
  return builder.finish();
}

class ApplyMarker extends GutterMarker {
  constructor(
    readonly id: number,
    readonly apply: "ours" | "theirs" | undefined,
    readonly ignore: boolean,
    readonly tone: MergePaneTone,
    readonly title: string,
    readonly applyLabel: string,
    readonly ignoreLabel: string,
  ) {
    super();
  }

  eq(other: GutterMarkerType) {
    return (
      other instanceof ApplyMarker &&
      other.id === this.id &&
      other.apply === this.apply &&
      other.ignore === this.ignore &&
      other.tone === this.tone &&
      other.title === this.title &&
      other.applyLabel === this.applyLabel &&
      other.ignoreLabel === this.ignoreLabel
    );
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-merge-actions ${this.tone}`;
    el.title = this.title;
    const button = (action: "apply" | "ignore", text: string, title: string, extra: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = `cm-merge-action ${extra}`;
      b.dataset.mergeAction = action;
      b.title = title;
      b.textContent = text;
      el.append(b);
    };
    if (this.ignore) button("ignore", "✕", this.ignoreLabel, "ignore");
    if (this.apply) {
      button("apply", this.apply === "ours" ? "»" : "«", this.applyLabel, `apply ${this.apply}`);
    }
    if (!this.apply && !this.ignore) {
      el.textContent = this.tone === "conflict" ? "!" : "✓";
      el.className = `cm-merge-gutter-mark ${this.tone}`;
    }
    return el;
  }
}

function buildGutter(
  view: EditorView,
  blocks: MergePaneBlock[],
  labels: { apply: string; ignore: string; status: string },
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
      new ApplyMarker(block.id, block.apply, block.ignore === true, block.tone, title, labels.apply, labels.ignore),
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
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          this.language.of([]),
          codeFolding(),
          this.wrap.of(opts.wrap ? EditorView.lineWrapping : []),
          this.whitespace.of(opts.whitespace ? highlightWhitespace() : []),
          blocksField,
          gutter({
            class: this.opts.side === "after" ? "cm-merge-gutter side-after" : "cm-merge-gutter",
            side: this.opts.side === "after" ? "after" : "before",
            markers: (view) =>
              buildGutter(view, view.state.field(blocksField), {
                apply: this.opts.actionLabels?.apply ?? "Apply",
                ignore: this.opts.actionLabels?.ignore ?? "Ignore",
                status: "Conflict block",
              }),
            domEventHandlers: {
              mousedown: (view, line: BlockInfo, event) => {
                const target = (event.target as HTMLElement).closest("[data-merge-action]") as HTMLElement | null;
                if (!target) return false;
                const block = blockAtLine(view, view.state.doc.lineAt(line.from).number);
                if (!block) return false;
                const action = target.dataset.mergeAction;
                if (action === "ignore" && this.opts.onIgnoreBlock) {
                  event.preventDefault();
                  this.opts.onIgnoreBlock(block.id);
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
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                this.opts.onSaveRequest?.();
                return true;
              },
            },
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

  /** Replaces the whole document, used by "resolve using left/right". */
  replaceAll(text: string) {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: { anchor: 0 },
    });
  }

  replaceBlock(id: number, text: string): boolean {
    const block = this.getBlocks().find((b) => b.id === id);
    if (!block) return false;
    const replacement = this.withTrailingNewline(block, text);
    this.view.dispatch({
      changes: { from: block.from, to: block.to, insert: replacement },
      selection: { anchor: block.from + replacement.length },
    });
    return true;
  }

  /** A block range includes the newline that ended its last line. A non-empty
   *  replacement has to end with one too, or it joins the following line. */
  private withTrailingNewline(block: MergePaneBlock, text: string): string {
    if (text === "" || text.endsWith("\n")) return text;
    const original = this.view.state.doc.sliceString(block.from, block.to);
    return original.endsWith("\n") ? text + "\n" : text;
  }

  /** Applies several blocks at once. Overlapping blocks are skipped. */
  replaceBlocks(changes: { id: number; text: string }[]): number {
    const blocks = this.getBlocks();
    const byId = new Map(blocks.map((b) => [b.id, b]));
    const edits: { from: number; to: number; insert: string }[] = [];
    // Edits are applied from the end so earlier positions stay valid. Walk the
    // blocks in descending order and reject one that overlaps the block after
    // it; `lastTo` would reject every earlier block.
    let lastFrom = Number.MAX_SAFE_INTEGER;
    for (const change of [...changes].sort((a, b) => (byId.get(b.id)?.from ?? 0) - (byId.get(a.id)?.from ?? 0))) {
      const block = byId.get(change.id);
      if (!block || block.to > lastFrom) continue;
      edits.push({ from: block.from, to: block.to, insert: this.withTrailingNewline(block, change.text) });
      lastFrom = block.from;
    }
    if (edits.length === 0) return 0;
    this.view.dispatch({ changes: edits });
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

  requestMeasure() {
    this.view.requestMeasure();
  }

  caretLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
    this.view.destroy();
  }
}
