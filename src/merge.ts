/**
 * Three-way line merge, the model the conflict view draws: every range says
 * which side changed what, and the result is built from those ranges rather
 * than from the markers Git happened to write.
 */

import type { ConflictContent } from "./mygo";
import { myersOps, type DiffOp } from "./myers";
import { tryResolveText } from "./wordmerge";

export interface DiffHunk {
  baseStart: number;
  baseEnd: number;
  sideStart: number;
  sideEnd: number;
}

export type MergeKind = "inserted" | "deleted" | "modified" | "conflict";

/** The band a range wears. IDEA colours a change by what happened to the text,
 *  never by the pane that holds it: the two sides of a conflict carry one
 *  colour, and the result carries it too. `resolved` drops the band. */
export type MergeTone = MergeKind | "resolved";

/** A range's band while it waits for a decision, and `resolved` once one is in. */
export function rangeTone(range: Pick<MergeRange, "kind"> | undefined, resolved: boolean): MergeTone {
  if (resolved) return "resolved";
  return range ? range.kind : "conflict";
}

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
  /** The result the view starts from: the merge base everywhere, the way the
   *  IDE opens a merge, and only a decision replaces a range. */
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

const exact: LineEq = (a, b) => a === b;

/** splitLines keeps the caller's trailing-newline fact out of the lines. */
export function splitLines(text: string): { lines: string[]; trailingNewline: boolean } {
  if (text === "") return { lines: [], trailingNewline: false };
  const lines = text.split("\n");
  const trailingNewline = lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline };
}

const diffOps = myersOps;

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
  const push = (start: number, end: number, as: DiffHunk[], bs: DiffHunk[]) => {
    const base = baseLines.slice(start, end);
    const oursStart = as.length > 0 && as[0]!.baseStart === start ? as[0]!.sideStart : oursBoundary.after[start]!;
    const oursEnd = as.length > 0 && as[as.length - 1]!.baseEnd === end ? as[as.length - 1]!.sideEnd : oursBoundary.before[end]!;
    const theirsStart = bs.length > 0 && bs[0]!.baseStart === start ? bs[0]!.sideStart : theirsBoundary.after[start]!;
    const theirsEnd = bs.length > 0 && bs[bs.length - 1]!.baseEnd === end ? bs[bs.length - 1]!.sideEnd : theirsBoundary.before[end]!;
    const ours = oursLines.slice(oursStart, oursEnd);
    const theirs = theirsLines.slice(theirsStart, theirsEnd);
    const oursEqBase = textEqual(ours, base, eq);
    const theirsEqBase = textEqual(theirs, base, eq);
    const sameSides = textEqual(ours, theirs, eq);
    // The kind is IDEA's MergeRangeUtil.getMergeType, and with it come the two
    // "this side changed the range" flags: they are not simply "a hunk exists",
    // because a hunk can sit on the boundary and contribute nothing.
    let kind: MergeKind;
    let oursChanged: boolean;
    let theirsChanged: boolean;
    if (base.length === 0) {
      if (ours.length === 0) {
        kind = "inserted";
        oursChanged = false;
        theirsChanged = true;
      } else if (theirs.length === 0) {
        kind = "inserted";
        oursChanged = true;
        theirsChanged = false;
      } else if (sameSides) {
        kind = "inserted";
        oursChanged = true;
        theirsChanged = true;
      } else {
        kind = "conflict";
        oursChanged = true;
        theirsChanged = true;
      }
    } else if (ours.length === 0 && theirs.length === 0) {
      kind = "deleted";
      oursChanged = true;
      theirsChanged = true;
    } else if (oursEqBase && theirsEqBase) {
      // Equal under the current policy but not identical: a whitespace-only
      // change still belongs to the side that wrote it.
      kind = "modified";
      oursChanged = !textEqual(ours, base, exact);
      theirsChanged = !textEqual(theirs, base, exact);
    } else if (oursEqBase) {
      kind = theirs.length === 0 ? "deleted" : "modified";
      oursChanged = false;
      theirsChanged = true;
    } else if (theirsEqBase) {
      kind = ours.length === 0 ? "deleted" : "modified";
      oursChanged = true;
      theirsChanged = false;
    } else if (sameSides) {
      kind = "modified";
      oursChanged = true;
      theirsChanged = true;
    } else {
      kind = "conflict";
      oursChanged = true;
      theirsChanged = true;
    }
    ranges.push({
      index: ranges.length,
      kind,
      baseStart: start,
      baseEnd: end,
      oursStart,
      oursEnd,
      theirsStart,
      theirsEnd,
      oursChanged,
      theirsChanged,
      base,
      ours,
      theirs,
    });
  };

  // A range is the gap between two stretches that are unchanged in *both*
  // versions. So changes that touch — no line left unchanged on both sides
  // between them — are one range, and adjacent edits conflict even when they
  // sit on different lines. The IDE merges them exactly this way.
  const hunks = [
    ...oursHunks.map((hunk) => ({ hunk, ours: true })),
    ...theirsHunks.map((hunk) => ({ hunk, ours: false })),
  ].sort(
    (a, b) =>
      a.hunk.baseStart - b.hunk.baseStart ||
      a.hunk.baseEnd - b.hunk.baseEnd ||
      (a.ours === b.ours ? 0 : a.ours ? -1 : 1),
  );

  let i = 0;
  while (i < hunks.length) {
    const start = hunks[i]!.hunk.baseStart;
    let end = hunks[i]!.hunk.baseEnd;
    const as: DiffHunk[] = [];
    const bs: DiffHunk[] = [];
    while (i < hunks.length && hunks[i]!.hunk.baseStart <= end) {
      const item = hunks[i]!;
      (item.ours ? as : bs).push(item.hunk);
      end = Math.max(end, item.hunk.baseEnd);
      i++;
    }
    push(start, end, as, bs);
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
 * The IDE's "resolve simple conflict": IDEA merges the range's three texts at
 * word level (`MergeResolveUtil.tryResolve`), which resolves far more than
 * per-line attribution does — one side may rewrite a line's first word while
 * the other rewrites its last. A non-conflict range still takes the side that
 * changed it.
 */
export function tryResolveRange(range: MergeRange, ignoreWhitespace = false): string[] | null {
  if (range.kind !== "conflict") return chosenLines(range, ignoreWhitespace ? whitespaceInsensitive : exact);
  const merged = tryResolveText(range.ours.join("\n"), range.base.join("\n"), range.theirs.join("\n"));
  return merged === null ? null : merged.split("\n");
}

/** Character offsets of the composed result's line starts. */
function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
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
  /** One block per model range, in order; every one starts undecided. */
  blocks: MergeBlock[];
}

/**
 * buildMergeView turns the three-way model into the result pane's blocks. The
 * result starts as the merge base, the way the IDE opens a merge: every change
 * is a block that still needs a decision, a conflict and a one-sided change
 * alike, and nothing is applied until the reader asks for it.
 */
export function buildMergeView(model: MergeModel): MergeView {
  const lines: string[] = [];
  const spans: { index: number; from: number; to: number }[] = [];
  let b = 0;
  for (const range of model.ranges) {
    for (let i = b; i < range.baseStart; i++) lines.push(model.baseLines[i]!);
    const from = lines.length;
    lines.push(...range.base);
    spans.push({ index: range.index, from, to: lines.length });
    b = range.baseEnd;
  }
  for (let i = b; i < model.baseLines.length; i++) lines.push(model.baseLines[i]!);

  const text = lines.join("\n") + (model.trailingNewline && lines.length > 0 ? "\n" : "");
  const starts = lineStartsOf(text);
  const blocks: MergeBlock[] = spans.map((span) => ({
    index: span.index,
    lines: lines.slice(span.from, span.to),
    resolved: false,
    from: starts[span.from] ?? text.length,
    to: starts[span.to] ?? text.length,
  }));
  return { text, blocks };
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
    // An undecided range keeps the merge base, whatever its kind: the IDE
    // starts every merge from the base and applies sides on request.
    lines.push(...(resolutions.get(range.index)?.lines ?? range.base));
    b = range.baseEnd;
  }
  for (let i = b; i < model.baseLines.length; i++) lines.push(model.baseLines[i]!);
  return lines.join("\n") + (model.trailingNewline && lines.length > 0 ? "\n" : "");
}

/** computeMerge is the whole model: diff both sides against the base, join the
 *  changes that share a range into conflicts, and render the initial result,
 *  which is the merge base until a range is decided. */
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
      const resolved = tryResolveRange(range, ignoreWhitespace);
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

/**
 * Whether a conflict can be merged as text. A binary file, a symbolic link, a
 * submodule, and a path one side added or deleted have no three-way text to
 * edit: writing the result pane would create a file git never recorded (a link
 * would be written through, to its target). Those conflicts offer the two
 * sides and nothing else.
 */
export function needsSideChoice(
  conflict: Pick<ConflictContent, "binary" | "kind" | "hasOurs" | "hasTheirs">,
): boolean {
  return conflict.binary || conflict.kind !== "file" || !conflict.hasOurs || !conflict.hasTheirs;
}
