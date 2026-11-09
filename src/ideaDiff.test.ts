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

  it("keeps the ids of both sides in one pool", () => {
    const pool = new Map<string, number>();
    expect(elementIds(["a", "b"], pool)).toEqual([0, 1]);
    expect(elementIds(["b", "c"], pool)).toEqual([1, 2]);
  });
});
