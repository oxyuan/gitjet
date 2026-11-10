import { describe, expect, it } from "bun:test";
import { compareAndSplit, getInlineChunks } from "./worddiff";

describe("getInlineChunks", () => {
  it("keeps identifiers whole and drops whitespace and punctuation", () => {
    const chunks = getInlineChunks("foo_bar1 = 你好!");
    expect(chunks.map((chunk) => chunk.key)).toEqual(["foo_bar1", "你", "好"]);
  });

  it("groups accented letters into words and splits continuous scripts", () => {
    const chunks = getInlineChunks("café 世界");
    expect(chunks.map((chunk) => chunk.key)).toEqual(["café", "世", "界"]);
  });

  it("keeps every newline as its own chunk", () => {
    const chunks = getInlineChunks("a\nb\n");
    expect(chunks.map((chunk) => chunk.kind)).toEqual(["word", "newline", "word", "newline"]);
  });
});

describe("compareAndSplit", () => {
  it("highlights only the changed word", () => {
    const [block] = compareAndSplit("const a = 1;", "const b = 1;");
    expect(block?.fragments).toEqual([{ start1: 6, end1: 7, start2: 6, end2: 7 }]);
  });

  it("keeps matched punctuation out of the fragment", () => {
    const [block] = compareAndSplit("foo(a, b)", "foo(a, c)");
    expect(block?.fragments).toEqual([{ start1: 7, end1: 8, start2: 7, end2: 8 }]);
  });

  it("marks only the extra whitespace of a whitespace-only change", () => {
    const [block] = compareAndSplit("x = 1", "x  =  1");
    expect(block?.fragments).toEqual([
      { start1: 1, end1: 1, start2: 1, end2: 2 },
      { start1: 3, end1: 3, start2: 4, end2: 5 },
    ]);
  });

  it("aligns lines by their words across a run with different line counts", () => {
    const blocks = compareAndSplit(
      "foo(a, b);\nresult = compute(x);",
      'foo(a, X);\nlog("inserted");\nresult = compute(x) + 1;',
    );
    // The inserted line joins the first block (its newline is not matched),
    // while the second old line pairs with the third new line.
    expect(blocks.map((block) => [block.start1, block.end1, block.start2, block.end2])).toEqual([
      [0, 11, 0, 28],
      [11, 31, 28, 52],
    ]);
    expect(blocks[1]?.fragments).toEqual([{ start1: 19, end1: 19, start2: 19, end2: 23 }]);
  });

  it("splits continuous scripts into comparable characters", () => {
    const [block] = compareAndSplit("你好世界", "你好朋友");
    expect(block?.fragments).toEqual([{ start1: 2, end1: 4, start2: 2, end2: 4 }]);
  });
});
