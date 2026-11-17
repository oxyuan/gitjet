/**
 * Three-way line merge, the model the conflict view draws: every range says
 * which side changed what, and the result is built from those ranges rather
 * than from the markers Git happened to write.
 */

import type { ConflictContent } from "./mygo";
import { lineDiffOps, type DiffOp, type LineKey } from "./myers";
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

/** Whether a range can be put back to the base text. A conflict half-way
 *  through — one side taken, the other still pending — has already changed the
 *  result, so it is revertable too: that is IDEA's "reset resolved change",
 *  and it is how one conflict is cancelled before the block is decided. */
export function canRevertRange(
  range: Pick<MergeRange, "kind"> | undefined,
  state: { left: boolean; right: boolean } | undefined,
): boolean {
  return range !== undefined && state !== undefined && (state.left || state.right);
}

/** A decided range in the result pane is banded by what the result now holds
 *  against the base, the way the IDE's line status tracker paints it. Equal
 *  text drops the band; a range that changed nothing on one side is still an
 *  insertion or a deletion, and a replacement is a modification. */
export function resultTone(base: string[], lines: string[]): MergeTone {
  if (base.length === lines.length && base.every((line, i) => line === lines[i])) {
    return "resolved";
  }
  if (base.length === 0) return "inserted";
  if (lines.length === 0) return "deleted";
  return "modified";
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

const identical: LineKey = (line) => line;
// IDEA's whitespace is space, tab and line feed (`TrimUtil.isSpaceEnterOrTab`),
// never a carriage return: a CRLF file's `\r` is content, so an ignored
// difference here must not swallow it.
const ignoreSpaces: LineKey = (line) => line.replace(/[ \t]+/g, "");
const trimSpaces: LineKey = (line) => line.replace(/^[ \t]+|[ \t]+$/g, "");

/** The key matching the ignore-differences mode, so the diff engine sees the
 *  same line equality the view does. */
function lineKey(mode: WhitespaceMode): LineKey {
  if (mode === "spaces") return ignoreSpaces;
  if (mode === "trim") return trimSpaces;
  return identical;
}

/** diffHunks collapses adjacent insert/delete operations into one changed
 *  region, which is the unit the merge view navigates. */
export function diffHunks(a: string[], b: string[], ignoreWhitespace = false): DiffHunk[] {
  const ops = lineDiffOps(a, b, ignoreWhitespace ? ignoreSpaces : identical);
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

function whitespaceInsensitive(a: string, b: string): boolean {
  return ignoreSpaces(a) === ignoreSpaces(b);
}

/** whitespaceEq is the line comparison the "Ignore differences" menu picks. */
export function whitespaceEq(mode: WhitespaceMode): LineEq {
  if (mode === "spaces") return whitespaceInsensitive;
  if (mode === "trim") return (a, b) => trimSpaces(a) === trimSpaces(b);
  return exact;
}

function textEqual(a: string[], b: string[], eq: LineEq): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i]!, b[i]!)) return false;
  return true;
}

/** The stretches one side's diff left untouched, in base and side coordinates. */
function unchangedRuns(ops: DiffOp[]): { baseStart: number; baseEnd: number; sideStart: number; sideEnd: number }[] {
  const runs: { baseStart: number; baseEnd: number; sideStart: number; sideEnd: number }[] = [];
  for (const op of ops) {
    if (op.kind === "equal" && op.aEnd > op.aStart) {
      runs.push({ baseStart: op.aStart, baseEnd: op.aEnd, sideStart: op.bStart, sideEnd: op.bEnd });
    }
  }
  return runs;
}

interface RawRange {
  baseStart: number;
  baseEnd: number;
  oursStart: number;
  oursEnd: number;
  theirsStart: number;
  theirsEnd: number;
}

/**
 * IDEA's `ComparisonMergeUtil.buildMerge`: the two sides' unchanged stretches
 * are walked together, and their overlap marks a stretch unchanged on *both*
 * sides, so a range is exactly the gap between two such stretches. Changes
 * that touch therefore share a range — adjacent edits conflict even when they
 * sit on different lines — and a hunk that only touches a range's boundary
 * contributes nothing to it.
 *
 * `trueEq` is IDEA's `equalsDefaultPolicy`. With "Ignore differences" on, an
 * aligned stretch whose lines are equal under the policy but not exactly is
 * still split out as its own change (`IgnoringChangeBuilder`), so the menu
 * hides the marks without hiding the text; without it, saving such a merge
 * dropped both sides' whitespace edits.
 */
function buildRanges(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  oursOps: DiffOp[],
  theirsOps: DiffOp[],
  trueEq: LineEq,
): RawRange[] {
  const oursRuns = unchangedRuns(oursOps);
  const theirsRuns = unchangedRuns(theirsOps);
  const ranges: RawRange[] = [];
  let lastBase = 0;
  let lastOurs = 0;
  let lastTheirs = 0;
  // Where the last recorded change ended: the start of the equal run being
  // checked for ignored differences.
  let changeBase = 0;
  let changeOurs = 0;
  let changeTheirs = 0;

  const record = (
    baseStart: number,
    baseEnd: number,
    oursStart: number,
    oursEnd: number,
    theirsStart: number,
    theirsEnd: number,
  ) => {
    if (baseStart === baseEnd && oursStart === oursEnd && theirsStart === theirsEnd) return;
    ranges.push({ baseStart, baseEnd, oursStart, oursEnd, theirsStart, theirsEnd });
    changeBase = baseEnd;
    changeOurs = oursEnd;
    changeTheirs = theirsEnd;
  };

  /** IDEA's `IgnoringChangeBuilder.addIgnoredChanges`: an equal run is split
   *  where a line is equal under the policy but not exactly, so an ignored
   *  difference is still a change the reader can take or leave. */
  const addIgnored = (
    baseStart: number,
    baseEnd: number,
    oursStart: number,
    oursEnd: number,
    theirsStart: number,
    theirsEnd: number,
  ) => {
    const count = baseEnd - baseStart;
    let first = -1;
    for (let i = 0; i < count; i++) {
      const ignored =
        !trueEq(baseLines[baseStart + i]!, oursLines[oursStart + i]!) ||
        !trueEq(baseLines[baseStart + i]!, theirsLines[theirsStart + i]!);
      if (ignored && first < 0) first = i;
      if (!ignored && first >= 0) {
        record(
          baseStart + first,
          baseStart + i,
          oursStart + first,
          oursStart + i,
          theirsStart + first,
          theirsStart + i,
        );
        first = -1;
      }
    }
    if (first >= 0) record(baseStart + first, baseEnd, oursStart + first, oursEnd, theirsStart + first, theirsEnd);
  };

  /** IDEA's `ChangeBuilder.processChange`: the stretch since the last equal run
   *  is a change; before it is recorded, the equal run before it is checked for
   *  differences the policy ignores. */
  const flushChange = (baseEnd: number, oursEnd: number, theirsEnd: number) => {
    addIgnored(changeBase, lastBase, changeOurs, lastOurs, changeTheirs, lastTheirs);
    record(lastBase, baseEnd, lastOurs, oursEnd, lastTheirs, theirsEnd);
  };

  const markEqual = (
    baseStart: number,
    baseEnd: number,
    oursStart: number,
    oursEnd: number,
    theirsStart: number,
    theirsEnd: number,
  ) => {
    flushChange(baseStart, oursStart, theirsStart);
    lastBase = baseEnd;
    lastOurs = oursEnd;
    lastTheirs = theirsEnd;
  };

  let i = 0;
  let j = 0;
  while (i < oursRuns.length && j < theirsRuns.length) {
    const ours = oursRuns[i]!;
    const theirs = theirsRuns[j]!;
    let advanceOurs: boolean;
    if (ours.baseEnd <= theirs.baseStart) {
      advanceOurs = true;
    } else if (theirs.baseEnd <= ours.baseStart) {
      advanceOurs = false;
    } else {
      const start = Math.max(ours.baseStart, theirs.baseStart);
      const end = Math.min(ours.baseEnd, theirs.baseEnd);
      const count = end - start;
      const oursStart = ours.sideStart + (start - ours.baseStart);
      const theirsStart = theirs.sideStart + (start - theirs.baseStart);
      markEqual(start, end, oursStart, oursStart + count, theirsStart, theirsStart + count);
      advanceOurs = ours.baseEnd <= theirs.baseEnd;
    }
    if (advanceOurs) i++;
    else j++;
  }
  flushChange(baseLines.length, oursLines.length, theirsLines.length);
  return ranges;
}

/** IDEA's `MergeRangeUtil.getMergeType`, and with it the two "this side changed
 *  the range" flags: they are not simply "a hunk exists", because a hunk can
 *  sit on the boundary and contribute nothing. */
function classifyRange(
  baseLines: string[],
  oursLines: string[],
  theirsLines: string[],
  raw: RawRange,
  index: number,
  eq: LineEq,
): MergeRange {
  const base = baseLines.slice(raw.baseStart, raw.baseEnd);
  const ours = oursLines.slice(raw.oursStart, raw.oursEnd);
  const theirs = theirsLines.slice(raw.theirsStart, raw.theirsEnd);
  const oursEqBase = textEqual(ours, base, eq);
  const theirsEqBase = textEqual(theirs, base, eq);
  const sameSides = textEqual(ours, theirs, eq);
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
  return {
    index,
    kind,
    ...raw,
    oursChanged,
    theirsChanged,
    base,
    ours,
    theirs,
  };
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

/** The ranges "Resolve Automatically" settles without asking, IDEA's
 *  `MergeConflictModel.getAutoResolvableChanges`: a non-conflict range is
 *  resolved by taking the side that changed it, and a conflict by the
 *  word-level text merge when that can merge it. A range with any side
 *  already decided is left alone — its text is in the result, and appending
 *  to it would be a different merge. */
export function autoResolvableRanges(
  model: Pick<MergeModel, "ranges">,
  states: ReadonlyMap<number, { lines: string[]; left: boolean; right: boolean; oneside: boolean }>,
  ignoreWhitespace = false,
): { index: number; lines: string[] }[] {
  const out: { index: number; lines: string[] }[] = [];
  for (const range of model.ranges) {
    const state = states.get(range.index);
    if (!state || state.left || state.right) continue;
    const lines = tryResolveRange(range, ignoreWhitespace);
    if (lines) out.push({ index: range.index, lines });
  }
  return out;
}

/** One range's decision, as the merge view keeps it: the lines the result
 *  shows for the range, and which sides have been settled. */
export interface RangeDecision {
  lines: string[];
  left: boolean;
  right: boolean;
  /** One side of a conflict is in the result and the other still is not. */
  oneside: boolean;
}

/** Taking one side of a range, the way IDEA's `MergeConflictModel.replaceChange`
 *  does: a side that changed nothing decides the range without moving text, and
 *  a half-decided conflict appends the second side instead of replacing the
 *  first. `resolve` is IDEA's "resolve the whole change": a conflict is decided
 *  at once rather than left half-open. Null means there is nothing left to do. */
export function applySide(
  range: MergeRange,
  state: RangeDecision,
  side: "ours" | "theirs",
  resolve = false,
): RangeDecision | null {
  if (side === "ours" ? state.left : state.right) return null;
  if (side === "ours" ? !range.oursChanged : !range.theirsChanged) {
    return { ...state, left: true, right: true, oneside: false };
  }
  const lines = side === "ours" ? range.ours : range.theirs;
  const otherHasText = (side === "ours" ? range.theirs : range.ours).length > 0;
  if (range.kind === "conflict" && !resolve && otherHasText) {
    const left = side === "ours" || state.left;
    const right = side === "theirs" || state.right;
    return {
      lines: state.oneside ? [...state.lines, ...lines] : lines,
      left,
      right,
      oneside: !(left && right),
    };
  }
  return { lines, left: true, right: true, oneside: false };
}

/** Ignoring one side records the decision without moving any text, so the
 *  result keeps whatever it already holds for the range. */
export function ignoreSide(
  range: MergeRange,
  state: RangeDecision,
  side: "ours" | "theirs",
  resolve = false,
): RangeDecision | null {
  if (side === "ours" ? state.left : state.right) return null;
  if (range.kind === "conflict" && !resolve) {
    return {
      ...state,
      left: side === "ours" || state.left,
      right: side === "theirs" || state.right,
    };
  }
  return { ...state, left: true, right: true, oneside: false };
}

/** Reverting puts the range back to the merge base, undecided — IDEA's
 *  `resetResolvedChange`, and how one conflict is cancelled without undoing
 *  the others. */
export function resetDecision(range: MergeRange, state: RangeDecision): RangeDecision | null {
  if (!state.left && !state.right) return null;
  return { lines: range.base, left: false, right: false, oneside: false };
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
  const key = lineKey(mode);
  const oursOps = lineDiffOps(base.lines, ours.lines, key);
  const theirsOps = lineDiffOps(base.lines, theirs.lines, key);
  const ranges = buildRanges(base.lines, ours.lines, theirs.lines, oursOps, theirsOps, exact).map(
    (raw, index) => classifyRange(base.lines, ours.lines, theirs.lines, raw, index, eq),
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
