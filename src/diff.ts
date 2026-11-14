import type { DiffHunk, DiffLine, FileDiff } from "./mygo";
import { DiffTooBigError, elementIds, ideaBlocks, type IdeaBlock } from "./ideaDiff";
import { compareAndSplit, type WordFragment } from "./worddiff";

export interface WordSegment {
  text: string;
  changed: boolean;
  /** What the mark names, as IDEA classifies its inner fragments: a fragment
   *  present on both sides is a modified run, one present on a single side is
   *  a deletion or an insertion. */
  kind?: "inserted" | "deleted" | "modified";
}

/** IDEA's "Highlighting Differences" policy. `words` and `chars` mark the
 *  changed runs inside a paired line, `lines` leaves the change to the line
 *  bands, and `none` turns the highlighting off. */
export type HighlightMode = "lines" | "words" | "chars" | "none";

export interface AlignedSide {
  no: number;
  text: string;
  kind: "context" | "del" | "add";
  segments?: WordSegment[];
}

export interface AlignedRow {
  left?: AlignedSide;
  right?: AlignedSide;
  kind: "context" | "change" | "del" | "add";
  /** Identifies the hunk this row belongs to, for navigation. */
  hunk: number;
}

/** One run of unchanged rows a folded view hides. */
export interface FoldRange {
  /** First hidden row, inclusive. */
  start: number;
  /** Last hidden row, exclusive. */
  end: number;
  /** Number of hidden rows, which is what the separator counts. */
  count: number;
}

/** The whitespace modes of a diff, named as IDEA names them. */
export type WhitespaceMode = "none" | "trim" | "whitespace" | "whitespace-blank";

/** What a folded viewer draws, in order: either a real row or the marker
 *  standing in for a run of hidden ones. */
export type VisibleRow =
  | { kind: "row"; row: AlignedRow; index: number }
  | { kind: "fold"; fold: FoldRange };

/**
 * The first row of every run of consecutive changed rows. A run is one block
 * even when it spans many added and deleted lines, so navigation and the
 * "n / m" counter talk about changes, not lines.
 */
export function changeBlockRows(rows: readonly AlignedRow[]): number[] {
  const out: number[] = [];
  let inBlock = false;
  rows.forEach((row, i) => {
    if (row.kind === "context") {
      inBlock = false;
      return;
    }
    if (!inBlock) out.push(i);
    inBlock = true;
  });
  return out;
}

/**
 * The change block every row belongs to, indexed like `changeBlockRows`:
 * a click anywhere inside a change must make that block current, not only a
 * click on its first row. Context rows are -1, the way they are no block.
 */
export function changeBlockIndex(rows: readonly AlignedRow[]): number[] {
  const out: number[] = [];
  let block = -1;
  let next = 0;
  for (const row of rows) {
    if (row.kind === "context") {
      block = -1;
      out.push(-1);
      continue;
    }
    if (block < 0) block = next++;
    out.push(block);
  }
  return out;
}

/**
 * The signed lines of every change block, keyed by the block's first row.
 * A whole-file diff has one hunk, so these are what a hunk-level control
 * must apply: one run of changed rows, with old lines negative so a deleted
 * line and an added line that share a number stay apart.
 */
export function changeBlockSelections(rows: readonly AlignedRow[]): Map<number, number[]> {
  const blocks = new Map<number, number[]>();
  let current = -1;
  rows.forEach((row, i) => {
    if (row.kind === "context") {
      current = -1;
      return;
    }
    if (current < 0) {
      current = i;
      blocks.set(i, []);
    }
    const lines = blocks.get(current)!;
    if (row.left && row.left.kind !== "context") lines.push(-row.left.no);
    if (row.right && row.right.kind !== "context") lines.push(row.right.no);
  });
  return blocks;
}

/** Splits file text into lines, dropping the empty tail after a final newline. */
export function textLines(text: string): string[] {
  if (text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Splits a line into words, whitespace and single punctuation marks. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) ?? [];
}

/** LCS-based segments for two token arrays, shared by word and char diffs. */
function diffTokens(left: string[], right: string[]): [WordSegment[], WordSegment[]] {
  const n = left.length;
  const m = right.length;
  if (n > 1200 || m > 1200) {
    return [
      [{ text: left.join(""), changed: true }],
      [{ text: right.join(""), changed: true }],
    ];
  }
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = left[i] === right[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const leftSegs: WordSegment[] = [];
  const rightSegs: WordSegment[] = [];
  const push = (segs: WordSegment[], text: string, changed: boolean) => {
    const last = segs[segs.length - 1];
    if (last && last.changed === changed) last.text += text;
    else segs.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      push(leftSegs, left[i]!, false);
      push(rightSegs, right[j]!, false);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push(leftSegs, left[i]!, true);
      i++;
    } else {
      push(rightSegs, right[j]!, true);
      j++;
    }
  }
  while (i < n) push(leftSegs, left[i++]!, true);
  while (j < m) push(rightSegs, right[j++]!, true);
  return [leftSegs, rightSegs];
}

/**
 * wordDiff marks the words that differ between two changed lines, so the
 * viewer can highlight inside the line.
 */
export function wordDiff(a: string, b: string): [WordSegment[], WordSegment[]] {
  return diffTokens(tokenize(a), tokenize(b));
}

/**
 * charDiff highlights the individual characters that differ. IDEA compares
 * the code points with its own diff engine (`ByCharRt.compare`), so this uses
 * the same ported engine: the suffix-LCS table would keep a different — equally
 * long — equal run wherever a character repeats, and the marks would sit on
 * other characters than the IDE's.
 */
export function charDiff(a: string, b: string): [WordSegment[], WordSegment[]] {
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  let blocks: IdeaBlock[];
  try {
    const ids = new Map<number, number>();
    blocks = ideaBlocks(
      elementIds(charsA.map((ch) => ch.codePointAt(0) ?? 0), ids),
      elementIds(charsB.map((ch) => ch.codePointAt(0) ?? 0), ids),
    );
  } catch (error) {
    // The IDE throws `DiffTooBigException` and the line keeps no inner
    // fragments; the whole line stays marked as one change.
    if (!(error instanceof DiffTooBigError)) throw error;
    return [
      [{ text: a, changed: true }],
      [{ text: b, changed: true }],
    ];
  }
  const runs = (side: "a" | "b"): number[][] => {
    const out: number[][] = [];
    for (const block of blocks) {
      const start = side === "a" ? block.aStart : block.bStart;
      const end = side === "a" ? block.aEnd : block.bEnd;
      if (end > start) out.push([start, end]);
    }
    return out;
  };
  const segments = (chars: string[], changed: number[][]): WordSegment[] => {
    const out: WordSegment[] = [];
    let index = 0;
    for (const [start, end] of changed) {
      if (start! > index) out.push({ text: chars.slice(index, start).join(""), changed: false });
      out.push({ text: chars.slice(start!, end!).join(""), changed: true });
      index = end!;
    }
    if (index < chars.length) out.push({ text: chars.slice(index).join(""), changed: false });
    return out;
  };
  return [segments(charsA, runs("a")), segments(charsB, runs("b"))];
}

/**
 * buildDiffRows aligns the old and new files into rows and pairs deleted and
 * added lines so word differences can be highlighted. Every unchanged line
 * is a row too; folding is a view decision, so the model never drops lines.
 */
export function buildDiffRows(diff: FileDiff, highlight: HighlightMode = "words"): AlignedRow[] {
  const hasText = diff.oldText !== "" || diff.newText !== "";
  const oldLines = textLines(diff.oldText);
  const newLines = textLines(diff.newText);
  const rows: AlignedRow[] = [];
  if (!hasText || diff.hunks.length === 0) {
    if (diff.hunks.length === 0) return rows;
    return rowsFromHunks(diff.hunks, highlight);
  }
  let oi = 0;
  let ni = 0;
  for (let h = 0; h < diff.hunks.length; h++) {
    const hunk = diff.hunks[h]!;
    const oldStart = hunk.oldLines === 0 ? oi : Math.max(0, hunk.oldStart - 1);
    const newStart = hunk.newLines === 0 ? ni : Math.max(0, hunk.newStart - 1);
    while ((oi < oldStart || ni < newStart) && oi < oldLines.length && ni < newLines.length) {
      rows.push({
        kind: "context",
        hunk: h,
        left: { no: oi + 1, text: oldLines[oi] ?? "", kind: "context" },
        right: { no: ni + 1, text: newLines[ni] ?? "", kind: "context" },
      });
      oi++;
      ni++;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    const flush = () => {
      rows.push(...alignChangedLines(dels, adds, h, highlight));
      dels.length = 0;
      adds.length = 0;
    };
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        flush();
        rows.push({
          kind: "context",
          hunk: h,
          left: { no: line.oldNo, text: line.text, kind: "context" },
          right: { no: line.newNo, text: line.text, kind: "context" },
        });
        oi++;
        ni++;
      } else if (line.kind === "del") {
        dels.push(line);
        oi++;
      } else {
        adds.push(line);
        ni++;
      }
    }
    flush();
  }
  while (oi < oldLines.length && ni < newLines.length) {
    rows.push({
      kind: "context",
      hunk: diff.hunks.length - 1,
      left: { no: oi + 1, text: oldLines[oi] ?? "", kind: "context" },
      right: { no: ni + 1, text: newLines[ni] ?? "", kind: "context" },
    });
    oi++;
    ni++;
  }
  while (oi < oldLines.length) {
    rows.push({
      kind: "del",
      hunk: diff.hunks.length - 1,
      left: { no: oi + 1, text: oldLines[oi] ?? "", kind: "del" },
    });
    oi++;
  }
  while (ni < newLines.length) {
    rows.push({
      kind: "add",
      hunk: diff.hunks.length - 1,
      right: { no: ni + 1, text: newLines[ni] ?? "", kind: "add" },
    });
    ni++;
  }
  return rows;
}

function rowsFromHunks(hunks: DiffHunk[], highlight: HighlightMode): AlignedRow[] {
  const rows: AlignedRow[] = [];
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h]!;
    let dels: DiffLine[] = [];
    let adds: DiffLine[] = [];
    const flush = () => {
      rows.push(...alignChangedLines(dels, adds, h, highlight));
      dels = [];
      adds = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === "context") {
        flush();
        rows.push({
          kind: "context",
          hunk: h,
          left: { no: line.oldNo, text: line.text, kind: "context" },
          right: { no: line.newNo, text: line.text, kind: "context" },
        });
      } else if (line.kind === "del") dels.push(line);
      else adds.push(line);
    }
    flush();
  }
  return rows;
}

interface BlockLine {
  start: number;
  end: number;
}

/** Line offsets of a block of joined diff lines; the newline is not part of
 *  the line. */
function splitLineOffsets(text: string): BlockLine[] {
  const out: BlockLine[] = [];
  if (text === "") return out;
  let pos = 0;
  for (;;) {
    const newline = text.indexOf("\n", pos);
    if (newline === -1) {
      out.push({ start: pos, end: text.length });
      return out;
    }
    out.push({ start: pos, end: newline });
    pos = newline + 1;
    if (pos === text.length) return out;
  }
}

/** The line indices a word-diff block covers. Block offsets sit on line
 *  boundaries, so a line is in the block when its start lies before the
 *  block's end and its text reaches the block's start. */
function linesInBlock(lines: readonly BlockLine[], start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.start >= end) break;
    if (line.end > start || (line.start === line.end && line.start >= start)) out.push(i);
  }
  return out;
}

/** Cuts the changed character ranges of one side into the segments of one
 *  line, so a fragment that spans several lines paints each line separately.
 *  A range present on both sides of the word diff is a modification; one
 *  that exists on a single side is a deletion or an insertion, which is what
 *  gives the marks IDEA's three colours. */
function segmentsForLine(
  text: string,
  line: BlockLine,
  fragments: readonly WordFragment[],
  side: "left" | "right",
): WordSegment[] | undefined {
  const length = line.end - line.start;
  const ranges: { from: number; to: number; kind: NonNullable<WordSegment["kind"]> }[] = [];
  for (const fragment of fragments) {
    const both = fragment.end1 > fragment.start1 && fragment.end2 > fragment.start2;
    const from = Math.max(side === "left" ? fragment.start1 : fragment.start2, line.start) - line.start;
    const to = Math.min(side === "left" ? fragment.end1 : fragment.end2, line.end) - line.start;
    if (to > from) {
      ranges.push({ from, to, kind: both ? "modified" : side === "left" ? "deleted" : "inserted" });
    }
  }
  if (ranges.length === 0) return undefined;
  ranges.sort((a, b) => a.from - b.from);
  const cuts = new Set<number>([0, length]);
  for (const range of ranges) {
    cuts.add(range.from);
    cuts.add(range.to);
  }
  const ordered = [...cuts].sort((a, b) => a - b);
  const segments: WordSegment[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    if (to <= from) continue;
    const covering = ranges.filter((range) => range.from <= from && to <= range.to);
    const changed = covering.length > 0;
    const kind = changed
      ? (covering.find((range) => range.kind === "modified")?.kind ??
        covering[0]!.kind)
      : undefined;
    const segment = text.slice(line.start + from, line.start + to);
    const last = segments[segments.length - 1];
    if (last && last.changed === changed && last.kind === kind) last.text += segment;
    else segments.push({ text: segment, changed, kind });
  }
  return segments.length > 0 ? segments : undefined;
}

/**
 * Aligns one changed run of a hunk the way IntelliJ does: the words and
 * newlines of the run are diffed together, so lines pair where their content
 * does and the word marks stay on the lines that actually changed. A run
 * whose lines have nothing in common comes back as one padded block.
 *
 * The alignment runs whatever the highlighting policy is; the policy only
 * decides which marks are computed, as IDEA's comparison provider does.
 */
function alignChangedLines(
  dels: readonly DiffLine[],
  adds: readonly DiffLine[],
  hunk: number,
  highlight: HighlightMode,
): AlignedRow[] {
  if (dels.length === 0) {
    return adds.map((line) => ({
      kind: "add",
      hunk,
      right: { no: line.newNo, text: line.text, kind: "add" },
    }));
  }
  if (adds.length === 0) {
    return dels.map((line) => ({
      kind: "del",
      hunk,
      left: { no: line.oldNo, text: line.text, kind: "del" },
    }));
  }
  const oldText = dels.map((line) => line.text).join("\n");
  const newText = adds.map((line) => line.text).join("\n");
  const oldLines = splitLineOffsets(oldText);
  const newLines = splitLineOffsets(newText);
  const rows: AlignedRow[] = [];
  for (const block of compareAndSplit(oldText, newText)) {
    const oldRange = linesInBlock(oldLines, block.start1, block.end1);
    const newRange = linesInBlock(newLines, block.start2, block.end2);
    const oldBlock = oldText.slice(block.start1, block.end1);
    const newBlock = newText.slice(block.start2, block.end2);
    const count = Math.max(oldRange.length, newRange.length);
    for (let i = 0; i < count; i++) {
      const oldIndex = oldRange[i];
      const newIndex = newRange[i];
      const del = oldIndex === undefined ? undefined : dels[oldIndex];
      const add = newIndex === undefined ? undefined : adds[newIndex];
      if (!del && !add) continue;
      const oldLine = oldIndex === undefined ? undefined : oldLines[oldIndex]!;
      const newLine = newIndex === undefined ? undefined : newLines[newIndex]!;
      let leftMarks: WordSegment[] | undefined;
      let rightMarks: WordSegment[] | undefined;
      if (highlight === "words") {
        leftMarks =
          del && oldLine
            ? segmentsForLine(
                oldBlock,
                { start: oldLine.start - block.start1, end: oldLine.end - block.start1 },
                block.fragments,
                "left",
              )
            : undefined;
        rightMarks =
          add && newLine
            ? segmentsForLine(
                newBlock,
                { start: newLine.start - block.start2, end: newLine.end - block.start2 },
                block.fragments,
                "right",
              )
            : undefined;
      } else if (highlight === "chars" && del && add) {
        // IDEA compares the inner text at character granularity. Both sides
        // having changed characters makes the line a modification; a line
        // where only one side gained or lost text keeps that side's kind.
        const [left, right] = charDiff(del.text, add.text);
        const kind = left.some((segment) => segment.changed) && right.some((segment) => segment.changed)
          ? "modified"
          : left.some((segment) => segment.changed)
            ? "deleted"
            : "inserted";
        leftMarks = left.map((segment) => (segment.changed ? { ...segment, kind } : segment));
        rightMarks = right.map((segment) => (segment.changed ? { ...segment, kind } : segment));
      }
      rows.push({
        kind: del && add ? "change" : del ? "del" : "add",
        hunk,
        left: del
          ? {
              no: del.oldNo,
              text: del.text,
              kind: "del",
              segments: leftMarks,
            }
          : undefined,
        right: add
          ? {
              no: add.newNo,
              text: add.text,
              kind: "add",
              segments: rightMarks,
            }
          : undefined,
      });
    }
  }
  return rows;
}

/** The rendered width of one line in monospace cells. Tabs jump to the next
 *  eight-cell stop, and East Asian and emoji characters take two cells, so a
 *  non-wrapping diff can size each column to the widest line it has to show. */
export function lineWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9) width += 8 - (width % 8);
    else width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/** A line already split into coloured runs, the shape `paintLine` returns. */
interface ColouredPiece {
  text: string;
  cls: string;
}

/**
 * revealWhitespace draws spaces and tabs the way an editor's "Show
 * Whitespaces" does: a space is a middle dot, a tab is an arrow followed by
 * padding to the next eight-cell stop. Columns are counted in monospace
 * cells, so a wide character before a tab still puts the arrow on the right
 * stop. Whitespace runs are tagged `ws` so the stylesheet can mute them
 * without touching the token colour around them; a changed space keeps its
 * change mark, because hiding it would hide the very difference being shown.
 */
export function revealWhitespace<T extends ColouredPiece>(pieces: readonly T[]): T[] {
  const out: T[] = [];
  let column = 0;
  const emit = (piece: T, cls: string, text: string) => {
    if (text === "") return;
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.text += text;
    else out.push({ ...piece, cls, text });
  };
  for (const piece of pieces) {
    let runCls = piece.cls;
    let run = "";
    for (const ch of piece.text) {
      const code = ch.codePointAt(0) ?? 0;
      const space = code === 32 || code === 9 || code === 0x3000;
      const cls = space ? `${piece.cls} ws`.trim() : piece.cls;
      if (cls !== runCls) {
        emit(piece, runCls, run);
        run = "";
        runCls = cls;
      }
      if (code === 32) {
        run += "·";
        column += 1;
      } else if (code === 0x3000) {
        run += "·";
        column += 2;
      } else if (code === 9) {
        const stop = column + 8 - (column % 8);
        run += "→" + " ".repeat(Math.max(0, stop - column - 1));
        column = stop;
      } else {
        run += ch;
        column += isWide(code) ? 2 : 1;
      }
    }
    emit(piece, runCls, run);
  }
  return out;
}

/** How many unchanged rows a folded run keeps visible beside each change,
 *  which is what makes an expanded fragment enough context to read the code
 *  around it. */
export const FOLD_CONTEXT = 3;

/**
 * foldRanges finds the runs of unchanged rows a folded viewer hides. A run at
 * the start or end of the file keeps no context on its outer side, so the
 * first change is not pushed down by three meaningless lines; a run between
 * two changes keeps `context` rows on both sides. A run that would hide fewer
 * than two rows is left alone: a separator taller than what it saves is noise.
 */
export function foldRanges(rows: readonly AlignedRow[], context = FOLD_CONTEXT): FoldRange[] {
  const out: FoldRange[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]!.kind !== "context") {
      i++;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end]!.kind === "context") end++;
    const top = i === 0 ? 0 : context;
    const bottom = end === rows.length ? 0 : context;
    const start = i + top;
    const stop = end - bottom;
    if (stop - start >= 4) out.push({ start, end: stop, count: stop - start });
    i = end;
  }
  return out;
}

/**
 * visibleRows walks the full row list, replacing each closed fold with its
 * marker. Row indices stay those of the full list, so navigation, selection
 * and the apply arrows keep pointing at the same lines when a fold opens.
 */
export function visibleRows(
  rows: readonly AlignedRow[],
  folds: readonly FoldRange[],
  open: ReadonlySet<number>,
): VisibleRow[] {
  const starts = new Map<number, FoldRange>();
  for (const fold of folds) starts.set(fold.start, fold);
  const out: VisibleRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const fold = starts.get(i);
    if (fold && !open.has(fold.start)) {
      out.push({ kind: "fold", fold });
      i = fold.end - 1;
      continue;
    }
    out.push({ kind: "row", row: rows[i]!, index: i });
  }
  return out;
}
