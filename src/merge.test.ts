import { describe, expect, it } from "bun:test";
import {
  computeMerge,
  conflictLabels,
  composeSegments,
  conflictSegments,
  countConflictMarkers,
  diffHunks,
  hasConflictMarkers,
  initialConflictBlocks,
  insertConflictMarkers,
  splitLines,
  resolveSimpleConflicts,
  tryResolveRange,
  type MergeRange,
} from "./merge";

function kinds(ranges: MergeRange[]) {
  return ranges.map((r) => r.kind);
}

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
  it("applies changes from both sides when they touch different lines", () => {
    const model = computeMerge("a\nb\nc\nd\n", "a\nB\nc\nd\n", "a\nb\nc\nD\n");
    expect(kinds(model.ranges)).toEqual(["modified", "modified"]);
    expect(model.result).toBe("a\nB\nc\nD\n");
  });

  it("shows the local side of an unresolved conflict without markers", () => {
    const model = computeMerge("x\ny\nz\n", "x\nO\nz\n", "x\nT\nz\n");
    expect(kinds(model.ranges)).toEqual(["conflict"]);
    expect(model.result).toBe("x\nO\nz\n");
    expect(countConflictMarkers(model.result)).toBe(0);
  });

  it("does not conflict when both sides made the same edit", () => {
    const model = computeMerge("x\ny\nz\n", "x\nN\nz\n", "x\nN\nz\n");
    expect(model.ranges.every((r) => r.kind !== "conflict")).toBe(true);
    expect(model.result).toBe("x\nN\nz\n");
  });

  it("conflicts when both sides insert different text at one point", () => {
    const model = computeMerge("a\n", "a\nO\n", "a\nT\n");
    expect(kinds(model.ranges)).toEqual(["conflict"]);
    expect(model.result).toBe("a\nO\n");
  });

  it("takes a deletion from one side", () => {
    const model = computeMerge("a\nb\nc\n", "a\nc\n", "a\nb\nc\n");
    expect(kinds(model.ranges)).toEqual(["deleted"]);
    expect(model.result).toBe("a\nc\n");
    expect(model.ranges[0]!.ours).toEqual([]);
  });

  it("keeps the trailing-newline style of the inputs", () => {
    expect(computeMerge("a\n", "b\n", "a\n").result).toBe("b\n");
    expect(computeMerge("a", "b", "a").result).toBe("b");
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
    expect(model.result).toBe("1\nTWO\nTHREE\n4\nFIVE\nSIX\n");
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
    expect(model.result).toBe("O\n");
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
      }
    }
  });
});

describe("tryResolveRange", () => {
  it("resolves a whitespace-only conflict when whitespace is ignored", () => {
    const model = computeMerge("a\n", "a \n", "  a\n");
    const range = model.ranges[0]!;
    expect(range.kind).toBe("conflict");
    expect(tryResolveRange(range)).toBeNull();
    expect(tryResolveRange(range, true)).toEqual(["a "]);
  });

  it("attributes each line to the side that changed it", () => {
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

describe("block state", () => {
  const model = computeMerge("a\nb\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n");
  const working = "a\n<<<<<<< HEAD\nOURS\n=======\nTHEIRS\n>>>>>>> dev\nc\n";

  it("keeps the plain text and turns each section into a block", () => {
    const segments = conflictSegments(working)!;
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "conflict", "text"]);
    expect(segments[0]).toEqual({ kind: "text", text: "a\n" });
    expect(segments[2]).toEqual({ kind: "text", text: "c\n" });

    const blocks = initialConflictBlocks(segments, model);
    expect(blocks.get(0)).toMatchObject({
      ours: ["OURS"],
      theirs: ["THEIRS"],
      lines: ["OURS"],
      resolved: false,
      rangeIndex: 0,
    });
    const composed = composeSegments(segments, blocks);
    expect(composed.text).toBe("a\nOURS\nc\n");
    expect(composed.spans).toEqual([{ id: 0, from: 2, to: 7 }]);
  });

  it("shows a saved partial merge as its file, with only open blocks left", () => {
    // The first conflict was accepted and written as plain text; the second
    // still has markers.
    const partial = "a\nOURS\nc\n<<<<<<< HEAD\nX\n=======\nY\n>>>>>>> dev\n";
    const two = computeMerge("a\nb\nc\nd\n", "a\nOURS\nc\nX\n", "a\nOTHER\nc\nY\n");
    const segments = conflictSegments(partial)!;
    const blocks = initialConflictBlocks(segments, two);
    expect(blocks.size).toBe(1);
    expect(blocks.get(0)).toMatchObject({ ours: ["X"], theirs: ["Y"], rangeIndex: 1 });
    expect(composeSegments(segments, blocks).text).toBe("a\nOURS\nc\nX\n");
  });

  it("round-trips a half-resolved file and keeps the settled block settled", () => {
    const two = computeMerge("a\nb\nc\nd\n", "a\nX\nc\nZ\n", "a\nY\nc\nW\n");
    expect(two.ranges.filter((range) => range.kind === "conflict")).toHaveLength(2);
    const full =
      "a\n<<<<<<< HEAD\nX\n=======\nY\n>>>>>>> dev\nc\n<<<<<<< HEAD\nZ\n=======\nW\n>>>>>>> dev\n";
    const segments = conflictSegments(full)!;
    const blocks = initialConflictBlocks(segments, two);
    expect([...blocks.values()].map((block) => block.rangeIndex)).toEqual([0, 1]);

    // Accept the local side of the first block, then save with the second open.
    blocks.set(0, { ...blocks.get(0)!, lines: ["X"], resolved: true });
    const composed = composeSegments(segments, blocks);
    expect(composed.text).toBe("a\nX\nc\nZ\n");
    const open = composed.spans[1]!;
    const saved = insertConflictMarkers(
      composed.text,
      [{ from: open.from, to: open.to, theirs: blocks.get(1)!.theirs }],
      two.labels,
    );
    expect(saved).toBe("a\nX\nc\n<<<<<<< LOCAL\nZ\n=======\nW\n>>>>>>> REMOTE\n");

    // Reopening finds one open block, not two, and keeps the settled text.
    const reopened = conflictSegments(saved)!;
    const again = initialConflictBlocks(reopened, two);
    expect(again.size).toBe(1);
    expect(again.get(0)).toMatchObject({ lines: ["Z"], resolved: false, rangeIndex: 1 });
    expect(composeSegments(reopened, again).text).toBe("a\nX\nc\nZ\n");
  });

  it("writes markers around open blocks and plain text elsewhere", () => {
    const segments = conflictSegments(working)!;
    const composed = composeSegments(segments, initialConflictBlocks(segments, model));
    const marked = insertConflictMarkers(
      composed.text,
      [{ from: 2, to: 7, theirs: ["THEIRS"] }],
      model.labels,
    );
    expect(marked).toBe("a\n<<<<<<< LOCAL\nOURS\n=======\nTHEIRS\n>>>>>>> REMOTE\nc\n");
    expect(conflictSegments(marked)!.filter((segment) => segment.kind === "conflict")).toMatchObject([
      { ours: ["OURS"], base: null, theirs: ["THEIRS"] },
    ]);
  });

  it("keeps the file's newline state at the end", () => {
    const labels = { ours: "LOCAL", theirs: "REMOTE" };
    expect(insertConflictMarkers("a\nX", [{ from: 2, to: 3, theirs: ["Y"] }], labels)).toBe(
      "a\n<<<<<<< LOCAL\nX\n=======\nY\n>>>>>>> REMOTE",
    );
    expect(insertConflictMarkers("a\nX\n", [{ from: 2, to: 4, theirs: ["Y"] }], labels)).toBe(
      "a\n<<<<<<< LOCAL\nX\n=======\nY\n>>>>>>> REMOTE\n",
    );
  });

  it("parses diff3 sections and rejects a block without an end marker", () => {
    expect(conflictSegments("<<<<<<< a\n1\n||||||| base\n2\n=======\n3\n>>>>>>> b\n")).toMatchObject([
      { kind: "conflict", ours: ["1"], base: ["2"], theirs: ["3"] },
    ]);
    expect(conflictSegments("<<<<<<< a\n1\n=======\n2\n")).toBeNull();
  });
});

describe("marker helpers", () => {
  it("reads the labels out of a working file", () => {
    expect(conflictLabels("<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feature\n")).toEqual({
      ours: "HEAD",
      theirs: "feature",
    });
    expect(conflictLabels("plain\n")).toBeNull();
  });

  it("counts opening markers and rejects either marker", () => {
    expect(countConflictMarkers("<<<<<<< x\na\n=======\nb\n>>>>>>> y\n")).toBe(1);
    expect(hasConflictMarkers("<<<<<<< x\n")).toBe(true);
    expect(hasConflictMarkers(">>>>>>> y\n")).toBe(true);
    expect(hasConflictMarkers("a\n=======\nb\n")).toBe(false);
  });
});

describe("resolveSimpleConflicts", () => {
  it("keeps the side that still has text when the other deleted it", () => {
    const model = computeMerge("a\nb\nc\n", "a\nB1\nB2\nc\n", "a\nc\n");
    expect(model.ranges.map((r) => r.kind)).toContain("conflict");
    const simple = resolveSimpleConflicts(model);
    expect(simple.remaining).toBe(0);
    expect(simple.text).toBe("a\nB1\nB2\nc\n");
  });

  it("leaves a real two-sided conflict marked", () => {
    const model = computeMerge("a\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n");
    const simple = resolveSimpleConflicts(model);
    expect(simple.remaining).toBe(1);
    expect(simple.text).toContain("<<<<<<< LOCAL");
    expect(simple.text).toContain("OURS");
    expect(simple.text).toContain("THEIRS");
  });
});
