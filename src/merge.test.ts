import { describe, expect, it } from "bun:test";
import {
  computeMerge,
  conflictLabels,
  countConflictMarkers,
  diffHunks,
  hasConflictMarkers,
  splitLines,
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
    expect(model.placements).toHaveLength(2);
  });

  it("marks the same line changed on both sides as a conflict", () => {
    const model = computeMerge("x\ny\nz\n", "x\nO\nz\n", "x\nT\nz\n");
    expect(kinds(model.ranges)).toEqual(["conflict"]);
    expect(model.result).toBe("x\n<<<<<<< LOCAL\nO\n=======\nT\n>>>>>>> REMOTE\nz\n");
    expect(countConflictMarkers(model.result)).toBe(1);
  });

  it("does not conflict when both sides made the same edit", () => {
    const model = computeMerge("x\ny\nz\n", "x\nN\nz\n", "x\nN\nz\n");
    expect(model.ranges.every((r) => r.kind !== "conflict")).toBe(true);
    expect(model.result).toBe("x\nN\nz\n");
  });

  it("conflicts when both sides insert different text at one point", () => {
    const model = computeMerge("a\n", "a\nO\n", "a\nT\n");
    expect(kinds(model.ranges)).toEqual(["conflict"]);
    expect(model.result).toContain("<<<<<<< LOCAL\nO\n=======\nT\n>>>>>>> REMOTE");
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

  it("places each conflict block on its marker lines", () => {
    const model = computeMerge("x\ny\nz\n", "x\nO\nz\n", "x\nT\nz\n");
    const placement = model.placements[0]!;
    const lines = model.result.split("\n");
    expect(lines[placement.startLine]).toBe("<<<<<<< LOCAL");
    expect(lines[placement.endLine - 1]).toBe(">>>>>>> REMOTE");
    expect(hasConflictMarkers(model.result)).toBe(true);
  });

  it("uses marker labels when they are supplied", () => {
    const model = computeMerge("x\n", "O\n", "T\n", {
      labels: { ours: "main", theirs: "feature" },
    });
    expect(model.result).toBe("<<<<<<< main\nO\n=======\nT\n>>>>>>> feature\n");
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
