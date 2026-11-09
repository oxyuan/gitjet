import { describe, expect, it } from "bun:test";
import {
  blockText,
  buildMergeView,
  computeMerge,
  conflictLabels,
  diffHunks,
  needsSideChoice,
  splitLines,
  resolveSimpleConflicts,
  tryResolveRange,
  type MergeRange,
} from "./merge";

function kinds(ranges: MergeRange[]) {
  return ranges.map((r) => r.kind);
}

describe("needsSideChoice", () => {
  const text = { binary: false, kind: "file", hasOurs: true, hasTheirs: true };

  it("leaves an ordinary text conflict to the editor", () => {
    expect(needsSideChoice(text)).toBe(false);
  });

  it("asks for a side when a stage is missing or the path is not text", () => {
    expect(needsSideChoice({ ...text, hasOurs: false })).toBe(true);
    expect(needsSideChoice({ ...text, hasTheirs: false })).toBe(true);
    expect(needsSideChoice({ ...text, kind: "symlink" })).toBe(true);
    expect(needsSideChoice({ ...text, kind: "submodule" })).toBe(true);
    expect(needsSideChoice({ ...text, binary: true })).toBe(true);
  });
});

describe("splitLines", () => {
  it("keeps the trailing newline out of the line list", () => {
    expect(splitLines("a\nb\n")).toEqual({ lines: ["a", "b"], trailingNewline: true });
    expect(splitLines("a\nb")).toEqual({ lines: ["a", "b"], trailingNewline: false });
    expect(splitLines("")).toEqual({ lines: [], trailingNewline: false });
  });
});

describe("diffHunks", () => {
  it("finds one changed region for a replaced line", () => {
    expect(diffHunks(["a", "b", "c"], ["a", "B", "c"])).toEqual([
      { baseStart: 1, baseEnd: 2, sideStart: 1, sideEnd: 2 },
    ]);
  });

  it("keeps insertions and deletions at their base position", () => {
    expect(diffHunks(["a", "c"], ["a", "b", "c"])).toEqual([
      { baseStart: 1, baseEnd: 1, sideStart: 1, sideEnd: 2 },
    ]);
    expect(diffHunks(["a", "b", "c"], ["a", "c"])).toEqual([
      { baseStart: 1, baseEnd: 2, sideStart: 1, sideEnd: 1 },
    ]);
  });

  it("does not invent hunks for equal input", () => {
    expect(diffHunks(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("aligns hunks so every unchanged stretch matches both sides", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let round = 0; round < 200; round++) {
      const base = Array.from({ length: 1 + Math.floor(random() * 12) }, () =>
        String.fromCharCode(97 + Math.floor(random() * 5)),
      );
      const side = base.filter(() => random() > 0.2);
      const insertAt = Math.floor(random() * (side.length + 1));
      if (random() > 0.4) side.splice(insertAt, 0, "x");
      if (random() > 0.5 && side.length > 0) side[Math.floor(random() * side.length)] = "y";

      let b = 0;
      let s = 0;
      for (const h of diffHunks(base, side)) {
        const unchanged = h.baseStart - b;
        expect(side.slice(s, s + unchanged)).toEqual(base.slice(b, h.baseStart));
        b = h.baseEnd;
        s += unchanged + (h.sideEnd - h.sideStart);
      }
      expect(side.slice(s)).toEqual(base.slice(b));
    }
  });
});

describe("computeMerge", () => {
  it("starts the result from the merge base, not from one side", () => {
    const model = computeMerge("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n");
    expect(kinds(model.ranges)).toEqual(["modified", "modified"]);
    expect(model.result).toBe("a\nb\nc\nd\n");
    expect(model.ranges.map((r) => [r.oursChanged, r.theirsChanged])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("keeps a range both sides edit the same way settled, not conflicting", () => {
    const model = computeMerge("x\ny\nz\n", "x\nN\nz\n", "x\nN\nz\n");
    expect(kinds(model.ranges)).toEqual(["modified"]);
    expect(model.ranges[0]).toMatchObject({ oursChanged: true, theirsChanged: true });
    expect(model.result).toBe("x\ny\nz\n");
  });

  it("conflicts when both sides insert different text at one point", () => {
    const model = computeMerge("a\n", "a\nO\n", "a\nT\n");
    expect(kinds(model.ranges)).toEqual(["conflict"]);
    expect(model.result).toBe("a\n");
    expect(model.ranges[0]).toMatchObject({ base: [], ours: ["O"], theirs: ["T"] });
  });

  it("marks a deletion as owned by the side that made it", () => {
    const model = computeMerge("a\nb\nc\n", "a\nc\n", "a\nb\nc\n");
    expect(kinds(model.ranges)).toEqual(["deleted"]);
    expect(model.ranges[0]).toMatchObject({ ours: [], oursChanged: true, theirsChanged: false });
    expect(model.result).toBe("a\nb\nc\n");
  });

  it("merges edits that touch into one range, and keeps apart what a line separates", () => {
    // The IDE takes a range to be the gap between two stretches unchanged in
    // both versions, so adjacent edits share a range and conflict.
    const touching = computeMerge("A1\nA2\nA3\nA4\n", "O1\nA2\nA3\nA4\n", "A1\nT2\nA3\nA4\n");
    expect(touching.ranges.map((r) => [r.kind, r.baseStart, r.baseEnd])).toEqual([["conflict", 0, 2]]);

    const apart = computeMerge("A1\nA2\nA3\nA4\n", "O1\nA2\nA3\nA4\n", "A1\nA2\nT3\nA4\n");
    expect(apart.ranges.map((r) => [r.kind, r.baseStart, r.baseEnd])).toEqual([
      ["modified", 0, 1],
      ["modified", 2, 3],
    ]);
  });

  it("keeps the trailing-newline style of the inputs", () => {
    expect(computeMerge("a\n", "b\n", "a\n").result).toBe("a\n");
    expect(computeMerge("a", "b", "a").result).toBe("a");
  });

  it("keeps every range's side slices equal to its arrays", () => {
    const model = computeMerge(
      "1\n2\n3\n4\n5\n6\n",
      "1\nTWO\n3\n4\nFIVE\n6\n",
      "1\n2\nTHREE\n4\n5\nSIX\n",
    );
    for (const r of model.ranges) {
      expect(model.oursLines.slice(r.oursStart, r.oursEnd)).toEqual(r.ours);
      expect(model.theirsLines.slice(r.theirsStart, r.theirsEnd)).toEqual(r.theirs);
      expect(model.baseLines.slice(r.baseStart, r.baseEnd)).toEqual(r.base);
    }
    expect(model.result).toBe("1\n2\n3\n4\n5\n6\n");
  });

  it("can compare whitespace-insensitively", () => {
    const exact = computeMerge("a\n", "a \n", "a\t\n");
    expect(exact.ranges.some((range) => range.kind === "conflict")).toBe(true);
    const loose = computeMerge("a\n", "a \n", "a\t\n", { ignoreWhitespace: true });
    expect(loose.ranges.every((range) => range.kind !== "conflict")).toBe(true);
  });

  it("keeps the supplied labels on the model, not in the result", () => {
    const model = computeMerge("x\n", "O\n", "T\n", {
      labels: { ours: "main", theirs: "feature" },
    });
    expect(model.labels).toEqual({ ours: "main", theirs: "feature" });
    expect(model.result).toBe("x\n");
  });

  it("keeps every range aligned through random edits", () => {
    let seed = 19;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const mutate = (lines: string[]) => {
      const next = [...lines];
      const edits = 1 + Math.floor(random() * 4);
      for (let i = 0; i < edits; i++) {
        const at = Math.floor(random() * (next.length + 1));
        if (random() < 0.35) next.splice(at, 0, `n${Math.floor(random() * 9)}`);
        else if (random() < 0.6 && next.length > 0) next.splice(Math.min(at, next.length - 1), 1);
        else if (next.length > 0) next[Math.min(at, next.length - 1)] = `m${Math.floor(random() * 9)}`;
      }
      return next;
    };
    for (let round = 0; round < 100; round++) {
      const base = Array.from({ length: 1 + Math.floor(random() * 16) }, () =>
        String.fromCharCode(97 + Math.floor(random() * 4)),
      );
      const ours = mutate(base);
      const theirs = mutate(base);
      const model = computeMerge(`${base.join("\n")}\n`, `${ours.join("\n")}\n`, `${theirs.join("\n")}\n`);
      let previousEnd = 0;
      for (const range of model.ranges) {
        expect(range.baseStart).toBeGreaterThanOrEqual(previousEnd);
        expect(range.baseEnd).toBeGreaterThanOrEqual(range.baseStart);
        previousEnd = range.baseEnd;
        expect(model.baseLines.slice(range.baseStart, range.baseEnd)).toEqual(range.base);
        expect(model.oursLines.slice(range.oursStart, range.oursEnd)).toEqual(range.ours);
        expect(model.theirsLines.slice(range.theirsStart, range.theirsEnd)).toEqual(range.theirs);
        // A range with content on neither side would not be a change.
        expect(range.base.length + range.ours.length + range.theirs.length).toBeGreaterThan(0);
        // Two changes in one range always meet inside it.
        if (range.kind === "conflict") {
          expect(range.oursChanged && range.theirsChanged).toBe(true);
          expect(range.ours).not.toEqual(range.theirs);
        }
      }
    }
  });
});

describe("tryResolveRange", () => {
  it("resolves a whitespace-only conflict", () => {
    const model = computeMerge("a\n", "a \n", "  a\n");
    const range = model.ranges[0]!;
    expect(range.kind).toBe("conflict");
    expect(tryResolveRange(range)).toEqual(["  a "]);
  });

  it("merges a conflict whose sides edited different words of one line", () => {
    const model = computeMerge("x = 1\n", "x = 2\n", "y = 1\n");
    const range = model.ranges[0]!;
    expect(range.kind).toBe("conflict");
    expect(tryResolveRange(range)).toEqual(["y = 2"]);
  });

  it("takes each side's line when the other left it alone", () => {
    const range: MergeRange = {
      index: 0,
      kind: "conflict",
      baseStart: 0,
      baseEnd: 2,
      oursStart: 0,
      oursEnd: 2,
      theirsStart: 0,
      theirsEnd: 2,
      oursChanged: true,
      theirsChanged: true,
      base: ["a", "b"],
      ours: ["A", "b"],
      theirs: ["a", "B"],
    };
    expect(tryResolveRange(range)).toEqual(["A", "B"]);
    const bothChangedSameLine: MergeRange = {
      ...range,
      base: ["a"],
      ours: ["A"],
      theirs: ["B"],
    };
    expect(tryResolveRange(bothChangedSameLine)).toBeNull();
  });
});

describe("buildMergeView", () => {
  it("starts from the base with every range undecided", () => {
    const model = computeMerge("a\nb\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n");
    const view = buildMergeView(model);
    expect(view.text).toBe("a\nb\nc\n");
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({ index: 0, lines: ["b"], resolved: false, from: 2, to: 4 });
  });

  it("gives a one-sided change its own undecided block", () => {
    const model = computeMerge("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n");
    const view = buildMergeView(model);
    expect(view.text).toBe("a\nb\nc\nd\n");
    expect(view.blocks.map((block) => block.lines)).toEqual([["b"], ["d"]]);
    expect(view.blocks.every((block) => !block.resolved)).toBe(true);
    for (const block of view.blocks) {
      expect(splitLines(view.text.slice(block.from, block.to)).lines).toEqual(block.lines);
    }
  });

  it("keeps an empty conflict as an insertion point", () => {
    const model = computeMerge("a\nc\n", "a\nO\nc\n", "a\nT\nc\n");
    const view = buildMergeView(model);
    expect(view.text).toBe("a\nc\n");
    expect(view.blocks[0]).toMatchObject({ lines: [], resolved: false });
    expect(view.blocks[0]!.from).toBe(view.blocks[0]!.to);
  });

  it("spans each block with the result's own character offsets", () => {
    const model = computeMerge("a\nb\nc\n", "a\nX\nc\n", "a\nY\nc\n");
    const block = buildMergeView(model).blocks[0]!;
    expect(block.lines).toEqual(["b"]);
    expect(block.to - block.from).toBe("b\n".length);
  });
});

describe("blockText", () => {
  it("keeps the newline that makes an empty final line exist", () => {
    const doc = "a\nA\nB\n\ntail\n";
    expect(blockText(doc, { from: 2, to: 7 }, ["A", "B", ""])).toBe("A\nB\n\n");
  });

  it("deletes the block for an empty line list", () => {
    expect(blockText("a\nb\nc\n", { from: 2, to: 4 }, [])).toBe("");
  });

  it("adds a line break when inserting at a line boundary", () => {
    expect(blockText("a\nc\n", { from: 2, to: 2 }, ["b"])).toBe("b\n");
  });

  it("inserts at the end of a file without a trailing newline", () => {
    expect(blockText("a\nb", { from: 3, to: 3 }, ["c"])).toBe("\nc");
    expect(blockText("a\nb\n", { from: 4, to: 4 }, ["c"])).toBe("c\n");
  });

  it("does not add a newline to the last line of a file that has none", () => {
    expect(blockText("a\nb", { from: 2, to: 3 }, ["B"])).toBe("B");
  });

  it("keeps the empty last line of a block when a side is applied", () => {
    const base = "void load();\n}, [load]);\n\nuseEffect(() => {\n};\n";
    const ours = "// changed 7\n}, [load]);\n\nuseEffect(() => {\n};\n";
    const theirs = "// changed 6\nuseEffect(() => {\n};\n";
    const model = computeMerge(base, ours, theirs);
    const view = buildMergeView(model);
    const block = view.blocks[0]!;
    const replace = (lines: string[]) =>
      view.text.slice(0, block.from) + blockText(view.text, block, lines) + view.text.slice(block.to);
    expect(replace(model.ranges[0]!.base)).toBe(view.text);
    expect(replace(model.ranges[0]!.ours)).toBe("// changed 7\n}, [load]);\n\nuseEffect(() => {\n};\n");
    expect(replace(model.ranges[0]!.theirs)).toBe("// changed 6\nuseEffect(() => {\n};\n");
  });
});
