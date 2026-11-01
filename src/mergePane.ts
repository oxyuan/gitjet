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
  keymap,
  lineNumbers,
  type BlockInfo,
  type DecorationSet,
  type GutterMarker as GutterMarkerType,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { editorHighlightStyle } from "./highlight";
import { editorSelectionTheme, editorTheme, loadLanguage } from "./editor";

export type MergePaneTone = "ours" | "theirs" | "conflict" | "resolved";

export interface MergePaneBlock {
  id: number;
  from: number;
  to: number;
  tone: MergePaneTone;
  /** A side pane offers this arrow; the result pane keeps its status dot. */
  apply?: "ours" | "theirs";
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
  onChange?: (doc: string, blocks: MergePaneBlock[]) => void;
  onScroll?: (topLine: number) => void;
  onSelection?: (start: number, end: number, empty: boolean) => void;
  onSaveRequest?: () => void;
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
    readonly tone: MergePaneTone,
    readonly title: string,
  ) {
    super();
  }

  eq(other: GutterMarkerType) {
    return (
      other instanceof ApplyMarker &&
      other.id === this.id &&
      other.apply === this.apply &&
      other.tone === this.tone &&
      other.title === this.title
    );
  }

  toDOM() {
    const el = document.createElement("span");
    el.className = `cm-merge-gutter-mark ${this.tone}${this.apply ? " apply" : ""}`;
    el.title = this.title;
    el.textContent = this.apply === "ours" ? "»" : this.apply === "theirs" ? "«" : this.tone === "conflict" ? "!" : "✓";
    return el;
  }
}

function buildGutter(view: EditorView, blocks: MergePaneBlock[], labels: { apply: string; status: string }): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const sorted = [...blocks].sort((a, b) => a.from - b.from);
  for (const block of sorted) {
    const range = lineRange(view, block);
    const line = view.state.doc.line(range.first);
    const title =
      block.title ??
      (block.apply === "ours"
        ? labels.apply.replace("{side}", "ours")
        : block.apply === "theirs"
          ? labels.apply.replace("{side}", "theirs")
          : labels.status);
    builder.add(line.from, line.from, new ApplyMarker(block.id, block.apply, block.tone, title));
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
          blocksField,
          gutter({
            class: "cm-merge-gutter",
            markers: (view) =>
              buildGutter(view, view.state.field(blocksField), {
                apply: "Apply {side} change",
                status: "Conflict block",
              }),
            domEventHandlers: {
              mousedown: (view, line: BlockInfo, event) => {
                if (!this.opts.onApplyBlock) return false;
                const block = blockAtLine(view, view.state.doc.lineAt(line.from).number);
                if (!block || !block.apply) return false;
                event.preventDefault();
                this.opts.onApplyBlock(block.id);
                return true;
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

  setBlocks(blocks: MergePaneBlock[]) {
    this.view.dispatch({ effects: setBlocks.of(blocks) });
  }

  getBlocks(): MergePaneBlock[] {
    return this.view.state.field(blocksField);
  }

  getDoc(): string {
    return this.view.state.doc.toString();
  }

  async setLanguage(language: string) {
    const support = await loadLanguage(language);
    this.view.dispatch({ effects: this.language.reconfigure(support ?? []) });
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
    let lastTo = -1;
    for (const change of [...changes].sort((a, b) => (byId.get(b.id)?.from ?? 0) - (byId.get(a.id)?.from ?? 0))) {
      const block = byId.get(change.id);
      if (!block || block.from < lastTo) continue;
      edits.push({ from: block.from, to: block.to, insert: this.withTrailingNewline(block, change.text) });
      lastTo = block.to;
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

  caretLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
  }

  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.scrollHandler);
    this.view.destroy();
  }
}
