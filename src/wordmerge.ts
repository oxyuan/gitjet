/**
 * The IDE's "resolve simple conflict" text merge: a word-level three-way merge
 * of one conflict's three texts, ported from `MergeResolveUtil.tryResolve`.
 *
 * IDEA splits each text into words and newlines (spaces and punctuation are
 * not chunks at all), diffs both sides against the base chunk by chunk, and
 * walks the resulting three-way changes: a stretch neither side touched keeps
 * the base text, a stretch one side changed takes that side, and a stretch
 * both sides changed differently fails the whole merge. Two passes run, one
 * whitespace-sensitive and one ignoring whitespace; the first success wins.
 *
 * The word diff is fine-grained on purpose: it resolves conflicts the line
 * merge cannot, e.g. one side editing the first word of a line while the other
 * edits the last.
 */

import type { IdeaBlock } from "./ideaDiff";
import { DiffTooBigError, elementIds, ideaBlocks } from "./ideaDiff";

type Policy = "default" | "ignoreWhitespace";

/** A chunk of a text: a word, or a single newline (ByWordRt.InlineChunk). */
interface Chunk {
  start: number;
  end: number;
  /** Equality key: the word itself, or "\n" for a newline chunk. */
  key: string;
}

/** An equal stretch of a two-way diff (both sides use the same offsets). */
interface EqualRange {
  s1: number;
  e1: number;
  s2: number;
  e2: number;
}

/** An equal stretch of a three-way diff: left, base and right offsets. */
interface MergeRange3 {
  s1: number;
  e1: number;
  s2: number;
  e2: number;
  s3: number;
  e3: number;
}

/** MergeConflictType reduced to what the resolver reads. */
interface MergeType {
  left: boolean;
  right: boolean;
  conflict: boolean;
}

// ---------------------------------------------------------------- primitive

function isSpaceEnterTab(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t";
}

/** TrimUtil.isPunctuation: ASCII punctuation, but `_` is a word character. */
function isPunctuation(cp: number): boolean {
  if (cp === 95) return false;
  return (
    (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)
  );
}

const alphabetic = /^\p{Alphabetic}$/u;
const ideographic = /^\p{Script=Han}$/u;
const continuousScript = /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Javanese}]$/u;
const decimalDigit = /^\p{Nd}$/u;

/** TrimUtil.isContinuousScript: scripts written without spaces between words,
 *  and anything outside the BMP, become one chunk per character. */
function isContinuousScript(cp: number): boolean {
  if (cp < 128) return false;
  if (cp > 0xffff) return true;
  const ch = String.fromCodePoint(cp);
  if (decimalDigit.test(ch)) return false;
  if (ideographic.test(ch)) return true;
  if (!alphabetic.test(ch)) return true;
  return continuousScript.test(ch);
}

/** ByWordRt.getInlineChunks: words and newlines only. */
function chunks(text: string): Chunk[] {
  const out: Chunk[] = [];
  let wordStart = -1;
  for (let offset = 0; offset < text.length; ) {
    const cp = text.codePointAt(offset)!;
    const charCount = cp > 0xffff ? 2 : 1;
    const ch = String.fromCodePoint(cp);
    const alpha = cp < 128 ? !isSpaceEnterTab(ch) && !isPunctuation(cp) : !isPunctuation(cp);
    if (alpha && !isContinuousScript(cp)) {
      if (wordStart < 0) wordStart = offset;
    } else {
      if (wordStart >= 0) {
        out.push({ start: wordStart, end: offset, key: text.slice(wordStart, offset) });
        wordStart = -1;
      }
      if (alpha) {
        out.push({ start: offset, end: offset + charCount, key: ch });
      } else if (cp === 10) {
        out.push({ start: offset, end: offset + 1, key: "\n" });
      }
    }
    offset += charCount;
  }
  if (wordStart >= 0) out.push({ start: wordStart, end: text.length, key: text.slice(wordStart) });
  return out;
}

// ------------------------------------------------------------- diff plumbing

function sameText(a: string, b: string): boolean {
  return a === b;
}

/** The equal stretches of a two-way diff, which is what IDEA iterates. */
function equalRanges(length1: number, length2: number, blocks: readonly IdeaBlock[]): EqualRange[] {
  const out: EqualRange[] = [];
  let s1 = 0;
  let s2 = 0;
  for (const block of blocks) {
    if (block.aStart > s1 || block.bStart > s2) {
      out.push({ s1, e1: block.aStart, s2, e2: block.bStart });
    }
    s1 = block.aEnd;
    s2 = block.bEnd;
  }
  if (s1 < length1 || s2 < length2) out.push({ s1, e1: length1, s2, e2: length2 });
  return out;
}

/** Chunk indices of the equal stretches between two texts. */
function chunkEqual(base: Chunk[], side: Chunk[]): EqualRange[] {
  const pool = new Map<string, number>();
  const blocks = ideaBlocks(elementIds(base.map((c) => c.key), pool), elementIds(side.map((c) => c.key), pool));
  return equalRanges(base.length, side.length, blocks);
}

function expandForwardKeys(a: Chunk[], b: Chunk[], s1: number, s2: number, e1: number, e2: number): number {
  let n = 0;
  while (s1 + n < e1 && s2 + n < e2 && a[s1 + n]!.key === b[s2 + n]!.key) n++;
  return n;
}

function expandBackwardKeys(a: Chunk[], b: Chunk[], s1: number, s2: number, e1: number, e2: number): number {
  let n = 0;
  while (s1 < e1 - n && s2 < e2 - n && a[e1 - 1 - n]!.key === b[e2 - 1 - n]!.key) n++;
  return n;
}

/** ChunkOptimizer.WordChunkOptimizer: moves the boundary between two adjacent
 *  equal stretches so that changes split at whitespace, which keeps a word and
 *  the space after it on the same side. */
function optimizeChunks(
  base: Chunk[],
  side: Chunk[],
  baseText: string,
  sideText: string,
  equal: EqualRange[],
): EqualRange[] {
  const ranges: EqualRange[] = [];
  const separated = (text: string, one: Chunk | undefined, two: Chunk | undefined): boolean => {
    if (!one || !two) return true;
    if (one.key === "\n" || two.key === "\n") return true;
    for (let i = one.end; i < two.start; i++) if (isSpaceEnterTab(text[i]!)) return true;
    return false;
  };
  const findEdge = (text: string, words: Chunk[], offset: number, count: number, leftToRight: boolean): number => {
    for (let i = 0; i < count; i++) {
      const one = leftToRight ? words[offset + i] : words[offset - i - 1];
      const two = leftToRight ? words[offset + i + 1] : words[offset - i];
      if (!one || !two) return -1;
      if (separated(text, one, two)) return i + 1;
    }
    return -1;
  };
  const getShift = (touchLeft: boolean, forward: number, backward: number, r1: EqualRange, r2: EqualRange): number => {
    const words = touchLeft ? base : side;
    const text = touchLeft ? baseText : sideText;
    const touchStart = touchLeft ? r2.s1 : r2.s2;
    if (separated(text, words[touchStart - 1], words[touchStart])) return 0;
    const leftShift = findEdge(text, words, touchStart, forward, true);
    if (leftShift > 0) return leftShift;
    const rightShift = findEdge(text, words, touchStart - 1, backward, false);
    return rightShift > 0 ? -rightShift : 0;
  };
  const processLast = () => {
    if (ranges.length < 2) return;
    const r1 = ranges[ranges.length - 2]!;
    const r2 = ranges[ranges.length - 1]!;
    if (r1.e1 !== r2.s1 && r1.e2 !== r2.s2) return;
    const count1 = r1.e1 - r1.s1;
    const count2 = r2.e1 - r2.s1;
    const forward = expandForwardKeys(base, side, r1.e1, r1.e2, r1.e1 + count2, r1.e2 + count2);
    const backward = expandBackwardKeys(base, side, r2.s1 - count1, r2.s2 - count1, r2.s1, r2.s2);
    if (forward === 0 && backward === 0) return;
    if (forward === count2) {
      ranges.pop();
      ranges.pop();
      ranges.push({ s1: r1.s1, e1: r1.e1 + count2, s2: r1.s2, e2: r1.e2 + count2 });
      processLast();
      return;
    }
    if (backward === count1) {
      ranges.pop();
      ranges.pop();
      ranges.push({ s1: r2.s1 - count1, e1: r2.e1, s2: r2.s2 - count1, e2: r2.e2 });
      processLast();
      return;
    }
    const shift = getShift(r1.e1 === r2.s1, forward, backward, r1, r2);
    if (shift === 0) return;
    ranges.pop();
    ranges.pop();
    ranges.push({ s1: r1.s1, e1: r1.e1 + shift, s2: r1.s2, e2: r1.e2 + shift });
    ranges.push({ s1: r2.s1 + shift, e1: r2.e1, s2: r2.s2 + shift, e2: r2.e2 });
  };
  for (const range of equal) {
    ranges.push({ ...range });
    processLast();
  }
  return ranges;
}

// ------------------------------------------------------------- punctuation

function punctuationOffsets(text: string): { chars: string[]; offsets: number[] } {
  const chars: string[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (isPunctuation(text.charCodeAt(i))) {
      chars.push(text[i]!);
      offsets.push(i);
    }
  }
  return { chars, offsets };
}

/** The punctuation marked equal between two texts, as char ranges. */
function comparePunctuation(text1: string, text2: string): EqualRange[] {
  const chars1 = punctuationOffsets(text1);
  const chars2 = punctuationOffsets(text2);
  const pool = new Map<string, number>();
  const blocks = ideaBlocks(elementIds(chars1.chars, pool), elementIds(chars2.chars, pool));
  const pairs = equalRanges(chars1.chars.length, chars2.chars.length, blocks);
  const out: EqualRange[] = [];
  for (const pair of pairs) {
    for (let i = 0; i < pair.e1 - pair.s1; i++) {
      const o1 = chars1.offsets[pair.s1 + i]!;
      const o2 = chars2.offsets[pair.s2 + i]!;
      const last = out[out.length - 1];
      if (last && last.e1 === o1 && last.e2 === o2) last.e1 = o1 + 1, (last.e2 = o2 + 1);
      else out.push({ s1: o1, e1: o1 + 1, s2: o2, e2: o2 + 1 });
    }
  }
  return out;
}

/** ByWordRt.splitIterable2Side: one diff against a two-part side text. */
function splitTwoSide(equal: EqualRange[], offset: number): [EqualRange[], EqualRange[]] {
  const ranges1: EqualRange[] = [];
  const ranges2: EqualRange[] = [];
  for (const range of equal) {
    if (range.e2 <= offset) {
      ranges1.push({ ...range });
    } else if (range.s2 >= offset) {
      ranges2.push({ s1: range.s1, e1: range.e1, s2: range.s2 - offset, e2: range.e2 - offset });
    } else {
      const len = offset - range.s2;
      ranges1.push({ s1: range.s1, e1: range.s1 + len, s2: range.s2, e2: offset });
      ranges2.push({ s1: range.s1 + len, e1: range.e1, s2: 0, e2: range.e2 - offset });
    }
  }
  return [ranges1, ranges2];
}

/** ByWordRt.comparePunctuation2Side: both sides against a merged side text. */
function comparePunctuationTwoSide(
  text1: string,
  sideA: string,
  sideB: string,
): [EqualRange[], EqualRange[]] {
  return splitTwoSide(comparePunctuation(text1, sideA + sideB), sideA.length);
}

/**
 * ByWordRt.AdjustmentPunctuationMatcher: turns the chunk diff into a char diff,
 * marking equal chunks whole and comparing the punctuation inside the changed
 * stretches, so a change starts at the word and not at the bracket before it.
 */
function punctuate(
  text1: string,
  chunks1: Chunk[],
  text2: string,
  chunks2: Chunk[],
  equal: EqualRange[],
): EqualRange[] {
  const marks: EqualRange[] = [];
  const mark = (s1: number, e1: number, s2: number, e2: number) => {
    if (s1 !== e1 || s2 !== e2) marks.push({ s1, e1, s2, e2 });
  };
  const startOffset1 = (i: number) => (i < chunks1.length ? chunks1[i]!.start : text1.length);
  const startOffset2 = (i: number) => (i < chunks2.length ? chunks2[i]!.start : text2.length);
  const endOffset1 = (i: number) => chunks1[i]!.end;
  const endOffset2 = (i: number) => chunks2[i]!.end;

  let last: EqualRange | null = null;
  const matchRange = (s1: number, s2: number, e1: number, e2: number) => {
    for (const range of comparePunctuation(text1.slice(s1, e1), text2.slice(s2, e2))) {
      mark(s1 + range.s1, s1 + range.e1, s2 + range.s2, s2 + range.e2);
    }
  };
  const matchComplexLeft = (
    s1: number,
    e1: number,
    s12: number,
    e12: number,
    s22: number,
    e22: number,
  ) => {
    const [first, second] = comparePunctuationTwoSide(
      text1.slice(s1, e1),
      text2.slice(s12, e12),
      text2.slice(s22, e22),
    );
    for (const range of first) mark(s1 + range.s1, s1 + range.e1, s12 + range.s2, s12 + range.e2);
    for (const range of second) mark(s1 + range.s1, s1 + range.e1, s22 + range.s2, s22 + range.e2);
  };
  const matchComplexRight = (
    s2: number,
    e2: number,
    s11: number,
    e11: number,
    s21: number,
    e21: number,
  ) => {
    const [first, second] = comparePunctuationTwoSide(
      text2.slice(s2, e2),
      text1.slice(s11, e11),
      text1.slice(s21, e21),
    );
    for (const range of first) mark(s11 + range.s2, s11 + range.e2, s2 + range.s1, s2 + range.e1);
    for (const range of second) mark(s21 + range.s2, s21 + range.e2, s2 + range.s1, s2 + range.e1);
  };
  const matchBackward = (s1: number, s2: number, e1: number, e2: number) => {
    const pending = last;
    last = null;
    if (!pending) return;
    if (pending.s1 === s1 && pending.s2 === s2) {
      if (pending.e1 !== e1 || pending.e2 !== e2) return;
      matchRange(s1, s2, e1, e2);
    } else if (pending.s1 < s1 && pending.s2 < s2) {
      if (pending.e1 > s1 || pending.e2 > s2) return;
      matchRange(pending.s1, pending.s2, pending.e1, pending.e2);
      matchRange(s1, s2, e1, e2);
    } else if (pending.s1 === s1 && pending.e1 === e1) {
      matchComplexLeft(pending.s1, pending.e1, pending.s2, pending.e2, s2, e2);
    } else if (pending.s2 === s2 && pending.e2 === e2) {
      matchComplexRight(pending.s2, pending.e2, pending.s1, pending.e1, s1, e1);
    }
  };
  const matchForward = (s1: number, s2: number, e1: number, e2: number) => {
    last = { s1, e1, s2, e2 };
  };

  const forward = (index1: number, index2: number) => {
    matchForward(
      index1 < 0 ? 0 : endOffset1(index1),
      index2 < 0 ? 0 : endOffset2(index2),
      index1 + 1 >= chunks1.length ? text1.length : startOffset1(index1 + 1),
      index2 + 1 >= chunks2.length ? text2.length : startOffset2(index2 + 1),
    );
  };
  const backward = (index1: number, index2: number) => {
    matchBackward(
      index1 === 0 ? 0 : endOffset1(index1 - 1),
      index2 === 0 ? 0 : endOffset2(index2 - 1),
      index1 >= chunks1.length ? text1.length : startOffset1(index1),
      index2 >= chunks2.length ? text2.length : startOffset2(index2),
    );
  };

  forward(-1, -1);
  for (const range of equal) {
    const count = range.e1 - range.s1;
    for (let i = 0; i < count; i++) {
      const index1 = range.s1 + i;
      const index2 = range.s2 + i;
      const start1 = startOffset1(index1);
      const start2 = startOffset2(index2);
      const end1 = endOffset1(index1);
      const end2 = endOffset2(index2);
      backward(index1, index2);
      mark(start1, end1, start2, end2);
      forward(index1, index2);
    }
  }
  backward(chunks1.length, chunks2.length);

  // IDEA's builder requires monotonically increasing marks; the side-against-
  // side branch can emit them out of order, so order them and keep the
  // non-overlapping ones.
  marks.sort((a, b) => a.s1 - b.s1 || a.s2 - b.s2 || a.e1 - b.e1);
  const merged: EqualRange[] = [];
  for (const range of marks) {
    const prev = merged[merged.length - 1];
    if (prev && prev.e1 === range.s1 && prev.e2 === range.s2) {
      prev.e1 = range.e1;
      prev.e2 = range.e2;
    } else if (!prev || (range.s1 >= prev.e1 && range.s2 >= prev.e2)) {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** The char-level equal stretches of one side against the base. */
function sideEqual(
  baseText: string,
  sideText: string,
  baseChunks: Chunk[],
  sideChunks: Chunk[],
): EqualRange[] {
  const optimized = optimizeChunks(baseChunks, sideChunks, baseText, sideText, chunkEqual(baseChunks, sideChunks));
  // The matcher takes chunk indices and turns them into character offsets.
  return punctuate(baseText, baseChunks, sideText, sideChunks, optimized);
}

// --------------------------------------------------------------- merge walk

/** ComparisonMergeUtil.FairMergeBuilder: the changed stretches of a three-way
 *  diff, in left/base/right char offsets. */
function mergeChanges(
  baseLeft: EqualRange[],
  baseRight: EqualRange[],
  lengths: [number, number, number],
): MergeRange3[] {
  const changes: MergeRange3[] = [];
  let i1 = 0;
  let i2 = 0;
  let i3 = 0;
  const addChange = (s1: number, s2: number, s3: number, e1: number, e2: number, e3: number) => {
    if (s1 !== e1 || s2 !== e2 || s3 !== e3) changes.push({ s1, e1, s2, e2, s3, e3 });
  };
  const markEqual = (s1: number, s2: number, s3: number, e1: number, e2: number, e3: number) => {
    if (i1 !== s1 || i2 !== s2 || i3 !== s3) addChange(i1, i2, i3, s1, s2, s3);
    i1 = e1;
    i2 = e2;
    i3 = e3;
  };
  /** Adds one side's equal stretch; returns the side that ran out first. */
  const add = (one: EqualRange, two: EqualRange): "left" | "right" => {
    if (one.e1 <= two.s1) return "left";
    if (two.e1 <= one.s1) return "right";
    const startBase = Math.max(one.s1, two.s1);
    const endBase = Math.min(one.e1, two.e1);
    const count = endBase - startBase;
    const startLeft = one.s2 + (startBase - one.s1);
    const startRight = two.s2 + (startBase - two.s1);
    markEqual(startLeft, startBase, startRight, startLeft + count, startBase + count, startRight + count);
    return one.e1 <= two.e1 ? "left" : "right";
  };

  let a = 0;
  let b = 0;
  while (a < baseLeft.length && b < baseRight.length) {
    if (add(baseLeft[a]!, baseRight[b]!) === "left") a++;
    else b++;
  }
  addChange(i1, i2, i3, lengths[0], lengths[1], lengths[2]);
  return changes;
}

// --------------------------------------------------------------- correctors

function expandWhitespaces(
  text1: string,
  text2: string,
  text3: string,
  range: MergeRange3,
): MergeRange3 {
  let start = 0;
  while (
    range.s1 + start < range.e1 &&
    range.s2 + start < range.e2 &&
    range.s3 + start < range.e3 &&
    text1[range.s1 + start] === text2[range.s2 + start] &&
    text1[range.s1 + start] === text3[range.s3 + start] &&
    isSpaceEnterTab(text1[range.s1 + start]!)
  ) {
    start++;
  }
  let end = 0;
  while (
    range.s1 + start < range.e1 - end &&
    range.s2 + start < range.e2 - end &&
    range.s3 + start < range.e3 - end &&
    text1[range.e1 - end - 1] === text2[range.e2 - end - 1] &&
    text1[range.e1 - end - 1] === text3[range.e3 - end - 1] &&
    isSpaceEnterTab(text1[range.e1 - end - 1]!)
  ) {
    end++;
  }
  return {
    s1: range.s1 + start,
    e1: range.e1 - end,
    s2: range.s2 + start,
    e2: range.e2 - end,
    s3: range.s3 + start,
    e3: range.e3 - end,
  };
}

/** TrimUtil.trim: drops each side's own surrounding whitespace. */
function trimSides(text1: string, text2: string, text3: string, range: MergeRange3): MergeRange3 {
  const trim = (text: string, start: number, end: number): [number, number] => {
    let s = start;
    while (s < end && isSpaceEnterTab(text[s]!)) s++;
    let e = end;
    while (e > s && isSpaceEnterTab(text[e - 1]!)) e--;
    return [s, e];
  };
  const [s1, e1] = trim(text1, range.s1, range.e1);
  const [s2, e2] = trim(text2, range.s2, range.e2);
  const [s3, e3] = trim(text3, range.s3, range.e3);
  return { s1, e1, s2, e2, s3, e3 };
}

/** StringsKmp.equalsIgnoreWhitespaces: spaces, tabs and newlines drop out. */
function equalIgnoringWhitespace(one: string, two: string): boolean {
  let i = 0;
  let j = 0;
  while (i < one.length && j < two.length) {
    if (one[i] === two[j]) {
      i++;
      j++;
      continue;
    }
    let skipped = false;
    while (i < one.length && isSpaceEnterTab(one[i]!)) {
      skipped = true;
      i++;
    }
    while (j < two.length && isSpaceEnterTab(two[j]!)) {
      skipped = true;
      j++;
    }
    if (!skipped) return false;
  }
  while (i < one.length) {
    if (!isSpaceEnterTab(one[i]!)) return false;
    i++;
  }
  while (j < two.length) {
    if (!isSpaceEnterTab(two[j]!)) return false;
    j++;
  }
  return true;
}

function isEmpty3(range: MergeRange3): boolean {
  return range.s1 === range.e1 && range.s2 === range.e2 && range.s3 === range.e3;
}

function correct(
  ranges: MergeRange3[],
  text1: string,
  text2: string,
  text3: string,
  policy: Policy,
): MergeRange3[] {
  const out: MergeRange3[] = [];
  for (const range of ranges) {
    if (policy === "default") {
      let endCut = 0;
      while (
        range.s1 < range.e1 - endCut &&
        range.s2 < range.e2 - endCut &&
        range.s3 < range.e3 - endCut &&
        text1[range.e1 - endCut - 1] === text2[range.e2 - endCut - 1] &&
        text1[range.e1 - endCut - 1] === text3[range.e3 - endCut - 1] &&
        isSpaceEnterTab(text1[range.e1 - endCut - 1]!)
      ) {
        endCut++;
      }
      let startCut = 0;
      while (
        range.s1 + startCut < range.e1 - endCut &&
        range.s2 + startCut < range.e2 - endCut &&
        range.s3 + startCut < range.e3 - endCut &&
        text1[range.s1 + startCut] === text2[range.s2 + startCut] &&
        text1[range.s1 + startCut] === text3[range.s3 + startCut] &&
        isSpaceEnterTab(text1[range.s1 + startCut]!)
      ) {
        startCut++;
      }
      const trimmed: MergeRange3 = {
        s1: range.s1 + startCut,
        e1: range.e1 - endCut,
        s2: range.s2 + startCut,
        e2: range.e2 - endCut,
        s3: range.s3 + startCut,
        e3: range.e3 - endCut,
      };
      if (!isEmpty3(trimmed)) out.push(trimmed);
    } else {
      const trimmed = trimSides(text1, text2, text3, expandWhitespaces(text1, text2, text3, range));
      if (isEmpty3(trimmed)) continue;
      if (
        equalIgnoringWhitespace(text2.slice(trimmed.s2, trimmed.e2), text1.slice(trimmed.s1, trimmed.e1)) &&
        equalIgnoringWhitespace(text2.slice(trimmed.s2, trimmed.e2), text3.slice(trimmed.s3, trimmed.e3))
      ) {
        continue;
      }
      out.push(trimmed);
    }
  }
  return out;
}

// ------------------------------------------------------------------ helper

/**
 * MergeRangeUtil.getMergeType restricted to what SimpleHelper reads. The
 * whitespace policy is the one the pass runs with: the whitespace-ignoring
 * pass may see a stretch the other side left alone.
 */
function mergeType(
  range: MergeRange3,
  left: string,
  base: string,
  right: string,
  policy: Policy,
): MergeType {
  const emptyLeft = range.s1 === range.e1;
  const emptyBase = range.s2 === range.e2;
  const emptyRight = range.s3 === range.e3;
  const leftText = left.slice(range.s1, range.e1);
  const baseText = base.slice(range.s2, range.e2);
  const rightText = right.slice(range.s3, range.e3);
  const eq = policy === "default" ? sameText : equalIgnoringWhitespace;
  const equalLeftRight = eq(leftText, rightText);
  const unchangedLeft = eq(baseText, leftText);
  const unchangedRight = eq(baseText, rightText);
  if (emptyLeft && emptyBase && emptyRight) return { left: false, right: false, conflict: false };
  if (emptyBase) {
    if (emptyLeft) return { left: false, right: true, conflict: false };
    if (emptyRight) return { left: true, right: false, conflict: false };
    return equalLeftRight
      ? { left: true, right: true, conflict: false }
      : { left: true, right: true, conflict: true };
  }
  if (emptyLeft && emptyRight) return { left: true, right: true, conflict: false };
  // Unreachable from both callers: a changed fragment is never unchanged on
  // both sides, and a whitespace-ignoring pass drops such a range first. The
  // IDE throws here; refusing to resolve is the safe equivalent.
  if (unchangedLeft && unchangedRight) return { left: false, right: false, conflict: true };
  if (unchangedLeft) return { left: false, right: true, conflict: false };
  if (unchangedRight) return { left: true, right: false, conflict: false };
  return equalLeftRight
    ? { left: true, right: true, conflict: false }
    : { left: true, right: true, conflict: true };
}

/** ByWordRt.SimpleHelper: assembles the merged text, or null on a conflict. */
function simpleHelper(
  left: string,
  base: string,
  right: string,
  ranges: MergeRange3[],
  policy: Policy,
): string | null {
  let out = "";
  let last1 = 0;
  let last2 = 0;
  let last3 = 0;
  const next = (e1: number, e2: number, e3: number): MergeRange3 => {
    const range = { s1: last1, e1, s2: last2, e2, s3: last3, e3 };
    last1 = e1;
    last2 = e2;
    last3 = e3;
    return range;
  };
  const appendBase = (range: MergeRange3) => {
    if (isEmpty3(range)) return;
    const leftText = left.slice(range.s1, range.e1);
    const baseText = base.slice(range.s2, range.e2);
    const rightText = right.slice(range.s3, range.e3);
    if (sameText(baseText, leftText) && sameText(baseText, rightText)) {
      out += baseText;
      return;
    }
    const type = mergeType(range, left, base, right, "default");
    if (type.left) out += leftText;
    else if (type.right) out += rightText;
    else out += baseText;
  };
  const appendChange = (range: MergeRange3): boolean => {
    const type = mergeType(range, left, base, right, policy);
    if (type.conflict) return false;
    if (type.left) out += left.slice(range.s1, range.e1);
    else out += right.slice(range.s3, range.e3);
    return true;
  };

  for (const range of ranges) {
    appendBase(next(range.s1, range.s2, range.s3));
    if (!appendChange(next(range.e1, range.e2, range.e3))) return null;
  }
  appendBase(next(left.length, base.length, right.length));
  return out;
}

function trySimple(left: string, base: string, right: string, policy: Policy): string | null {
  const leftChunks = chunks(left);
  const baseChunks = chunks(base);
  const rightChunks = chunks(right);
  const baseLeft = sideEqual(base, left, baseChunks, leftChunks);
  const baseRight = sideEqual(base, right, baseChunks, rightChunks);
  const changes = mergeChanges(baseLeft, baseRight, [left.length, base.length, right.length]);
  const corrected = correct(changes, left, base, right, policy);
  return simpleHelper(left, base, right, corrected, policy);
}

/**
 * MergeResolveUtil.tryResolve: the three-way word merge of one range, or null
 * when both sides changed the same words differently.
 */
export function tryResolveText(left: string, base: string, right: string): string | null {
  try {
    const resolved = trySimple(left, base, right, "default");
    if (resolved !== null) return resolved;
    return trySimple(left, base, right, "ignoreWhitespace");
  } catch (error) {
    // `MergeResolveUtil.tryResolve` catches DiffTooBigException and leaves the
    // conflict to the reader, exactly as an unresolvable one.
    if (error instanceof DiffTooBigError) return null;
    throw error;
  }
}
