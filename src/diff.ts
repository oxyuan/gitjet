import type { DiffHunk, DiffLine, FileDiff } from "./mygo";
import { compareAndSplit, type WordFragment } from "./worddiff";

export interface WordSegment {
  text: string;
  changed: boolean;
}

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

export interface CollapsedRow {
  collapsed: number;
  key: number;
}

export type DiffRow = AlignedRow | CollapsedRow;

/** The rows a diff viewer renders, in order. */
export type DiffRows = DiffRow[];

export function isCollapsed(row: DiffRow): row is CollapsedRow {
  return "collapsed" in row;
}

/**
 * The first row of every run of consecutive changed rows. A run is one block
 * even when it spans many added and deleted lines, so navigation and the
 * "n / m" counter talk about changes, not lines.
 */
export function changeBlockRows(rows: DiffRows): number[] {
  const out: number[] = [];
  let inBlock = false;
  rows.forEach((row, i) => {
    if (isCollapsed(row) || row.kind === "context") {
      inBlock = false;
      return;
    }
    if (!inBlock) out.push(i);
    inBlock = true;
  });
  return out;
}

/**
 * The signed lines of every change block, keyed by the block's first row.
 * A whole-file diff has one hunk, so these are what a hunk-level control
 * must apply: one run of changed rows, with old lines negative so a deleted
 * line and an added line that share a number stay apart.
 */
export function changeBlockSelections(rows: DiffRows): Map<number, number[]> {
  const blocks = new Map<number, number[]>();
  let current = -1;
  rows.forEach((row, i) => {
    if (isCollapsed(row) || row.kind === "context") {
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

/** charDiff highlights the individual characters that differ. */
export function charDiff(a: string, b: string): [WordSegment[], WordSegment[]] {
  return diffTokens(Array.from(a), Array.from(b));
}

/**
 * buildDiffRows aligns the old and new files into rows and pairs deleted and
 * added lines so word differences can be highlighted. Unchanged stretches are
 * folded unless the caller asked for the whole file.
 */
export function buildDiffRows(diff: FileDiff, fold = !diff.wholeFile): DiffRows {
  const hasText = diff.oldText !== "" || diff.newText !== "";
  const oldLines = textLines(diff.oldText);
  const newLines = textLines(diff.newText);
  const rows: AlignedRow[] = [];
  if (!hasText || diff.hunks.length === 0) {
    if (diff.hunks.length === 0) return rows;
    return rowsFromHunks(diff.hunks, fold);
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
      rows.push(...alignChangedLines(dels, adds, h));
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
  return fold ? collapseUnchanged(rows) : rows;
}

function rowsFromHunks(hunks: DiffHunk[], fold: boolean): DiffRow[] {
  const rows: AlignedRow[] = [];
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h]!;
    let dels: DiffLine[] = [];
    let adds: DiffLine[] = [];
    const flush = () => {
      rows.push(...alignChangedLines(dels, adds, h));
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
  return fold ? collapseUnchanged(rows) : rows;
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
 *  line, so a fragment that spans several lines paints each line separately. */
function segmentsForLine(
  text: string,
  line: BlockLine,
  fragments: readonly WordFragment[],
  side: "left" | "right",
): WordSegment[] | undefined {
  const length = line.end - line.start;
  const ranges: [number, number][] = [];
  for (const fragment of fragments) {
    const from = Math.max(side === "left" ? fragment.start1 : fragment.start2, line.start) - line.start;
    const to = Math.min(side === "left" ? fragment.end1 : fragment.end2, line.end) - line.start;
    if (to > from) ranges.push([from, to]);
  }
  if (ranges.length === 0) return undefined;
  ranges.sort((a, b) => a[0] - b[0]);
  const cuts = new Set<number>([0, length]);
  for (const [from, to] of ranges) {
    cuts.add(from);
    cuts.add(to);
  }
  const ordered = [...cuts].sort((a, b) => a - b);
  const segments: WordSegment[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    if (to <= from) continue;
    const changed = ranges.some(([rangeFrom, rangeTo]) => rangeFrom <= from && to <= rangeTo);
    const segment = text.slice(line.start + from, line.start + to);
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += segment;
    else segments.push({ text: segment, changed });
  }
  return segments.length > 0 ? segments : undefined;
}

/**
 * Aligns one changed run of a hunk the way IntelliJ does: the words and
 * newlines of the run are diffed together, so lines pair where their content
 * does and the word marks stay on the lines that actually changed. A run
 * whose lines have nothing in common comes back as one padded block.
 */
function alignChangedLines(dels: readonly DiffLine[], adds: readonly DiffLine[], hunk: number): AlignedRow[] {
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
      rows.push({
        kind: del && add ? "change" : del ? "del" : "add",
        hunk,
        left: del
          ? {
              no: del.oldNo,
              text: del.text,
              kind: "del",
              segments:
                oldLine === undefined
                  ? undefined
                  : segmentsForLine(
                      oldBlock,
                      { start: oldLine.start - block.start1, end: oldLine.end - block.start1 },
                      block.fragments,
                      "left",
                    ),
            }
          : undefined,
        right: add
          ? {
              no: add.newNo,
              text: add.text,
              kind: "add",
              segments:
                newLine === undefined
                  ? undefined
                  : segmentsForLine(
                      newBlock,
                      { start: newLine.start - block.start2, end: newLine.end - block.start2 },
                      block.fragments,
                      "right",
                    ),
            }
          : undefined,
      });
    }
  }
  return rows;
}

/** collapseUnchanged replaces runs of unchanged rows with one marker row. */
function collapseUnchanged(rows: AlignedRow[]): DiffRow[] {
  const out: DiffRow[] = [];
  let run: AlignedRow[] = [];
  const flush = () => {
    if (run.length > 6) {
      out.push({ collapsed: run.length, key: out.length });
    } else {
      out.push(...run);
    }
    run = [];
  };
  for (const row of rows) {
    if (row.kind === "context") run.push(row);
    else {
      flush();
      out.push(row);
    }
  }
  flush();
  return out;
}
