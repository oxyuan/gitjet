/**
 * Three-way line merge, the model the conflict view draws: every range says
 * which side changed what, and the result is built from those ranges rather
 * than from the markers Git happened to write.
 */

export interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

export type MergeKind = "inserted" | "deleted" | "modified" | "conflict";

export interface MergeRange {
  /** Position in the range list; the view uses it as the block id. */
  index: number;
  kind: MergeKind;
  baseStart: number;
  baseEnd: number;
  oursStart: number;
  oursEnd: number;
  theirsStart: number;
  theirsEnd: number;
  oursChanged: boolean;
  theirsChanged: boolean;
  base: string[];
  ours: string[];
  theirs: string[];
}

export interface MergeLabels {
  ours: string;
  theirs: string;
}

export interface MergeModel {
  baseLines: string[];
  oursLines: string[];
  theirsLines: string[];
  ranges: MergeRange[];
  /** The result the view starts from: conflicts show their local side. */
  result: string;
  labels: MergeLabels;
  trailingNewline: boolean;
}

export type WhitespaceMode = "none" | "trim" | "spaces";

export interface MergeOptions {
  labels?: Partial<MergeLabels>;
  trailingNewline?: boolean;
  ignoreWhitespace?: boolean;
  /** The merge editor's "Ignore differences" setting; overrides the flag. */
  whitespaceMode?: WhitespaceMode;
}

type LineEq = (a: string, b: string) => boolean;

type DiffOp =
  | { kind: "equal" | "delete"; aStart: number; aEnd: number; bStart: number; bEnd: number }
  | { kind: "insert"; aStart: number; aEnd: number; bStart: number; bEnd: number };

const exact: LineEq = (a, b) => a === b;

/** splitLines keeps the caller's trailing-newline fact out of the lines. */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === "") return { lines: [], trailingNewline: false };
  const lines = text.split("\n");
  const trailingNewline = lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

/** Myers diff over lines. Common prefix and suffix are trimmed first, which
 *  keeps the edit graph small for the usual case of two similar files. */
function diffOps(a: string[], b: string[], eq: LineEq): DiffOp[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && eq(a[prefix]!, b[prefix]!)) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    eq(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)
  ) {
    suffix++;
  }

  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  const ops: DiffOp[] = [];
  const fallback = (): DiffOp[] => {
    if (prefix > 0) ops.push({ kind: "equal", aStart: 0, aEnd: prefix, bStart: 0, bEnd: prefix });
    if (n > 0) ops.push({ kind: "delete", aStart: prefix, aEnd: prefix + n, bStart: prefix, bEnd: prefix });
    if (m > 0) ops.push({ kind: "insert", aStart: prefix, aEnd: prefix, bStart: prefix, bEnd: prefix + m });
    if (suffix > 0) {
      ops.push({
        kind: "equal",
        aStart: a.length - suffix,
        aEnd: a.length,
        bStart: b.length - suffix,
        bEnd: b.length,
      });
    }
    return ops;
  };

  const max = n + m;
  if (n === 0 || m === 0) return fallback();
  {
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3).fill(-1);
    v[offset + 1] = 0;
    const trace: Int32Array[] = [];
    let done = false;
    for (let d = 0; d <= max && !done; d++) {
      // A pathological diff is not worth an out-of-memory crash: when the
      // trace outgrows its budget, treat the different middle as one change.
      if ((d + 1) * (2 * max + 3) > 4_000_000) return fallback();
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
        else x = v[offset + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && x >= 0 && y >= 0 && eq(a[prefix + x]!, b[prefix + y]!)) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          done = true;
          break;
        }
      }
    }

    if (!done) return fallback();
    if (prefix > 0) ops.push({ kind: "equal", aStart: 0, aEnd: prefix, bStart: 0, bEnd: prefix });
    const middle: DiffOp[] = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vd = trace[d]!;
      const k = x - y;
      const prevK =
        k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
      const prevX = vd[offset + prevK]!;
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        middle.push({
          kind: "equal",
          aStart: prefix + x - 1,
          aEnd: prefix + x,
          bStart: prefix + y - 1,
          bEnd: prefix + y,
        });
        x--;
        y--;
      }
      if (d === 0) break;
      if (x === prevX) {
        middle.push({ kind: "insert", aStart: prefix + x, aEnd: prefix + x, bStart: prefix + y - 1, bEnd: prefix + y });
        y--;
      } else {
        middle.push({ kind: "delete", aStart: prefix + x - 1, aEnd: prefix + x, bStart: prefix + y, bEnd: prefix + y });
        x--;
      }
    }
    ops.push(...middle.reverse());
  }

  if (suffix > 0) {
    ops.push({
      kind: "equal",
      aStart: a.length - suffix,
      aEnd: a.length,
      bStart: b.length - suffix,
      bEnd: b.length,
    });
  }
  return ops;
}

/** diffHunks collapses adjacent insert/delete operations into one changed
 *  region, which is the unit the merge view navigates. */
export function diffHunks(a: string[], b: string[], ignoreWhitespace = false): DiffHunk[] {
  const eq = ignoreWhitespace ? whitespaceInsensitive : exact;
  const ops = diffOps(a, b, eq);
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  const flush = () => {
    if (current) hunks.push(current);
    current = null;
  };
  for (const op of ops) {
    if (op.kind === "equal") {
      flush();
      continue;
    }
    if (!current) {
      current = {
        baseStart: op.aStart,
        baseEnd: op.aEnd,
        sideStart: op.bStart,
        sideEnd: op.bEnd,
      };
    } else {
      current.baseStart = Math.min(current.baseStart, op.aStart);
      current.baseEnd = Math.max(current.baseEnd, op.aEnd);
      current.sideStart = Math.min(current.sideStart, op.bStart);
      current.sideEnd = Math.max(current.sideEnd, op.bEnd);
    }
  }
  flush();
  return hunks;
}

interface Boundaries {
  before: number[];
  after: number[];
}

function sideBoundaries(baseLength: number, ops: DiffOp[]): Boundaries {
  const before = new Array<number>(baseLength + 1).fill(0);
  const after = new Array<number>(baseLength + 1).fill(0);
  const beforeSet = new Array<boolean>(baseLength + 1).fill(false);
  const afterSet = new Array<boolean>(baseLength + 1).fill(false);
  beforeSet[0] = true;
  afterSet[0] = true;
  let b = 0;
  let s = 0;
  for (const op of ops) {
    if (op.kind === "equal") {
      const len = op.aEnd - op.aStart;
      for (let i = 0; i < len; i++) {
        if (!beforeSet[b + i]) {
          before[b + i] = s + i;
          beforeSet[b + i] = true;
        }
        after[b + i] = s + i;
        afterSet[b + i] = true;
      }
      b += len;
      s += len;
      if (!beforeSet[b]) before[b] = s;
      beforeSet[b] = true;
      after[b] = s;
      afterSet[b] = true;
    } else if (op.kind === "delete") {
      const len = op.aEnd - op.aStart;
      for (let i = 0; i < len; i++) {
        if (!beforeSet[b + i]) before[b + i] = s;
        beforeSet[b + i] = true;
        after[b + i] = s;
        afterSet[b + i] = true;
      }
      b += len;
      if (!beforeSet[b]) before[b] = s;
      beforeSet[b] = true;
      after[b] = s;
      afterSet[b] = true;
    } else {
      if (!beforeSet[b]) before[b] = s;
      beforeSet[b] = true;
      after[b] = s + (op.bEnd - op.bStart);
      afterSet[b] = true;
      s += op.bEnd - op.bStart;
    }
  }
  for (let i = 0; i <= baseLength; i++) {
    if (!beforeSet[i]) before[i] = s;
    if (!afterSet[i]) after[i] = s;
  }
  return { before, after };
}

function whitespaceInsensitive(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/** whitespaceEq is the line comparison the "Ignore differences" menu picks. */
export function whitespaceEq(mode: WhitespaceMode): LineEq {
  if (mode === "spaces") return whitespaceInsensitive;
  if (mode === "trim") return (a, b) => a.trim() === b.trim();
  return exact;
}

function textEqual(a: string[], b: string[], eq: LineEq): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i]!, b[i]!)) return false;
  return true;
}

function hunksOverlap(a: DiffHunk, b: DiffHunk): boolean {
  return overlaps(a, b.baseStart, b.baseEnd) || overlaps(b, a.baseStart, a.baseEnd);
}

function overlaps(hunk: DiffHunk, start: number, end: number): boolean {
  if (hunk.baseStart === hunk.baseEnd) return hunk.baseStart >= start && hunk.baseStart <= end;
  if (start === end) return hunk.baseStart <= start && hunk.baseEnd >= end;
  return hunk.baseStart < end && hunk.baseEnd > start;
}

function hunksWithEq(base: string[], side: string[], eq: LineEq): DiffHunk[] {
  const ops = diffOps(base, side, eq);
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  const flush = () => {
    if (current) hunks.push(current);
    current = null;
  };
  for (const op of ops) {
    if (op.kind === "equal") {
      flush();
      continue;
    }
    if (!current) {
      current = { baseStart: op.aStart, baseEnd: op.aEnd, sideStart: op.bStart, sideEnd: op.bEnd };
    } else {
      current.baseStart = Math.min(current.baseStart, op.aStart);
      current.baseEnd = Math.max(current.baseEnd, op.aEnd);
      current.sideStart = Math.min(current.sideStart, op.bStart);
      current.sideEnd = Math.max(current.sideEnd, op.bEnd);
    }
  }
  flush();
  return hunks;
}

function buildRanges(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  oursHunks: DiffHunk[],
  theirsHunks: DiffHunk[],
  oursBoundary: Boundaries,
  theirsBoundary: Boundaries,
  eq: LineEq,
): MergeRange[] {
  const ranges: MergeRange[] = [];
  let i = 0;
  let j = 0;
  const push = (
    start: number,
    end: number,
    a: DiffHunk[],
    b: DiffHunk[],
  ) => {
    const base = baseLines.slice(start, end);
    const oursStart = a.length > 0 && a[0]!.baseStart === start ? a[0]!.sideStart : oursBoundary.after[start]!;
    const oursEnd = a.length > 0 && a[a.length - 1]!.baseEnd === end ? a[a.length - 1]!.sideEnd : oursBoundary.before[end]!;
    const theirsStart = b.length > 0 && b[0]!.baseStart === start ? b[0]!.sideStart : theirsBoundary.after[start]!;
    const theirsEnd = b.length > 0 && b[b.length - 1]!.baseEnd === end ? b[b.length - 1]!.sideEnd : theirsBoundary.before[end]!;
    const ours = oursLines.slice(oursStart, oursEnd);
    const theirs = theirsLines.slice(theirsStart, theirsEnd);
    const oursEqBase = textEqual(ours, base, eq);
    const theirsEqBase = textEqual(theirs, base, eq);
    const bothChanged = !oursEqBase && !theirsEqBase;
    const same = textEqual(ours, theirs, eq);
    const conflict = bothChanged && !same;
    let kind: MergeKind;
    if (conflict) kind = "conflict";
    else if (base.length === 0) kind = "inserted";
    else if ((same ? ours : theirsEqBase ? ours : theirs).length === 0) kind = "deleted";
    else kind = "modified";
    ranges.push({
      index: ranges.length,
      kind,
      baseStart: start,
      baseEnd: end,
      oursStart,
      oursEnd,
      theirsStart,
      theirsEnd,
      oursChanged: a.length > 0,
      theirsChanged: b.length > 0,
      base,
      ours,
      theirs,
    });
  };

  while (i < oursHunks.length || j < theirsHunks.length) {
    const a = oursHunks[i];
    const b = theirsHunks[j];
    if (a && b && hunksOverlap(a, b)) {
      let start = Math.min(a.baseStart, b.baseStart);
      let end = Math.max(a.baseEnd, b.baseEnd);
      const as: DiffHunk[] = [];
      const bs: DiffHunk[] = [];
      let progressed = true;
      while (progressed) {
        progressed = false;
        while (i < oursHunks.length && overlaps(oursHunks[i]!, start, end)) {
          const h = oursHunks[i]!;
          as.push(h);
          start = Math.min(start, h.baseStart);
          end = Math.max(end, h.baseEnd);
          i++;
          progressed = true;
        }
        while (j < theirsHunks.length && overlaps(theirsHunks[j]!, start, end)) {
          const h = theirsHunks[j]!;
          bs.push(h);
          start = Math.min(start, h.baseStart);
          end = Math.max(end, h.baseEnd);
          j++;
          progressed = true;
        }
      }
      push(start, end, as, bs);
    } else if (a && (!b || a.baseStart < b.baseStart || (a.baseStart === b.baseStart && a.baseEnd <= b.baseEnd))) {
      i++;
      push(a.baseStart, a.baseEnd, [a], []);
    } else if (b) {
      j++;
      push(b.baseStart, b.baseEnd, [], [b]);
    }
  }
  return ranges;
}

/** The lines a non-conflict range contributes to the result. */
export function chosenLines(range: MergeRange, eq: LineEq = exact): string[] {
  if (range.kind === "conflict") return range.ours;
  if (!range.theirsChanged) return range.ours;
  if (!range.oursChanged) return range.theirs;
  if (textEqual(range.ours, range.base, eq)) return range.theirs;
  if (textEqual(range.theirs, range.base, eq)) return range.ours;
  return range.ours;
}

/**
 * "Revert change", the counterpart of IDEA's Revert/Reset gutter action: a
 * conflict goes back to its local side and reopens, while a decided change
 * goes back to the merge base. Reverting a change is not the same as ignoring
 * a side: ignore keeps the other side's text, revert drops the whole edit.
 */
export function resetRangeLines(range: MergeRange): { lines: string[]; resolved: boolean } {
  return range.kind === "conflict"
    ? { lines: range.ours, resolved: false }
    : { lines: range.base, resolved: true };
}

/**
 * Tries the line-attribution merge IDEA's wand performs: a line is taken from
 * the side that changed it, and the block stays a conflict only when both
 * sides changed the same line differently.
 */
export function tryResolveRange(range: MergeRange, ignoreWhitespace = false): string[] | null {
  const eq = ignoreWhitespace ? whitespaceInsensitive : exact;
  if (range.kind !== "conflict") return chosenLines(range, eq);
  // One side deleted the block while the other kept or changed it: the IDE
  // treats that as simple and keeps the side that still has text.
  if (range.ours.length === 0 && range.theirs.length > 0) return range.theirs;
  if (range.theirs.length === 0 && range.ours.length > 0) return range.ours;
  const total = Math.max(range.base.length, range.ours.length, range.theirs.length);
  const out: string[] = [];
  for (let i = 0; i < total; i++) {
    const b = range.base[i];
    const o = range.ours[i];
    const t = range.theirs[i];
    const oSame = lineEqual(o, b, eq);
    const tSame = lineEqual(t, b, eq);
    if (oSame && tSame) {
      if (o !== undefined) out.push(o);
    } else if (!oSame && tSame) {
      if (o !== undefined) out.push(o);
    } else if (oSame && !tSame) {
      if (t !== undefined) out.push(t);
    } else if (o !== undefined && t !== undefined && eq(o, t)) {
      out.push(o);
    } else {
      return null;
    }
  }
  return out;
}

function lineEqual(a: string | undefined, b: string | undefined, eq: LineEq): boolean {
  if (a === undefined || b === undefined) return a === b;
  return eq(a, b);
}

/** One piece of a working file: text that needs no decision, or a conflict
 *  section Git wrapped in markers. */
export type ConflictSegment =
  | { kind: "text"; text: string }
  | {
      kind: "conflict";
      ours: string[];
      base: string[] | null;
      theirs: string[];
      /** The closing marker line ended with a newline in the file. */
      newline: boolean;
    };

/**
 * The lines a range shows after "Ignore" on one side: that side's change is
 * dropped. When the other side changed the same region its text is kept;
 * when it did not, the merge base comes back. Ignoring is the mirror of
 * applying the other side, which is what the IDE does.
 */
export function ignoreRangeLines(range: MergeRange, side: "ours" | "theirs"): string[] {
  if (side === "ours") return range.theirsChanged ? range.theirs : range.base;
  return range.oursChanged ? range.ours : range.base;
}

/** Character offsets of the composed result's line starts. */
function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/**
 * conflictSegments reads the working file into plain text and conflict
 * sections, keeping the plain text exactly as it is. Null means a block was
 * malformed, so the caller must not trust the parse.
 */
export function conflictSegments(text: string): ConflictSegment[] | null {
  const lines = text.split("\n");
  const starts = lineStartsOf(text);
  const after = (line: number) => starts[line + 1] ?? text.length;
  const segments: ConflictSegment[] = [];
  let cursor = 0;
  let i = 0;
  while (i < lines.length) {
    if (!lines[i]!.startsWith("<<<<<<<")) {
      i++;
      continue;
    }
    const start = i;
    const ours: string[] = [];
    const theirs: string[] = [];
    let base: string[] | null = null;
    let mode: "ours" | "base" | "theirs" = "ours";
    let closed = false;
    for (i++; i < lines.length; i++) {
      const line = lines[i]!;
      if (mode === "ours" && line.startsWith("|||||||")) {
        base = [];
        mode = "base";
      } else if (mode !== "theirs" && line === "=======") {
        mode = "theirs";
      } else if (mode === "theirs" && line.startsWith(">>>>>>>")) {
        closed = true;
        break;
      } else if (line.startsWith("<<<<<<<")) {
        return null;
      } else if (line === "=======" || line.startsWith("|||||||") || line.startsWith(">>>>>>>")) {
        // The line reads as a marker but sits where only content belongs, so
        // the section boundaries are guesses: refuse the parse rather than
        // attribute this text to the wrong side.
        return null;
      } else if (mode === "ours") {
        ours.push(line);
      } else if (mode === "base") {
        base!.push(line);
      } else {
        theirs.push(line);
      }
    }
    if (!closed) return null;
    const blockStart = starts[start]!;
    if (blockStart > cursor) segments.push({ kind: "text", text: text.slice(cursor, blockStart) });
    const blockEnd = after(i);
    segments.push({
      kind: "conflict",
      ours,
      base,
      theirs,
      newline: blockEnd > starts[i]! + lines[i]!.length,
    });
    cursor = blockEnd;
    i++;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/** The working file without Git's marker lines: each section keeps the local
 *  side, which is what the three-way model starts from. */
function strippedWorking(segments: ConflictSegment[]): string {
  let text = "";
  for (const segment of segments) {
    if (segment.kind === "text") {
      text += segment.text;
      continue;
    }
    text += segment.ours.join("\n") + (segment.ours.length > 0 && segment.newline ? "\n" : "");
  }
  return text;
}

/** One model range as the result pane holds it. Ids are range indexes, so the
 *  three panes address the same block. */
export interface MergeBlock {
  index: number;
  lines: string[];
  resolved: boolean;
  /** Character span in the view's text. */
  from: number;
  to: number;
}

export interface MergeView {
  text: string;
  /** One block per model range, in order. */
  blocks: MergeBlock[];
  /** Indexes of the conflict ranges that still carry Git's markers. */
  open: number[];
}

/** Line positions of `base` in `side`: a line copied verbatim maps to the
 *  same offset, and a changed stretch maps its start to the side's start and
 *  its end to the side's end. At an insertion point the two differ: the text
 *  before the boundary ends before the inserted lines, the line after it
 *  begins after them. A range must not swallow inserted lines that sit at its
 *  end, so `end` keeps the pre-insertion offset. */
function lineMap(base: string[], side: string[]): { start: number[]; end: number[] } {
  const start = new Array<number>(base.length + 1).fill(0);
  const end = new Array<number>(base.length + 1).fill(0);
  const set = new Array<boolean>(base.length + 1).fill(false);
  const put = (i: number, from: number, to: number) => {
    start[i] = from;
    end[i] = to;
    set[i] = true;
  };
  let b = 0;
  let s = 0;
  for (const hunk of diffHunks(base, side)) {
    for (let i = b; i < hunk.baseStart; i++) if (!set[i]) put(i, s + (i - b), s + (i - b));
    if (hunk.baseStart === hunk.baseEnd) {
      put(hunk.baseStart, hunk.sideEnd, hunk.sideStart);
    } else {
      put(hunk.baseStart, hunk.sideStart, hunk.sideStart);
      for (let i = hunk.baseStart + 1; i < hunk.baseEnd; i++) put(i, hunk.sideStart, hunk.sideEnd);
      put(hunk.baseEnd, hunk.sideEnd, hunk.sideEnd);
    }
    b = hunk.baseEnd;
    s = hunk.sideEnd;
  }
  for (let i = b; i <= base.length; i++) if (!set[i]) put(i, s + (i - b), s + (i - b));
  return { start, end };
}

/** Whether a range's mapped span belongs to a marker section. zdiff3 pulls
 *  lines shared by both sides out of the section, so a conflicted range may be
 *  wider than the section's own body: overlap, not containment, is the test.
 *  A section whose local side was entirely pulled out is a point inside the
 *  range it represents. */
function inSection(
  span: { from: number; to: number },
  section: { from: number; to: number },
): boolean {
  if (section.from === section.to) return span.from <= section.from && span.to >= section.from;
  if (span.from === span.to) return span.from >= section.from && span.from <= section.to;
  return span.from < section.to && span.to > section.from;
}

/**
 * buildMergeView turns the three-way model plus the working file into the
 * result pane's blocks. Every changed range is a block: a conflicted range
 * stays open while Git's markers are around it, and an auto-merged range is
 * already settled. The result text is composed from the model, so a conflict
 * region that Git grouped around changes only one side made keeps those
 * changes instead of showing the whole local section.
 *
 * Ranges outside the marker sections keep whatever the working file holds
 * there, which is how a file saved half-resolved reopens with its decisions.
 */
export function buildMergeView(model: MergeModel, working: string): MergeView {
  const expected: string[] = [];
  const expectedSpans = new Map<number, { from: number; to: number }>();
  let b = 0;
  for (const range of model.ranges) {
    for (let i = b; i < range.baseStart; i++) expected.push(model.baseLines[i]!);
    const from = expected.length;
    expected.push(...(range.kind === "conflict" ? range.ours : chosenLines(range)));
    expectedSpans.set(range.index, { from, to: expected.length });
    b = range.baseEnd;
  }
  for (let i = b; i < model.baseLines.length; i++) expected.push(model.baseLines[i]!);

  const parsed = conflictSegments(working);
  // Text that cannot be read apart from the markers around it proves nothing:
  // treating a broken parse as "Git already dropped those markers" is how a
  // file still full of markers got staged. Such a file keeps the model's own
  // text and every conflict open.
  const trusted = parsed !== null;
  const segments: ConflictSegment[] = parsed ?? [];
  const stripped = trusted ? splitLines(strippedWorking(segments)).lines : [];
  // A missing working file (a path the merge never wrote) has nothing to
  // compare either; the stages are all there is.
  const noFile = working === "" && expected.length > 0;
  const compare = trusted && !noFile;
  const map = compare ? lineMap(expected, stripped) : null;

  const sections: { from: number; to: number }[] = [];
  if (compare) {
    let at = 0;
    for (const segment of segments) {
      if (segment.kind === "text") {
        at += splitLines(segment.text).lines.length;
        continue;
      }
      sections.push({ from: at, to: at + segment.ours.length });
      at += segment.ours.length;
    }
  }

  const lines: string[] = [];
  const spans: { index: number; from: number; to: number }[] = [];
  const open: number[] = [];
  b = 0;
  for (const range of model.ranges) {
    for (let i = b; i < range.baseStart; i++) lines.push(model.baseLines[i]!);
    const span = expectedSpans.get(range.index)!;
    const sameLine = span.from === span.to;
    const mapped = {
      from: map?.start[span.from] ?? span.from,
      to: map ? (sameLine ? map.start[span.to]! : map.end[span.to]!) : span.to,
    };
    const section = map ? sections.find((candidate) => inSection(mapped, candidate)) : undefined;
    let rangeLines: string[];
    if (!compare || section) {
      // Git grouped this range into a conflict section: a one-sided change is
      // still an auto-merge, a conflicted one waits for a decision.
      rangeLines = range.kind === "conflict" ? range.ours : chosenLines(range);
    } else {
      rangeLines = stripped.slice(mapped.from, mapped.to);
    }
    const from = lines.length;
    lines.push(...rangeLines);
    spans.push({ index: range.index, from, to: lines.length });
    if (range.kind === "conflict" && (!compare || section !== undefined)) open.push(range.index);
    b = range.baseEnd;
  }
  for (let i = b; i < model.baseLines.length; i++) lines.push(model.baseLines[i]!);

  const text = lines.join("\n") + (model.trailingNewline && lines.length > 0 ? "\n" : "");
  const starts = lineStartsOf(text);
  const openSet = new Set(open);
  const blocks: MergeBlock[] = spans.map((span) => ({
    index: span.index,
    lines: lines.slice(span.from, span.to),
    resolved: !openSet.has(span.index),
    from: starts[span.from] ?? text.length,
    to: starts[span.to] ?? text.length,
  }));
  return { text, blocks, open };
}

/**
 * blockText is the text one block of the result must hold. A block span covers
 * whole lines including their line breaks, so the replacement is composed from
 * the lines themselves: an empty final line keeps the newline that makes it
 * exist, and an empty array deletes the block outright. A zero-width span is an
 * insertion point and needs its own line break.
 */
export function blockText(
  doc: string,
  span: { from: number; to: number },
  lines: string[],
): string {
  const from = Math.max(0, Math.min(span.from, doc.length));
  const to = Math.max(from, Math.min(span.to, doc.length));
  if (to > from) {
    if (lines.length === 0) return "";
    return lines.join("\n") + (doc.slice(from, to).endsWith("\n") ? "\n" : "");
  }
  if (lines.length === 0) return "";
  const text = lines.join("\n");
  if (doc.length === 0) return text;
  if (from >= doc.length) return doc.slice(doc.length - 1).endsWith("\n") ? text + "\n" : "\n" + text;
  return text + "\n";
}

/**
 * renderResolved composes the result from the three-way model alone: every
 * range contributes its current text, and a conflict contributes the local side
 * until it is resolved. No markers, so the block model is the only state.
 */
export function renderResolved(
  model: Pick<MergeModel, "baseLines" | "ranges" | "trailingNewline">,
  resolutions: ReadonlyMap<number, { lines: string[]; resolved: boolean }>,
  eq: LineEq = exact,
): string {
  const lines: string[] = [];
  let b = 0;
  for (const range of model.ranges) {
    for (let i = b; i < range.baseStart; i++) lines.push(model.baseLines[i]!);
    if (range.kind === "conflict") {
      lines.push(...(resolutions.get(range.index)?.lines ?? range.ours));
    } else {
      lines.push(...chosenLines(range, eq));
    }
    b = range.baseEnd;
  }
  for (let i = b; i < model.baseLines.length; i++) lines.push(model.baseLines[i]!);
  return lines.join("\n") + (model.trailingNewline && lines.length > 0 ? "\n" : "");
}

/**
 * Puts Git's markers back around the blocks that are still unresolved, so a
 * partially resolved file keeps its "unmerged" meaning for Git and every other
 * tool. `spans` are the unresolved blocks' current character ranges.
 */
export function insertConflictMarkers(
  text: string,
  spans: { from: number; to: number; theirs: string[] }[],
  labels: MergeLabels,
): string {
  const edits = spans
    .map((span) => ({
      from: Math.max(0, Math.min(span.from, text.length)),
      to: Math.max(span.from, Math.min(span.to, text.length)),
      theirs: span.theirs,
    }))
    .filter((span) => span.to >= span.from)
    .sort((a, b) => b.from - a.from);
  let out = text;
  for (const span of edits) {
    const body = out.slice(span.from, span.to);
    const atEof = span.to >= out.length;
    // The block's last line keeps the file's newline state; the lines before it
    // always end with one.
    const endsWithNewline = body.endsWith("\n") || !atEof;
    const inner = body === "" || body.endsWith("\n") ? body : body + "\n";
    const theirs = span.theirs.length > 0 ? span.theirs.join("\n") + "\n" : "";
    const tail = endsWithNewline ? "\n" : "";
    out =
      out.slice(0, span.from) +
      `<<<<<<< ${labels.ours}\n${inner}=======\n${theirs}>>>>>>> ${labels.theirs}${tail}` +
      out.slice(span.to);
  }
  return out;
}

/** computeMerge is the whole model: diff both sides against the base, join
 *  overlapping changes into conflict ranges, and render the initial result. */
export function computeMerge(
  baseText: string,
  oursText: string,
  theirsText: string,
  options: MergeOptions = {},
): MergeModel {
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);
  const mode: WhitespaceMode =
    options.whitespaceMode ?? (options.ignoreWhitespace ? "spaces" : "none");
  const eq = whitespaceEq(mode);
  const oursOps = diffOps(base.lines, ours.lines, eq);
  const theirsOps = diffOps(base.lines, theirs.lines, eq);
  const oursHunks = hunksWithEq(base.lines, ours.lines, eq);
  const theirsHunks = hunksWithEq(base.lines, theirs.lines, eq);
  const ranges = buildRanges(
    base.lines,
    ours.lines,
    theirs.lines,
    oursHunks,
    theirsHunks,
    sideBoundaries(base.lines.length, oursOps),
    sideBoundaries(base.lines.length, theirsOps),
    eq,
  );
  const labels: MergeLabels = {
    ours: options.labels?.ours?.trim() || "LOCAL",
    theirs: options.labels?.theirs?.trim() || "REMOTE",
  };
  const trailingNewline = options.trailingNewline ?? ours.trailingNewline;
  const model: MergeModel = {
    baseLines: base.lines,
    oursLines: ours.lines,
    theirsLines: theirs.lines,
    ranges,
    result: "",
    labels,
    trailingNewline,
  };
  return { ...model, result: renderResolved(model, new Map(), eq) };
}

/** Labels Git wrote into the working file, so the panes say branch names
 *  instead of LOCAL/REMOTE when they can. */
export function conflictLabels(text: string): Partial<MergeLabels> | null {
  let ours: string | undefined;
  let theirs: string | undefined;
  for (const line of text.split("\n")) {
    if (!ours && line.startsWith("<<<<<<<")) ours = line.slice(7).trim();
    if (line.startsWith(">>>>>>>")) theirs = line.slice(7).trim();
  }
  if (ours === undefined && theirs === undefined) return null;
  return { ours, theirs };
}

/** Number of conflict blocks still carrying an opening marker. */
export function countConflictMarkers(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) if (line.startsWith("<<<<<<<")) count++;
  return count;
}

/**
 * resolveSimpleConflicts renders the result the way "Resolve simple
 * conflicts" does: every conflict a line attribution can settle is replaced
 * by that merge, and the rest keep their markers. Unlike the initial result
 * it does not depend on what the user typed, so a dialog can resolve a file
 * without opening it.
 */
export function resolveSimpleConflicts(
  model: MergeModel,
  ignoreWhitespace = false,
): { text: string; remaining: number } {
  const eq = ignoreWhitespace ? whitespaceInsensitive : exact;
  const lines: string[] = [];
  let remaining = 0;
  let b = 0;
  for (const range of model.ranges) {
    for (let i = b; i < range.baseStart; i++) lines.push(model.baseLines[i]!);
    if (range.kind === "conflict") {
      const resolved = tryResolveRange(range, ignoreWhitespace) ?? tryResolveRange(range, true);
      if (resolved) {
        lines.push(...resolved);
      } else {
        remaining++;
        lines.push(`<<<<<<< ${model.labels.ours}`);
        lines.push(...range.ours);
        lines.push("=======");
        lines.push(...range.theirs);
        lines.push(`>>>>>>> ${model.labels.theirs}`);
      }
    } else {
      lines.push(...chosenLines(range, eq));
    }
    b = range.baseEnd;
  }
  for (let i = b; i < model.baseLines.length; i++) lines.push(model.baseLines[i]!);
  return {
    text: lines.join("\n") + (model.trailingNewline && lines.length > 0 ? "\n" : ""),
    remaining,
  };
}

export function hasConflictMarkers(text: string): boolean {
  for (const line of text.split("\n")) {
    if (line.startsWith("<<<<<<<") || line.startsWith(">>>>>>>")) return true;
  }
  return false;
}
