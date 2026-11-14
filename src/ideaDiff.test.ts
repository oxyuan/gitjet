import { describe, expect, it } from "bun:test";
import { elementIds, ideaBlocks } from "./ideaDiff";

/** Expectations are `com.intellij.util.diff.Diff.buildChanges` output for the
 *  same element ids, so the tie-breaking is the IDE's own. */
describe("ideaBlocks", () => {
  const blocks = (a: number[], b: number[]) =>
    ideaBlocks(a, b).map((x) => [x.aStart, x.aEnd, x.bStart, x.bEnd]);

  it("reports the changed middle of two equal ends", () => {
    expect(blocks([0, 1, 2], [0, 3, 2])).toEqual([[1, 2, 1, 2]]);
    expect(blocks([1, 2, 3], [1, 2, 3])).toEqual([]);
  });

  it("handles one side empty", () => {
    expect(blocks([], [1, 2])).toEqual([[0, 0, 0, 2]]);
  });

  it("drops elements the other side cannot match", () => {
    expect(blocks([1, 2, 3], [4, 2, 5])).toEqual([
      [0, 1, 0, 1],
      [2, 3, 2, 3],
    ]);
    expect(blocks([0, 1, 2, 3], [0, 2, 3])).toEqual([[1, 2, 1, 1]]);
  });

  it("aligns repeated elements the way the IDE does", () => {
    expect(blocks([0, 0], [0])).toEqual([[1, 2, 1, 1]]);
    expect(blocks([0], [0, 0])).toEqual([[1, 1, 1, 2]]);
  });

  it("falls back to the patience pass when Myers hits its threshold", () => {
    // Values are the IDE's Diff.buildChanges output for the same ids: Myers
    // gives up on the scattered noise, Patience splits it at the shared unique
    // anchors, and the result keeps far more unchanged stretches than the
    // all-changed block a coarse fallback would produce.
    const sequence = (seed: number): number[] => {
      let state = seed;
      const next = (bound: number) => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return (state >>> 8) % bound;
      };
      const out: number[] = [];
      for (let i = 0; i < 22000; i++) {
        out.push(i !== 0 && i % 500 === 0 ? 1000 + i / 500 : next(60));
      }
      return out;
    };
    const blocks = ideaBlocks(sequence(1), sequence(2));
    expect(blocks.length).toBe(4629);
    expect(blocks.slice(0, 3)).toEqual([
      { aStart: 0, aEnd: 8, bStart: 0, bEnd: 6 },
      { aStart: 9, aEnd: 16, bStart: 7, bEnd: 11 },
      { aStart: 17, aEnd: 21, bStart: 12, bEnd: 12 },
    ]);
    expect(blocks.slice(-2)).toEqual([
      { aStart: 21987, aEnd: 21997, bStart: 21989, bEnd: 21989 },
      { aStart: 21998, aEnd: 22000, bStart: 21990, bEnd: 22000 },
    ]);
  });

  it("keeps the ids of both sides in one pool", () => {
    const pool = new Map<string, number>();
    expect(elementIds(["a", "b"], pool)).toEqual([0, 1]);
    expect(elementIds(["b", "c"], pool)).toEqual([1, 2]);
  });
});
