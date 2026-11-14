/**
 * IntelliJ's word-level diff, ported from `com.intellij.diff.comparison`
 * (`ByWordRt.getInlineChunks`, `ChunkOptimizer.WordChunkOptimizer`,
 * `LineFragmentSplitter`, `ByWordRt.compareAndSplit` and the `DEFAULT`
 * whitespace corrector of `ByWordRt.matchAdjustmentWhitespaces`).
 *
 * The point is not "highlight the changed tokens of two lines". IntelliJ
 * diffs the words and the newlines of a whole changed block together, so the
 * lines themselves line up where their words do: an inserted line no longer
 * steals the highlight from the line it was inserted next to. Each returned
 * block is one aligned run of lines and carries the character ranges that
 * changed inside it.
 *
 * Word equality is exact (`ComparisonPolicy.DEFAULT`); whitespace is not a
 * token, and the corrector widens every changed range over the whitespace the
 * two sides share, which is what keeps spaces inside a changed run marked.
 */

import { DiffTooBigError, elementIds, ideaBlocks, type IdeaBlock } from "./ideaDiff";

export interface WordFragment {
  start1: number;
  end1: number;
  start2: number;
  end2: number;
}

/** One aligned run of lines, with the changed character ranges inside it. */
export interface WordLineBlock {
  fragments: WordFragment[];
  start1: number;
  end1: number;
  start2: number;
  end2: number;
  newlines1: number;
  newlines2: number;
}

type ChunkKind = "word" | "punct" | "newline";

interface Chunk {
  kind: ChunkKind;
  start: number;
  end: number;
  /** Equality under the default policy: word contents, one character, "\n". */
  key: string;
}

interface Range {
  start1: number;
  end1: number;
  start2: number;
  end2: number;
}

const ideographic = /\p{Ideographic}/u;
const alphabetic = /\p{Alphabetic}/u;
const decimalDigit = /\p{Nd}/u;
const hiragana = /\p{Script=Hiragana}/u;
const katakana = /\p{Script=Katakana}/u;
const thai = /\p{Script=Thai}/u;
const javanese = /\p{Script=Javanese}/u;

/** `TrimUtil.isSpaceEnterOrTab`: the whitespace the tokenizer and the
 *  correctors agree on. A carriage return is deliberately NOT here — IDEA
 *  treats `\r` as a word character, and a CRLF file's `\r` therefore takes
 *  part in the word diff instead of vanishing as whitespace. */
function isSpaceEnterOrTab(code: number): boolean {
  return code === 32 || code === 9 || code === 10;
}

/** `TrimUtil.isPunctuation`: ASCII punctuation, with `_` treated as a letter
 *  so identifiers stay one token. */
function isAsciiPunctuation(code: number): boolean {
  return (
    code !== 95 &&
    ((code >= 33 && code <= 47) ||
      (code >= 58 && code <= 64) ||
      (code >= 91 && code <= 96) ||
      (code >= 123 && code <= 126))
  );
}

function isAlpha(code: number): boolean {
  return !isSpaceEnterOrTab(code) && !isAsciiPunctuation(code);
}

/** `TrimUtil.isContinuousScript`: scripts written without spaces are split
 *  into single characters, while accented Latin, Greek or Cyrillic still
 *  forms words. */
function isContinuousScript(code: number): boolean {
  if (code < 128) return false;
  const char = String.fromCodePoint(code);
  if (decimalDigit.test(char)) return false;
  return (
    ideographic.test(char) ||
    !alphabetic.test(char) ||
    hiragana.test(char) ||
    katakana.test(char) ||
    thai.test(char) ||
    javanese.test(char)
  );
}

/** `ByWordRt.getInlineChunks`: words, one chunk per punctuation mark, one per
 *  newline, and nothing for whitespace. */
export function getInlineChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;
  let wordStart = -1;
  let wordKey = "";
  while (offset < text.length) {
    const code = text.codePointAt(offset)!;
    const size = code > 0xffff ? 2 : 1;
    const char = text.slice(offset, offset + size);
    const alpha = isAlpha(code);
    if (alpha && !isContinuousScript(code)) {
      if (wordStart === -1) {
        wordStart = offset;
        wordKey = "";
      }
      wordKey += char;
    } else {
      if (wordStart !== -1) {
        chunks.push({ kind: "word", start: wordStart, end: offset, key: wordKey });
        wordStart = -1;
      }
      if (alpha) chunks.push({ kind: "word", start: offset, end: offset + size, key: char });
      else if (code === 10) chunks.push({ kind: "newline", start: offset, end: offset + 1, key: "\n" });
    }
    offset += size;
  }
  if (wordStart !== -1) chunks.push({ kind: "word", start: wordStart, end: text.length, key: wordKey });
  return chunks;
}

/** IDEA's blocks are the changed runs; the unchanged runs are the gaps
 *  between them, including the text before the first change and after the
 *  last one. */
function runsFromBlocks(
  blocks: readonly IdeaBlock[],
  length1: number,
  length2: number,
): { unchanged: Range[]; changes: Range[] } {
  const unchanged: Range[] = [];
  const changes: Range[] = [];
  let start1 = 0;
  let start2 = 0;
  for (const block of blocks) {
    if (start1 < block.aStart || start2 < block.bStart) {
      unchanged.push({ start1, end1: block.aStart, start2, end2: block.bStart });
    }
    changes.push({ start1: block.aStart, end1: block.aEnd, start2: block.bStart, end2: block.bEnd });
    start1 = block.aEnd;
    start2 = block.bEnd;
  }
  if (start1 < length1 || start2 < length2) {
    unchanged.push({ start1, end1: length1, start2, end2: length2 });
  }
  return { unchanged, changes };
}

function chunkEquals(a: Chunk | undefined, b: Chunk | undefined): boolean {
  return a !== undefined && b !== undefined && a.key === b.key;
}

function expandForward(
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  start1: number,
  start2: number,
  end1: number,
  end2: number,
): number {
  let i = start1;
  let j = start2;
  while (i < end1 && j < end2 && chunkEquals(words1[i], words2[j])) {
    i++;
    j++;
  }
  return i - start1;
}

function expandBackward(
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  start1: number,
  start2: number,
  end1: number,
  end2: number,
): number {
  let i = end1;
  let j = end2;
  while (start1 < i && start2 < j && chunkEquals(words1[i - 1], words2[j - 1])) {
    i--;
    j--;
  }
  return end1 - i;
}

function separatedByWhitespace(text: string, first: Chunk, second: Chunk): boolean {
  if (first.kind === "newline" || second.kind === "newline") return true;
  for (let i = first.end; i < second.start; i++) {
    if (isSpaceEnterOrTab(text.charCodeAt(i))) return true;
  }
  return false;
}

function findSequenceEdgeShift(
  text: string,
  words: readonly Chunk[],
  offset: number,
  count: number,
  leftToRight: boolean,
): number {
  for (let i = 0; i < count; i++) {
    const first = leftToRight ? words[offset + i] : words[offset - i - 1];
    const second = leftToRight ? words[offset + i + 1] : words[offset - i];
    if (!first || !second) return -1;
    if (separatedByWhitespace(text, first, second)) return i + 1;
  }
  return -1;
}

/** `ChunkOptimizer.WordChunkOptimizer`: moves unchanged boundaries onto the
 *  whitespace between two word sequences, so a fragment does not begin in the
 *  middle of a word when an equally good alignment exists. */
function optimizeWordChunks(
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  text1: string,
  text2: string,
  unchanged: readonly Range[],
): Range[] {
  const ranges: Range[] = [];
  for (const range of unchanged) {
    ranges.push({ ...range });
    processLastRanges(ranges, words1, words2, text1, text2);
  }
  return ranges;
}

function processLastRanges(
  ranges: Range[],
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  text1: string,
  text2: string,
): void {
  while (ranges.length >= 2) {
    const first = ranges[ranges.length - 2]!;
    const second = ranges[ranges.length - 1]!;
    if (first.end1 !== second.start1 && first.end2 !== second.start2) return;
    const count1 = first.end1 - first.start1;
    const count2 = second.end1 - second.start1;
    const equalForward = expandForward(
      words1,
      words2,
      first.end1,
      first.end2,
      first.end1 + count2,
      first.end2 + count2,
    );
    const equalBackward = expandBackward(
      words1,
      words2,
      second.start1 - count1,
      second.start2 - count1,
      second.start1,
      second.start2,
    );
    if (equalForward === 0 && equalBackward === 0) return;
    if (equalForward === count2) {
      ranges.pop();
      ranges.pop();
      ranges.push({ start1: first.start1, end1: first.end1 + count2, start2: first.start2, end2: first.end2 + count2 });
      continue;
    }
    if (equalBackward === count1) {
      ranges.pop();
      ranges.pop();
      ranges.push({ start1: second.start1 - count1, end1: second.end1, start2: second.start2 - count1, end2: second.end2 });
      continue;
    }
    const touchLeft = first.end1 === second.start1;
    const touchWords = touchLeft ? words1 : words2;
    const touchText = touchLeft ? text1 : text2;
    const touchStart = touchLeft ? second.start1 : second.start2;
    let shift = 0;
    if (touchStart > 0 && touchStart < touchWords.length) {
      const before = touchWords[touchStart - 1]!;
      const after = touchWords[touchStart]!;
      if (!separatedByWhitespace(touchText, before, after)) {
        const left = findSequenceEdgeShift(touchText, touchWords, touchStart, equalForward, true);
        if (left > 0) shift = left;
        else {
          const right = findSequenceEdgeShift(touchText, touchWords, touchStart - 1, equalBackward, false);
          if (right > 0) shift = -right;
        }
      }
    }
    if (shift !== 0) {
      ranges.pop();
      ranges.pop();
      ranges.push({ start1: first.start1, end1: first.end1 + shift, start2: first.start2, end2: first.end2 + shift });
      ranges.push({ start1: second.start1 + shift, end1: second.end1, start2: second.start2 + shift, end2: second.end2 });
    }
    return;
  }
}

/** The gaps between ordered ranges; the caller chooses whether the input is
 *  the unchanged runs (yielding changes) or the changes (yielding runs). */
function complementRanges(ranges: readonly Range[], length1: number, length2: number): Range[] {
  const out: Range[] = [];
  let start1 = 0;
  let start2 = 0;
  for (const range of ranges) {
    if (start1 < range.start1 || start2 < range.start2) {
      out.push({ start1, end1: range.start1, start2, end2: range.start2 });
    }
    start1 = range.end1;
    start2 = range.end2;
  }
  if (start1 < length1 || start2 < length2) {
    out.push({ start1, end1: length1, start2, end2: length2 });
  }
  return out;
}

interface RawBlock {
  words: Range;
  offsets: Range;
}

interface PendingChunk {
  block: RawBlock;
  hasEqualWords: boolean;
  hasWordsInside: boolean;
  isEqualIgnoreWhitespaces: boolean;
}

function isEmptyRange(range: Range): boolean {
  return range.start1 === range.end1 && range.start2 === range.end2;
}

/** `LineFragmentSplitter`: cuts the word diff at equal newlines, merging
 *  neighbouring runs that share no words (or only whitespace). */
function splitIntoLineBlocks(
  text1: string,
  text2: string,
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  unchanged: readonly Range[],
): RawBlock[] {
  const result: RawBlock[] = [];
  let last1 = -1;
  let last2 = -1;
  let pending: PendingChunk | null = null;
  let hasEqualWords = false;

  const getOffset = (words: readonly Chunk[], text: string, index: number): number => {
    if (index === -1) return 0;
    if (index === words.length) return text.length;
    const chunk = words[index]!;
    return chunk.kind === "newline" ? chunk.end : chunk.start;
  };
  const isNewline = (words: readonly Chunk[], index: number): boolean => words[index]?.kind === "newline";
  const isFirstInLine = (words: readonly Chunk[], index: number): boolean =>
    index === 0 || words[index - 1]?.kind === "newline";

  const createChunk = (
    start1: number,
    start2: number,
    end1: number,
    end2: number,
    equalWords: boolean,
  ): PendingChunk => {
    const words: Range = {
      start1: Math.max(0, start1 + 1),
      end1: Math.min(end1 + 1, words1.length),
      start2: Math.max(0, start2 + 1),
      end2: Math.min(end2 + 1, words2.length),
    };
    const offsets: Range = {
      start1: getOffset(words1, text1, start1),
      end1: getOffset(words1, text1, end1),
      start2: getOffset(words2, text2, start2),
      end2: getOffset(words2, text2, end2),
    };
    let wordsInside = false;
    for (let i = words.start1; i < words.end1; i++) {
      if (words1[i]?.kind !== "newline") {
        wordsInside = true;
        break;
      }
    }
    if (!wordsInside) {
      for (let i = words.start2; i < words.end2; i++) {
        if (words2[i]?.kind !== "newline") {
          wordsInside = true;
          break;
        }
      }
    }
    return {
      block: { words, offsets },
      hasEqualWords: equalWords,
      hasWordsInside: wordsInside,
      isEqualIgnoreWhitespaces: equalIgnoringWhitespace(
        text1.slice(offsets.start1, offsets.end1),
        text2.slice(offsets.start2, offsets.end2),
      ),
    };
  };

  const shouldMerge = (first: PendingChunk, second: PendingChunk): boolean =>
    (!first.hasEqualWords && !second.hasEqualWords) ||
    (first.isEqualIgnoreWhitespaces && second.isEqualIgnoreWhitespaces) ||
    !first.hasWordsInside ||
    !second.hasWordsInside;

  const merge = (first: PendingChunk, second: PendingChunk): PendingChunk => ({
    block: {
      words: {
        start1: first.block.words.start1,
        end1: second.block.words.end1,
        start2: first.block.words.start2,
        end2: second.block.words.end2,
      },
      offsets: {
        start1: first.block.offsets.start1,
        end1: second.block.offsets.end1,
        start2: first.block.offsets.start2,
        end2: second.block.offsets.end2,
      },
    },
    hasEqualWords: first.hasEqualWords || second.hasEqualWords,
    hasWordsInside: first.hasWordsInside || second.hasWordsInside,
    isEqualIgnoreWhitespaces: first.isEqualIgnoreWhitespaces && second.isEqualIgnoreWhitespaces,
  });

  const addLineChunk = (end1: number, end2: number, equalWords: boolean): void => {
    if (last1 > end1 || last2 > end2) return;
    const chunk = createChunk(last1, last2, end1, end2, equalWords);
    if (isEmptyRange(chunk.block.offsets)) return;
    if (pending) {
      if (shouldMerge(pending, chunk)) pending = merge(pending, chunk);
      else {
        result.push(pending.block);
        pending = chunk;
      }
    } else {
      pending = chunk;
    }
    last1 = end1;
    last2 = end2;
  };

  for (const range of unchanged) {
    const count = range.end1 - range.start1;
    for (let i = 0; i < count; i++) {
      const index1 = range.start1 + i;
      const index2 = range.start2 + i;
      if (isNewline(words1, index1) && isNewline(words2, index2)) {
        addLineChunk(index1, index2, hasEqualWords);
        hasEqualWords = false;
      } else {
        if (isFirstInLine(words1, index1) && isFirstInLine(words2, index2)) {
          addLineChunk(index1 - 1, index2 - 1, hasEqualWords);
        }
        hasEqualWords = true;
      }
    }
  }
  addLineChunk(words1.length, words2.length, hasEqualWords);
  const finish = (): void => {
    if (pending) result.push(pending.block);
  };
  finish();
  return result;
}

function equalIgnoringWhitespace(text1: string, text2: string): boolean {
  // ComparisonPolicy.IGNORE_WHITESPACES drops exactly the whitespace the
  // tokenizer knows (`TrimUtil.isSpaceEnterOrTab`). `\s` would also drop `\r`,
  // which IDEA treats as text — that merged blocks whose only difference was
  // where the carriage return sat.
  const strip = (text: string): string => text.replace(/[ \t\n]/g, "");
  return strip(text1) === strip(text2);
}

function expandWhitespacesForward(
  text1: string,
  text2: string,
  start1: number,
  start2: number,
  end1: number,
  end2: number,
): number {
  let i = start1;
  let j = start2;
  while (i < end1 && j < end2 && text1[i] === text2[j] && isSpaceEnterOrTab(text1.charCodeAt(i))) {
    i++;
    j++;
  }
  return i - start1;
}

function expandWhitespacesBackward(
  text1: string,
  text2: string,
  start1: number,
  start2: number,
  end1: number,
  end2: number,
): number {
  let i = end1;
  let j = end2;
  while (start1 < i && start2 < j && text1[i - 1] === text2[j - 1] && isSpaceEnterOrTab(text1.charCodeAt(i - 1))) {
    i--;
    j--;
  }
  return end1 - i;
}

interface PunctuationChar {
  char: number;
  offset: number;
}

function punctuationPositions(text: string): PunctuationChar[] {
  const out: PunctuationChar[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    if (isAsciiPunctuation(char)) out.push({ char, offset: i });
  }
  return out;
}

/** `ByCharRt.comparePunctuation`: the punctuation marks the two texts share,
 *  as one-character ranges in each text. Punctuation is not a word token, so
 *  without this pass a fragment would swallow `);` next to the word it
 *  actually changed. */
function punctuationUnchanged(text1: string, text2: string): Range[] {
  const chars1 = punctuationPositions(text1);
  const chars2 = punctuationPositions(text2);
  const ids = new Map<number, number>();
  const ids1 = elementIds(
    chars1.map((char) => char.char),
    ids,
  );
  const ids2 = elementIds(
    chars2.map((char) => char.char),
    ids,
  );
  const blocks = ideaBlocks(ids1, ids2);
  const unchanged = complementRanges(
    blocks.map((block) => ({
      start1: block.aStart,
      end1: block.aEnd,
      start2: block.bStart,
      end2: block.bEnd,
    })),
    chars1.length,
    chars2.length,
  );
  const out: Range[] = [];
  for (const range of unchanged) {
    const count = range.end1 - range.start1;
    for (let i = 0; i < count; i++) {
      const first = chars1[range.start1 + i]!;
      const second = chars2[range.start2 + i]!;
      out.push({ start1: first.offset, end1: first.offset + 1, start2: second.offset, end2: second.offset + 1 });
    }
  }
  return out;
}

/** `ByWordRt.splitIterable2Side`: one punctuation comparison against the
 *  concatenation of two ranges of the other side, split back apart. */
function splitPunctuation2Side(changes: readonly Range[], offset: number): [Range[], Range[]] {
  const first: Range[] = [];
  const second: Range[] = [];
  for (const change of changes) {
    if (change.end2 <= offset) first.push(change);
    else if (change.start2 >= offset) {
      second.push({ ...change, start2: change.start2 - offset, end2: change.end2 - offset });
    } else {
      const length2 = offset - change.start2;
      first.push({ start1: change.start1, end1: change.start1 + length2, start2: change.start2, end2: offset });
      second.push({ start1: change.start1 + length2, end1: change.end1, start2: 0, end2: change.end2 - offset });
    }
  }
  return [first, second];
}

function comparePunctuation2Side(text1: string, text21: string, text22: string): [Range[], Range[]] {
  return splitPunctuation2Side(punctuationUnchanged(text1, text21 + text22), text21.length);
}

/**
 * `ByWordRt.AdjustmentPunctuationMatcher`: after the word diff, identical
 * punctuation inside each changed gap is matched again, so `foo(a, b)` and
 * `foo(a, c)` differ only in `b`/`c`, not in the comma and parentheses around
 * them. Returns the equal ranges in the block's own text offsets.
 */
function matchAdjustmentDelimiters(
  text1: string,
  text2: string,
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  unchanged: readonly Range[],
  shift1: number,
  shift2: number,
): Range[] {
  const length1 = text1.length;
  const length2 = text2.length;
  const equals: Range[] = [];
  let lastStart1 = -1;
  let lastStart2 = -1;
  let lastEnd1 = -1;
  let lastEnd2 = -1;

  const start1At = (index: number): number =>
    index >= 0 && index < words1.length ? words1[index]!.start - shift1 : length1;
  const start2At = (index: number): number =>
    index >= 0 && index < words2.length ? words2[index]!.start - shift2 : length2;
  const end1At = (index: number): number =>
    index < 0 ? 0 : index >= words1.length ? length1 : words1[index]!.end - shift1;
  const end2At = (index: number): number =>
    index < 0 ? 0 : index >= words2.length ? length2 : words2[index]!.end - shift2;

  const markEqual = (start1: number, start2: number, end1: number, end2: number): void => {
    if (start1 === end1 && start2 === end2) return;
    equals.push({ start1, end1, start2, end2 });
  };
  const matchRange = (start1: number, start2: number, end1: number, end2: number): void => {
    if (start1 === end1 && start2 === end2) return;
    for (const range of punctuationUnchanged(text1.slice(start1, end1), text2.slice(start2, end2))) {
      markEqual(start1 + range.start1, start2 + range.start2, start1 + range.end1, start2 + range.end2);
    }
  };
  const matchComplexRangeLeft = (
    start1: number,
    end1: number,
    start12: number,
    end12: number,
    start22: number,
    end22: number,
  ): void => {
    const [first, second] = comparePunctuation2Side(
      text1.slice(start1, end1),
      text2.slice(start12, end12),
      text2.slice(start22, end22),
    );
    for (const range of first) {
      markEqual(start1 + range.start1, start12 + range.start2, start1 + range.end1, start12 + range.end2);
    }
    for (const range of second) {
      markEqual(start1 + range.start1, start22 + range.start2, start1 + range.end1, start22 + range.end2);
    }
  };
  const matchComplexRangeRight = (
    start2: number,
    end2: number,
    start11: number,
    end11: number,
    start21: number,
    end21: number,
  ): void => {
    const [first, second] = comparePunctuation2Side(
      text2.slice(start2, end2),
      text1.slice(start11, end11),
      text1.slice(start21, end21),
    );
    for (const range of first) {
      markEqual(start11 + range.start2, start2 + range.start1, start11 + range.end2, start2 + range.end1);
    }
    for (const range of second) {
      markEqual(start21 + range.start2, start2 + range.start1, start21 + range.end2, start2 + range.end1);
    }
  };
  const matchComplexRange = (
    start11: number,
    start12: number,
    end11: number,
    end12: number,
    start21: number,
    start22: number,
    end21: number,
    end22: number,
  ): void => {
    if (start11 === start21 && end11 === end21) {
      matchComplexRangeLeft(start11, end11, start12, end12, start22, end22);
    } else if (start12 === start22 && end12 === end22) {
      matchComplexRangeRight(start12, end12, start11, end11, start21, end21);
    }
  };
  const matchForwardRange = (start1: number, start2: number, end1: number, end2: number): void => {
    lastStart1 = start1;
    lastStart2 = start2;
    lastEnd1 = end1;
    lastEnd2 = end2;
  };
  const clearLastRange = (): void => {
    lastStart1 = -1;
    lastStart2 = -1;
    lastEnd1 = -1;
    lastEnd2 = -1;
  };
  const matchBackwardRange = (start1: number, start2: number, end1: number, end2: number): void => {
    if (lastStart1 === -1) return;
    if (lastStart1 === start1 && lastStart2 === start2) {
      if (lastEnd1 === end1 && lastEnd2 === end2) matchRange(start1, start2, end1, end2);
    } else if (lastStart1 < start1 && lastStart2 < start2) {
      if (lastEnd1 > start1 || lastEnd2 > start2) return;
      matchRange(lastStart1, lastStart2, lastEnd1, lastEnd2);
      matchRange(start1, start2, end1, end2);
    } else {
      matchComplexRange(lastStart1, lastStart2, lastEnd1, lastEnd2, start1, start2, end1, end2);
    }
  };
  const matchBackward = (index1: number, index2: number): void => {
    matchBackwardRange(
      index1 === 0 ? 0 : end1At(index1 - 1),
      index2 === 0 ? 0 : end2At(index2 - 1),
      index1 === words1.length ? length1 : start1At(index1),
      index2 === words2.length ? length2 : start2At(index2),
    );
    clearLastRange();
  };
  const matchForward = (index1: number, index2: number): void => {
    matchForwardRange(
      index1 === -1 ? 0 : end1At(index1),
      index2 === -1 ? 0 : end2At(index2),
      index1 + 1 === words1.length ? length1 : start1At(index1 + 1),
      index2 + 1 === words2.length ? length2 : start2At(index2 + 1),
    );
  };

  clearLastRange();
  matchForward(-1, -1);
  for (const range of unchanged) {
    const count = range.end1 - range.start1;
    for (let i = 0; i < count; i++) {
      const index1 = range.start1 + i;
      const index2 = range.start2 + i;
      matchBackward(index1, index2);
      markEqual(start1At(index1), start2At(index2), end1At(index1), end2At(index2));
      matchForward(index1, index2);
    }
  }
  matchBackward(words1.length, words2.length);

  equals.sort((a, b) => a.start1 - b.start1 || a.start2 - b.start2);
  const merged: Range[] = [];
  for (const range of equals) {
    const last = merged[merged.length - 1];
    if (last && range.start1 <= last.end1 && range.start2 <= last.end2) {
      last.end1 = Math.max(last.end1, range.end1);
      last.end2 = Math.max(last.end2, range.end2);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** `ByWordRt.DefaultCorrector`: widens each changed range over the whitespace
 *  the two sides share, so a changed word takes its surrounding spaces with
 *  it. */
function expandWhitespaceChanges(changes: readonly Range[], text1: string, text2: string): WordFragment[] {
  const out: WordFragment[] = [];
  for (const change of changes) {
    const endCut = expandWhitespacesBackward(text1, text2, change.start1, change.start2, change.end1, change.end2);
    const startCut = expandWhitespacesForward(
      text1,
      text2,
      change.start1,
      change.start2,
      change.end1 - endCut,
      change.end2 - endCut,
    );
    const expanded: Range = {
      start1: change.start1 + startCut,
      end1: change.end1 - endCut,
      start2: change.start2 + startCut,
      end2: change.end2 - endCut,
    };
    if (expanded.start1 !== expanded.end1 || expanded.start2 !== expanded.end2) out.push(expanded);
  }
  return out;
}

/** The character ranges that changed inside one line block. */
function blockFragments(
  block: RawBlock,
  wordChanges: readonly Range[],
  words1: readonly Chunk[],
  words2: readonly Chunk[],
  text1: string,
  text2: string,
): WordFragment[] {
  const subwords1 = words1.slice(block.words.start1, block.words.end1);
  const subwords2 = words2.slice(block.words.start2, block.words.end2);
  const subtext1 = text1.slice(block.offsets.start1, block.offsets.end1);
  const subtext2 = text2.slice(block.offsets.start2, block.offsets.end2);
  const localChanges: Range[] = [];
  for (const change of wordChanges) {
    if (change.end1 <= block.words.start1 && change.end2 <= block.words.start2) continue;
    if (change.start1 >= block.words.end1 && change.start2 >= block.words.end2) continue;
    const start1 = Math.max(0, Math.max(change.start1, block.words.start1) - block.words.start1);
    const end1 = Math.min(subwords1.length, Math.min(change.end1, block.words.end1) - block.words.start1);
    const start2 = Math.max(0, Math.max(change.start2, block.words.start2) - block.words.start2);
    const end2 = Math.min(subwords2.length, Math.min(change.end2, block.words.end2) - block.words.start2);
    if (start1 >= end1 && start2 >= end2) continue;
    localChanges.push({ start1, end1: Math.max(start1, end1), start2, end2: Math.max(start2, end2) });
  }
  const localUnchanged = complementRanges(localChanges, subwords1.length, subwords2.length);
  const equal = matchAdjustmentDelimiters(
    subtext1,
    subtext2,
    subwords1,
    subwords2,
    localUnchanged,
    block.offsets.start1,
    block.offsets.start2,
  );
  const textChanges = complementRanges(equal, subtext1.length, subtext2.length);
  return expandWhitespaceChanges(textChanges, subtext1, subtext2);
}

function countNewlines(words: readonly Chunk[], start: number, end: number): number {
  let count = 0;
  for (let i = start; i < end; i++) {
    if (words[i]?.kind === "newline") count++;
  }
  return count;
}

/**
 * Compares two blocks of text the way IntelliJ's `compareAndSplit` does and
 * returns one entry per aligned run of lines. Character ranges are relative
 * to the block's own text.
 */
export function compareAndSplit(text1: string, text2: string): WordLineBlock[] {
  const words1 = getInlineChunks(text1);
  const words2 = getInlineChunks(text2);
  try {
    const ids = new Map<string, number>();
    const ids1 = elementIds(
      words1.map((chunk) => chunk.key),
      ids,
    );
    const ids2 = elementIds(
      words2.map((chunk) => chunk.key),
      ids,
    );
    const { unchanged } = runsFromBlocks(ideaBlocks(ids1, ids2), words1.length, words2.length);
    const optimized = optimizeWordChunks(words1, words2, text1, text2, unchanged);
    const changes = complementRanges(optimized, words1.length, words2.length);
    return splitIntoLineBlocks(text1, text2, words1, words2, optimized).map((block) => ({
      fragments: blockFragments(block, changes, words1, words2, text1, text2),
      start1: block.offsets.start1,
      end1: block.offsets.end1,
      start2: block.offsets.start2,
      end2: block.offsets.end2,
      newlines1: countNewlines(words1, block.words.start1, block.words.end1),
      newlines2: countNewlines(words2, block.words.start2, block.words.end2),
    }));
  } catch (error) {
    // IntelliJ gives up on inner fragments when the word diff is too big
    // (`DiffTooBigException`); the line fragment is shown without them.
    if (!(error instanceof DiffTooBigError)) throw error;
    return [
      {
        fragments: [],
        start1: 0,
        end1: text1.length,
        start2: 0,
        end2: text2.length,
        newlines1: countNewlines(words1, 0, words1.length),
        newlines2: countNewlines(words2, 0, words2.length),
      },
    ];
  }
}
