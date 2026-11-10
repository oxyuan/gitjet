/**
 * IntelliJ's diff engine, ported from `com.intellij.util.diff.Diff` (Reindexer +
 * MyersLCS + change assembly). The word merge compares words, newlines and
 * punctuation at a granularity where many alignments are equally valid, and
 * only the engine's own tie-breaking reproduces the IDE's merge results.
 *
 * Inputs are element ids; equal ids mean equal elements. Outputs are the
 * changed blocks, which is all the diff iterables need.
 */

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

  run(): [Uint8Array, Uint8Array] {
    const threshold = Math.max(20000 + 10 * Math.sqrt(this.count1 + this.count2), 20000);
    this.execute(0, this.count1, 0, this.count2, Math.min(threshold, this.count1 + this.count2));
    return [this.changes1, this.changes2];
  }

  private execute(
    oldStart: number,
    oldEnd: number,
    newStart: number,
    newEnd: number,
    differenceEstimate: number,
  ): void {
    if (oldStart >= oldEnd || newStart >= newEnd) return;
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
      if (xx > 0 && split > 0) this.execute(oldStart, oldStart + xx, newStart, newStart + split, oldDiff);
      if (oldStart + xx < oldEnd && newStart + split < newEnd) {
        this.execute(oldStart + xx, oldEnd, newStart + split, newEnd, td - oldDiff);
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
    }
  }

  private addUnchanged(start1: number, start2: number, count: number): void {
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
  const lcs = new MyersLcs(discarded1, discarded2, 0, discarded1.length, 0, discarded2.length);
  const [raw1, raw2] = lcs.run();
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
