/**
 * The line diff behind the three-way merge view. It is IntelliJ's own diff
 * engine (`com.intellij.util.diff.Diff`, ported in `ideaDiff.ts`) rather than a
 * plain Myers pass: with repeated lines several alignments are equally short,
 * and only the IDE's tie-breaking pairs the same lines the IDE's merge does.
 * The word-level conflict resolver compares text, not lines, and lives in
 * `wordmerge.ts`.
 */

import { DiffTooBigError, elementIds, ideaBlocks } from "./ideaDiff";

export type DiffOp =
  | { kind: "equal" | "delete"; aStart: number; aEnd: number; bStart: number; bEnd: number }
  | { kind: "insert"; aStart: number; aEnd: number; bStart: number; bEnd: number };

/** How two lines are keyed for the diff: equal keys mean equal lines. */
export type LineKey = (line: string) => string;

const identity: LineKey = (line) => line;

/**
 * Changed and unchanged runs for two line arrays, in the IDE's alignment.
 * A diff too large for the engine becomes one changed run; the merge view
 * still offers both sides, just without inner alignment.
 */
export function lineDiffOps(a: readonly string[], b: readonly string[], key: LineKey = identity): DiffOp[] {
  let blocks;
  try {
    const ids = new Map<string, number>();
    blocks = ideaBlocks(elementIds(a.map(key), ids), elementIds(b.map(key), ids));
  } catch (error) {
    if (!(error instanceof DiffTooBigError)) throw error;
    const ops: DiffOp[] = [];
    if (a.length > 0) ops.push({ kind: "delete", aStart: 0, aEnd: a.length, bStart: 0, bEnd: 0 });
    if (b.length > 0) ops.push({ kind: "insert", aStart: 0, aEnd: 0, bStart: 0, bEnd: b.length });
    return ops;
  }

  const ops: DiffOp[] = [];
  let aIndex = 0;
  let bIndex = 0;
  for (const block of blocks) {
    if (block.aStart > aIndex || block.bStart > bIndex) {
      ops.push({ kind: "equal", aStart: aIndex, aEnd: block.aStart, bStart: bIndex, bEnd: block.bStart });
    }
    if (block.aEnd > block.aStart) {
      ops.push({
        kind: "delete",
        aStart: block.aStart,
        aEnd: block.aEnd,
        bStart: block.bStart,
        bEnd: block.bStart,
      });
    }
    if (block.bEnd > block.bStart) {
      ops.push({
        kind: "insert",
        aStart: block.aEnd,
        aEnd: block.aEnd,
        bStart: block.bStart,
        bEnd: block.bEnd,
      });
    }
    aIndex = block.aEnd;
    bIndex = block.bEnd;
  }
  if (aIndex < a.length || bIndex < b.length) {
    ops.push({ kind: "equal", aStart: aIndex, aEnd: a.length, bStart: bIndex, bEnd: b.length });
  }
  return ops;
}
