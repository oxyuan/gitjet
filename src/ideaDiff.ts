/**
 * IntelliJ's diff engine, ported from `com.intellij.util.diff.Diff` (Reindexer +
 * MyersLCS, with the PatienceIntLCS fallback Diff chooses when Myers cannot
 * settle a region inside its difference threshold). The word merge compares
 * words, newlines and punctuation at a granularity where many alignments are
 * equally valid, and only the engine's own tie-breaking reproduces the IDE's
 * merge results.
 *
 * Inputs are element ids; equal ids mean equal elements. Outputs are the
 * changed blocks, which is all the diff iterables need.
 */

/** `FilesTooBigForDiffException`: Myers exhausted its difference threshold, so
 *  the coarse Patience pass decides — and when that cannot shrink the region
 *  either, the IDE gives up on inner fragments and the caller must fall back. */
export class DiffTooBigError extends Error {
  constructor() {
    super("diff too big");
    this.name = "DiffTooBigError";
  }
}

export interface IdeaBlock {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/** Diff.LCSBuilder equivalent: where the equal stretches sit. */
interface Builder {
  markEqual(length: number): void;
  addChange(deleted: number, inserted: number): void;
}

function diffFast(length1: number, length2: number, startShift: number, endCut: number): IdeaBlock[] | null {
  const trimmed1 = length1 - startShift - endCut;
  const trimmed2 = length2 - startShift - endCut;
  if (trimmed1 !== 0 && trimmed2 !== 0) return null;
  if (trimmed1 === 0 && trimmed2 === 0) return [];
  return [{ aStart: startShift, aEnd: startShift + trimmed1, bStart: startShift, bEnd: startShift + trimmed2 }];
}

function commonPrefix(a: readonly number[], b: readonly number[]): number {
  const size = Math.min(a.length, b.length);
  let n = 0;
  while (n < size && a[n] === b[n]) n++;
  return n;
}

function commonSuffix(a: readonly number[], b: readonly number[], startShift: number): number {
  const size = Math.min(a.length, b.length) - startShift;
  let n = 0;
  while (n < size && a[a.length - n - 1] === b[b.length - n - 1]) n++;
  return n;
}

/** Reindexer: drops elements one side cannot possibly match, remembers where
 *  they were, and re-indexes the surviving changes afterwards. */
class Reindexer {
  private oldIndices: [number[], number[]] = [[], []];
  private originalLengths: [number, number] = [0, 0];
  private discardedLengths: [number, number] = [0, 0];

  discardUnique(a: readonly number[], b: readonly number[]): [number[], number[]] {
    const discarded1 = this.discard(b, a, 0);
    const discarded2 = this.discard(discarded1, b, 1);
    return [discarded1, discarded2];
  }

  private discard(needed: readonly number[], toDiscard: readonly number[], arrayIndex: 0 | 1): number[] {
    this.originalLengths[arrayIndex] = toDiscard.length;
    const neededIds = new Set(needed);
    const discarded: number[] = [];
    const oldIndices: number[] = [];
    for (let i = 0; i < toDiscard.length; i++) {
      const index = toDiscard[i]!;
      if (neededIds.has(index)) {
        discarded.push(index);
        oldIndices.push(i);
      }
    }
    this.oldIndices[arrayIndex] = oldIndices;
    this.discardedLengths[arrayIndex] = discarded.length;
    return discarded;
  }

  /** Maps the changed flags of the surviving arrays back to the originals. */
  reindex(changes1: Uint8Array, changes2: Uint8Array): [Uint8Array, Uint8Array] {
    const [length1, length2] = this.originalLengths;
    if (this.discardedLengths[0] === length1 && this.discardedLengths[1] === length2) {
      return [changes1, changes2];
    }
    const mapped1 = new Uint8Array(length1);
    const mapped2 = new Uint8Array(length2);
    const known1 = this.oldIndices[0];
    const known2 = this.oldIndices[1];
    const increment = (indexes: number[], i: number, set: Uint8Array, length: number): number => {
      const from = indexes[i]! + 1;
      const to = i + 1 < indexes.length ? indexes[i + 1]! : length;
      set.fill(1, from, to);
      return i + 1;
    };
    let x = 0;
    let y = 0;
    while (x < this.discardedLengths[0] || y < this.discardedLengths[1]) {
      if (
        x < this.discardedLengths[0] &&
        y < this.discardedLengths[1] &&
        !changes1[x] &&
        !changes2[y]
      ) {
        x = increment(known1, x, mapped1, length1);
        y = increment(known2, y, mapped2, length2);
      } else if (changes1[x]) {
        mapped1[known1[x]!] = 1;
        x = increment(known1, x, mapped1, length1);
      } else if (changes2[y]) {
        mapped2[known2[y]!] = 1;
        y = increment(known2, y, mapped2, length2);
      } else {
        break;
      }
    }
    // Whatever precedes the first surviving element is unmatched.
    if (this.discardedLengths[0] === 0) mapped1.fill(1, 0, length1);
    else mapped1.fill(1, 0, known1[0]!);
    if (this.discardedLengths[1] === 0) mapped2.fill(1, 0, length2);
    else mapped2.fill(1, 0, known2[0]!);
    return [mapped1, mapped2];
  }
}

/** MyersLCS: the linear-space bidirectional Myers the IDE ships. */
class MyersLcs {
  private readonly changes1: Uint8Array;
  private readonly changes2: Uint8Array;
  private readonly forward: Int32Array;
  private readonly backward: Int32Array;

  constructor(
    private readonly first: readonly number[],
    private readonly second: readonly number[],
    private readonly start1: number,
    private readonly count1: number,
    private readonly start2: number,
    private readonly count2: number,
  ) {
    this.changes1 = new Uint8Array(count1).fill(1);
    this.changes2 = new Uint8Array(count2).fill(1);
    this.forward = new Int32Array(count1 + count2 + 1);
    this.backward = new Int32Array(count1 + count2 + 1);
  }

  /** `MyersLCS.executeWithThreshold`. `throwIfTooBig` is false only when the
   *  patience pass runs it as its last resort: `execute` then leaves the
   *  region marked changed (`execute` in the IDE throws instead). */
  run(throwIfTooBig = true): [Uint8Array, Uint8Array] {
    const threshold = Math.max(20000 + 10 * Math.trunc(Math.sqrt(this.count1 + this.count2)), 20000);
    const tooBig = this.execute(
      0,
      this.count1,
      0,
      this.count2,
      Math.min(threshold, this.count1 + this.count2),
      throwIfTooBig,
    );
    if (tooBig && throwIfTooBig) throw new DiffTooBigError();
    return [this.changes1, this.changes2];
  }

  private execute(
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number,
    differenceEstimate: number,
    throwIfTooBig: boolean,
  ): boolean {
    if (oldStart >= oldEnd || newStart >= newEnd) return false;
    const oldLength = oldEnd - oldStart;
    const newLength = newEnd - newStart;
    const vf = this.forward;
    const vb = this.backward;
    vf[newLength + 1] = 0;
    vb[newLength + 1] = 0;
    const halfD = (differenceEstimate + 1) >> 1;
    let xx = 0;
    let kk = 0;
    let td = -1;
    outer: for (let d = 0; d <= halfD; d++) {
      const left = newLength + Math.max(-d, -newLength + ((d ^ newLength) & 1));
      const right = newLength + Math.min(d, oldLength - ((d ^ oldLength) & 1));
      for (let k = left; k <= right; k += 2) {
        let x =
          k !== left && (k === right || vf[k - 1]! >= vf[k + 1]!) ? vf[k - 1]! + 1 : vf[k + 1]!;
        const y = x - k + newLength;
        x += this.forwardCommon(oldStart + x, newStart + y, Math.min(oldLength - x, newLength - y));
        vf[k] = x;
      }
      if ((oldLength - newLength) % 2 !== 0) {
        for (let k = left; k <= right; k += 2) {
          if (
            oldLength - (d - 1) <= k &&
            k <= oldLength + (d - 1) &&
            vf[k]! + vb[newLength + oldLength - k]! >= oldLength
          ) {
            xx = vf[k]!;
            kk = k;
            td = 2 * d - 1;
            break outer;
          }
        }
      }
      for (let k = left; k <= right; k += 2) {
        let x =
          k !== left && (k === right || vb[k - 1]! >= vb[k + 1]!) ? vb[k - 1]! + 1 : vb[k + 1]!;
        const y = x - k + newLength;
        x += this.backwardCommon(oldEnd - 1 - x, newEnd - 1 - y, Math.min(oldLength - x, newLength - y));
        vb[k] = x;
      }
      if ((oldLength - newLength) % 2 === 0) {
        for (let k = left; k <= right; k += 2) {
          if (
            oldLength - d <= k &&
            k <= oldLength + d &&
            vf[oldLength + newLength - k]! + vb[k]! >= oldLength
          ) {
            xx = oldLength - vb[k]!;
            kk = oldLength + newLength - k;
            td = 2 * d;
            break outer;
          }
        }
      }
    }

    if (td > 1) {
      const split = xx - kk + newLength;
      const oldDiff = (td + 1) >> 1;
      if (xx > 0 && split > 0) {
        if (this.execute(oldStart, oldStart + xx, newStart, newStart + split, oldDiff, throwIfTooBig) && throwIfTooBig) {
          return true;
        }
      }
      if (oldStart + xx < oldEnd && newStart + split < newEnd) {
        if (this.execute(oldStart + xx, oldEnd, newStart + split, newEnd, td - oldDiff, throwIfTooBig) && throwIfTooBig) {
          return true;
        }
      }
    } else if (td >= 0) {
      // The centre line never crossed: walk the two runs greedily.
      let d = oldStart;
      let y = newStart;
      while (d < oldEnd && y < newEnd) {
        const common = this.forwardCommon(d, y, Math.min(oldEnd - d, newEnd - y));
        if (common > 0) {
          this.addUnchanged(d, y, common);
          d += common;
          y += common;
        } else if (oldEnd - oldStart > newEnd - newStart) {
          d++;
        } else {
          y++;
        }
      }
    } else {
      // No centre line was found inside the difference estimate.
      return true;
    }
    return false;
  }

  private addUnchanged(start1: number, start2: number, count: number): void {
    // The change masks cover only this run's slice (`count1`/`count2`).
    this.changes1.fill(0, start1, start1 + count);
    this.changes2.fill(0, start2, start2 + count);
  }

  private forwardCommon(oldIndex: number, newIndex: number, maxLength: number): number {
    const limit = Math.min(maxLength, Math.min(this.count1 - oldIndex, this.count2 - newIndex));
    let x = oldIndex;
    let y = newIndex;
    while (x - oldIndex < limit && this.first[this.start1 + x] === this.second[this.start2 + y]) {
      x++;
      y++;
    }
    return x - oldIndex;
  }

  private backwardCommon(oldIndex: number, newIndex: number, maxLength: number): number {
    const limit = Math.min(maxLength, Math.min(oldIndex, newIndex) + 1);
    let x = oldIndex;
    let y = newIndex;
    while (oldIndex - x < limit && this.first[this.start1 + x] === this.second[this.start2 + y]) {
      x--;
      y--;
    }
    return oldIndex - x;
  }
}

/** `UniqueLCS`: the elements each side has exactly once, reduced to their
 *  longest increasing match. This is what Patience uses to find anchors that
 *  Myers' difference threshold cannot reach. */
function uniqueLcs(
  first: readonly number[],
  second: readonly number[],
  start1: number,
  count1: number,
  start2: number,
  count2: number,
): [Int32Array, Int32Array] | null {
  const known = new Map<number, number>();
  for (let i = 0; i < count1; i++) {
    const value = first[start1 + i]!;
    const position = known.get(value);
    if (position === undefined) known.set(value, i + 1);
    else if (position !== -1) known.set(value, -1);
  }
  const match = new Int32Array(count1);
  let count = 0;
  for (let i = 0; i < count2; i++) {
    const value = second[start2 + i]!;
    const position = known.get(value);
    if (position === undefined || position === -1) continue;
    const index = position - 1;
    if (match[index] === 0) {
      match[index] = i + 1;
      count++;
    } else {
      match[index] = 0;
      known.set(value, -1);
      count--;
    }
  }
  if (count === 0) return null;

  // Longest increasing subsequence over the matched second indices.
  const sequence1 = new Int32Array(count);
  const sequence2 = new Int32Array(count);
  const predecessors = new Int32Array(count1).fill(-1);
  let size = 0;
  for (let i = 0; i < count1; i++) {
    if (match[i] === 0) continue;
    let low = 0;
    let high = size;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence1[middle]! < match[i]!) low = middle + 1;
      else high = middle;
    }
    if (low === size || match[i]! < sequence1[low]!) {
      sequence1[low] = match[i]!;
      sequence2[low] = i;
      predecessors[i] = low > 0 ? sequence2[low - 1]! : -1;
      if (low === size) size++;
    }
  }
  const out1 = new Int32Array(size);
  const out2 = new Int32Array(size);
  let index = size - 1;
  for (let i = sequence2[size - 1]!; i !== -1; i = predecessors[i]!) {
    out1[index] = i;
    out2[index] = match[i]! - 1;
    index--;
  }
  return [out1, out2];
}

/** `PatienceIntLCS`: split at unique equal elements, and run linear Myers on
 *  the stretches between anchors. `Diff.doBuildChanges` falls back to this
 *  when Myers gives up, and only throws when this cannot shrink the region. */
class PatienceLcs {
  private readonly changes1: Uint8Array;
  private readonly changes2: Uint8Array;

  constructor(
    private readonly first: readonly number[],
    private readonly second: readonly number[],
    private readonly length1: number,
    private readonly length2: number,
  ) {
    this.changes1 = new Uint8Array(length1);
    this.changes2 = new Uint8Array(length2);
  }

  run(): [Uint8Array, Uint8Array] {
    this.execute(0, this.length1, 0, this.length2, 2);
    return [this.changes1, this.changes2];
  }

  private execute(
    start1: number,
    count1: number,
    start2: number,
    count2: number,
    thresholdCheckCounter: number,
  ): void {
    if (count1 === 0 && count2 === 0) return;
    if (count1 === 0 || count2 === 0) {
      this.addChange(start1, count1, start2, count2);
      return;
    }
    const startOffset = this.matchForward(start1, count1, start2, count2);
    const newStart1 = start1 + startOffset;
    const newStart2 = start2 + startOffset;
    let newCount1 = count1 - startOffset;
    let newCount2 = count2 - startOffset;
    const endOffset = this.matchBackward(newStart1, newCount1, newStart2, newCount2);
    newCount1 -= endOffset;
    newCount2 -= endOffset;
    if (newCount1 === 0 || newCount2 === 0) {
      this.addChange(newStart1, newCount1, newStart2, newCount2);
      return;
    }
    if (thresholdCheckCounter === 0) this.checkReduction(newCount1, newCount2);
    const nextThreshold = Math.max(-1, thresholdCheckCounter - 1);
    const matching = uniqueLcs(this.first, this.second, newStart1, newCount1, newStart2, newCount2);
    if (matching === null) {
      if (nextThreshold >= 0) this.checkReduction(newCount1, newCount2);
      const [changes1, changes2] = new MyersLcs(
        this.first,
        this.second,
        newStart1,
        newCount1,
        newStart2,
        newCount2,
      ).run(false);
      for (let i = 0; i < changes1.length; i++) if (changes1[i]) this.changes1[newStart1 + i] = 1;
      for (let i = 0; i < changes2.length; i++) if (changes2[i]) this.changes2[newStart2 + i] = 1;
      return;
    }

    const matched = matching[0].length;
    if (matched <= 0) throw new Error("patience LCS produced no match");
    this.execute(newStart1, matching[0][0]!, newStart2, matching[1][0]!, nextThreshold);
    for (let i = 1; i < matched; i++) {
      const anchorStart1 = matching[0][i - 1]! + 1;
      const anchorStart2 = matching[1][i - 1]! + 1;
      const anchorCount1 = matching[0][i]! - anchorStart1;
      const anchorCount2 = matching[1][i]! - anchorStart2;
      if (anchorCount1 > 0 || anchorCount2 > 0) {
        this.execute(
          newStart1 + anchorStart1,
          anchorCount1,
          newStart2 + anchorStart2,
          anchorCount2,
          nextThreshold,
        );
      }
    }
    const last1 = matching[0][matched - 1]!;
    const last2 = matching[1][matched - 1]!;
    const ends1 = last1 === newCount1 - 1;
    const ends2 = last2 === newCount2 - 1;
    const tailStart1 = ends1 ? newCount1 - 1 : last1 + 1;
    const tailStart2 = ends2 ? newCount2 - 1 : last2 + 1;
    const tailCount1 = ends1 ? 0 : newCount1 - tailStart1;
    const tailCount2 = ends2 ? 0 : newCount2 - tailStart2;
    this.execute(
      newStart1 + tailStart1,
      tailCount1,
      newStart2 + tailStart2,
      tailCount2,
      nextThreshold,
    );
  }

  private matchForward(start1: number, count1: number, start2: number, count2: number): number {
    const size = Math.min(count1, count2);
    let i = 0;
    while (i < size && this.first[start1 + i] === this.second[start2 + i]) i++;
    return i;
  }

  private matchBackward(start1: number, count1: number, start2: number, count2: number): number {
    const size = Math.min(count1, count2);
    let i = 0;
    while (i < size && this.first[start1 + count1 - i - 1] === this.second[start2 + count2 - i - 1]) i++;
    return i;
  }

  private addChange(start1: number, count1: number, start2: number, count2: number): void {
    this.changes1.fill(1, start1, start1 + count1);
    this.changes2.fill(1, start2, start2 + count2);
  }

  private checkReduction(count1: number, count2: number): void {
    if (count1 * 2 >= this.length1 && count2 * 2 >= this.length2) throw new DiffTooBigError();
  }
}

/** Diff.buildChanges over element ids. */
export function ideaBlocks(a: readonly number[], b: readonly number[]): IdeaBlock[] {
  const startShift = commonPrefix(a, b);
  const endCut = commonSuffix(a, b, startShift);
  const fast = diffFast(a.length, b.length, startShift, endCut);
  if (fast) return fast;

  const trimmed1 = a.slice(startShift, a.length - endCut);
  const trimmed2 = b.slice(startShift, b.length - endCut);
  const blocks: IdeaBlock[] = [];
  let index1 = startShift;
  let index2 = startShift;
  const builder: Builder = {
    markEqual(length) {
      index1 += length;
      index2 += length;
    },
    addChange(deleted, inserted) {
      blocks.push({
        aStart: index1,
        aEnd: index1 + deleted,
        bStart: index2,
        bEnd: index2 + inserted,
      });
      index1 += deleted;
      index2 += inserted;
    },
  };

  const reindexer = new Reindexer();
  const [discarded1, discarded2] = reindexer.discardUnique(trimmed1, trimmed2);
  if (discarded1.length === 0 && discarded2.length === 0) {
    builder.addChange(trimmed1.length, trimmed2.length);
    return blocks;
  }
  let raw1: Uint8Array;
  let raw2: Uint8Array;
  try {
    [raw1, raw2] = new MyersLcs(discarded1, discarded2, 0, discarded1.length, 0, discarded2.length).run();
  } catch (error) {
    if (!(error instanceof DiffTooBigError)) throw error;
    [raw1, raw2] = new PatienceLcs(discarded1, discarded2, discarded1.length, discarded2.length).run();
  }
  const [changes1, changes2] = reindexer.reindex(raw1, raw2);

  let x = 0;
  let y = 0;
  while (x < trimmed1.length && y < trimmed2.length) {
    const startX = x;
    while (x < trimmed1.length && y < trimmed2.length && !changes1[x] && !changes2[y]) {
      x++;
      y++;
    }
    if (x > startX) builder.markEqual(x - startX);
    let dx = 0;
    while (x < trimmed1.length && changes1[x]) {
      dx++;
      x++;
    }
    let dy = 0;
    while (y < trimmed2.length && changes2[y]) {
      dy++;
      y++;
    }
    if (dx !== 0 || dy !== 0) builder.addChange(dx, dy);
  }
  if (x !== trimmed1.length || y !== trimmed2.length) {
    builder.addChange(trimmed1.length - x, trimmed2.length - y);
  }
  return blocks;
}

/** Element ids for a sequence, so structural equality becomes id equality.
 *  Both sides of one diff must share the pool. */
export function elementIds<T>(items: readonly T[], ids = new Map<T, number>()): number[] {
  return items.map((item) => {
    const known = ids.get(item);
    if (known !== undefined) return known;
    const id = ids.size;
    ids.set(item, id);
    return id;
  });
}
