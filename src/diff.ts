import type { DiffHunk, DiffLine, FileDiff } from "./mygo";

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

/**
 * wordDiff marks the words that differ between two changed lines, so the
 * viewer can highlight inside the line.
 */
export function wordDiff(a: string, b: string): [WordSegment[], WordSegment[]] {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.length > 1200 || right.length > 1200) {
    return [
      [{ text: a, changed: true }],
      [{ text: b, changed: true }],
    ];
  }
  const n = left.length;
  const m = right.length;
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
      const count = Math.max(dels.length, adds.length);
      for (let k = 0; k < count; k++) {
        const del = dels[k];
        const add = adds[k];
        let leftSegs: WordSegment[] | undefined;
        let rightSegs: WordSegment[] | undefined;
        if (del && add) [leftSegs, rightSegs] = wordDiff(del.text, add.text);
        rows.push({
          kind: del && add ? "change" : del ? "del" : "add",
          hunk: h,
          left: del ? { no: del.oldNo, text: del.text, kind: "del", segments: leftSegs } : undefined,
          right: add ? { no: add.newNo, text: add.text, kind: "add", segments: rightSegs } : undefined,
        });
      }
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
      const count = Math.max(dels.length, adds.length);
      for (let k = 0; k < count; k++) {
        const del = dels[k];
        const add = adds[k];
        let leftSegs: WordSegment[] | undefined;
        let rightSegs: WordSegment[] | undefined;
        if (del && add) [leftSegs, rightSegs] = wordDiff(del.text, add.text);
        rows.push({
          kind: del && add ? "change" : del ? "del" : "add",
          hunk: h,
          left: del ? { no: del.oldNo, text: del.text, kind: "del", segments: leftSegs } : undefined,
          right: add ? { no: add.newNo, text: add.text, kind: "add", segments: rightSegs } : undefined,
        });
      }
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
