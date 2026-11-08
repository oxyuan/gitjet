import { describe, expect, it } from "bun:test";
import {
  blockText,
  buildMergeView,
  computeMerge,
  conflictLabels,
  conflictSegments,
  countConflictMarkers,
  diffHunks,
  hasConflictMarkers,
  ignoreRangeLines,
  insertConflictMarkers,
  resetRangeLines,
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

describe("buildMergeView", () => {
  const model = computeMerge("a\nb\nc\n", "a\nOURS\nc\n", "a\nTHEIRS\nc\n");
  const working = "a\n<<<<<<< HEAD\nOURS\n=======\nTHEIRS\n>>>>>>> dev\nc\n";

  it("keeps the plain text and opens each conflict range", () => {
    const segments = conflictSegments(working)!;
    expect(segments.map((segment) => segment.kind)).toEqual(["text", "conflict", "text"]);
    expect(segments[0]).toEqual({ kind: "text", text: "a\n" });
    expect(segments[2]).toEqual({ kind: "text", text: "c\n" });

    const view = buildMergeView(model, working);
    expect(view.open).toEqual([0]);
    expect(view.blocks).toHaveLength(1);
    expect(view.blocks[0]).toMatchObject({ index: 0, lines: ["OURS"], resolved: false, from: 2, to: 7 });
    expect(view.text).toBe("a\nOURS\nc\n");
  });

  it("gives every changed range a span in the result", () => {
    const base = "a\nb\nc\nd\n";
    const ours = "a\nB\nc\nd\n";
    const theirs = "a\nb\nc\nD\n";
    const mixed = computeMerge(base, ours, theirs);
    const view = buildMergeView(mixed, "a\nB\nc\nD\n");
    expect(view.blocks.map((block) => block.index)).toEqual([0, 1]);
    expect(view.text).toBe("a\nB\nc\nD\n");
    for (const block of view.blocks) {
      expect(splitLines(view.text.slice(block.from, block.to)).lines).toEqual(block.lines);
      expect(block.resolved).toBe(true);
    }
  });

  it("keeps a section open when every change inside it is one-sided", () => {
    // git stopped on adjacent lines (no unchanged line between them) and wrote
    // one section; the three-way model sees two one-sided changes. Auto-merging
    // both would decide a region git asked the reader about.
    const merged = computeMerge("a\nb\nc\n", "a\nB\nc\n", "a\nb\nC\n");
    expect(kinds(merged.ranges)).toEqual(["modified", "modified"]);
    const working = "a\n<<<<<<< HEAD\nB\nc\n||||||| base\nb\nc\n=======\nb\nC\n>>>>>>> other\n";
    const view = buildMergeView(merged, working);
    expect(view.open).toEqual([0, 1]);
    expect(view.text).toBe("a\nB\nC\n");
    expect(view.blocks.every((block) => !block.resolved)).toBe(true);
  });

  it("keeps a conflict open when its markers cannot be read", () => {
    // A document that itself starts a line with the opening marker makes the
    // section boundaries ambiguous. Guessing "already resolved" there staged a
    // file still full of markers, so the whole file stays open instead.
    const merged = computeMerge("x\n", "<<<<<<< marker\n", "y\n", { labels: { ours: "HEAD", theirs: "other" } });
    const working = "<<<<<<< HEAD\n<<<<<<< marker\n=======\ny\n>>>>>>> other\n";
    expect(conflictSegments(working)).toBeNull();
    const view = buildMergeView(merged, working);
    expect(view.open).toEqual([0]);
    expect(view.text).toBe("<<<<<<< marker\n");
  });

  it("keeps a conflict open when a section holds a marker-shaped line", () => {
    // "=======" is also a Markdown setext underline, and inside a section it
    // cannot be told apart from the separator.
    const merged = computeMerge("title\nbody\n", "title\n=======\nbody\n", "title\nBODY\n", {
      labels: { ours: "HEAD", theirs: "other" },
    });
    const working = "title\n<<<<<<< HEAD\n=======\nbody\n=======\nBODY\n>>>>>>> other\n";
    expect(conflictSegments(working)).toBeNull();
    const view = buildMergeView(merged, working);
    expect(view.open).toEqual([0]);
    expect(view.text).toBe("title\n=======\nbody\n");
  });

  it("auto-merges the one-sided changes Git grouped into a conflict", () => {
    // Git's section covers b..d, but only b is a real conflict: ours changed c
    // and theirs changed d, so the merged result must keep both.
    const base = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const ours = "a\nb2\nc2\nd\ne\nF\ng\nh\n";
    const theirs = "a\nB\nc\nD\ne\nf\ng\nh\n";
    const working = "a\n<<<<<<< HEAD\nb2\nc2\nd\n=======\nB\nc\nD\n>>>>>>> feature\ne\nF\ng\nh\n";
    const merged = computeMerge(base, ours, theirs);
    const view = buildMergeView(merged, working);
    expect(view.open).toEqual([0]);
    expect(view.blocks.map((block) => [block.index, block.resolved, block.lines])).toEqual([
      [0, false, ["b2", "c2"]],
      [1, true, ["D"]],
      [2, true, ["F"]],
    ]);
    expect(view.text).toBe("a\nb2\nc2\nD\ne\nF\ng\nh\n");
  });

  it("reopens a half-resolved file with the settled range closed", () => {
    const two = computeMerge("a\nb\nc\nd\n", "a\nX\nc\nZ\n", "a\nY\nc\nW\n");
    expect(two.ranges.filter((range) => range.kind === "conflict")).toHaveLength(2);
    const full =
      "a\n<<<<<<< HEAD\nX\n=======\nY\n>>>>>>> dev\nc\n<<<<<<< HEAD\nZ\n=======\nW\n>>>>>>> dev\n";
    const initial = buildMergeView(two, full);
    expect(initial.open).toEqual([0, 1]);

    // Accept the right side of the first conflict, then save with the second
    // one still marked, exactly as the pane does.
    const first = initial.blocks[0]!;
    const replacement = "Y\n";
    const edited = initial.text.slice(0, first.from) + replacement + initial.text.slice(first.to);
    const delta = replacement.length - (first.to - first.from);
    const second = initial.blocks[1]!;
    const saved = insertConflictMarkers(
      edited,
      [{ from: second.from + delta, to: second.to + delta, theirs: two.ranges[1]!.theirs }],
      two.labels,
    );
    expect(saved).toBe("a\nY\nc\n<<<<<<< LOCAL\nZ\n=======\nW\n>>>>>>> REMOTE\n");

    const reopened = buildMergeView(two, saved);
    expect(reopened.open).toEqual([1]);
    expect(reopened.blocks[0]).toMatchObject({ lines: ["Y"], resolved: true });
    expect(reopened.blocks[1]).toMatchObject({ lines: ["Z"], resolved: false });
    expect(reopened.text).toBe("a\nY\nc\nZ\n");
  });

  it("treats a file without markers as already resolved", () => {
    const two = computeMerge("a\nb\n", "a\nX\n", "a\nY\n");
    const view = buildMergeView(two, "a\nY\n");
    expect(view.open).toEqual([]);
    expect(view.blocks.every((block) => block.resolved)).toBe(true);
    expect(view.text).toBe("a\nY\n");
  });

  it("keeps an empty conflict range as an insertion point", () => {
    const model = computeMerge("a\nb\nc\n", "a\nc\n", "a\nB\nc\n");
    const working = "a\n<<<<<<< HEAD\n=======\nB\n>>>>>>> dev\nc\n";
    const view = buildMergeView(model, working);
    expect(view.open).toEqual([0]);
    expect(view.text).toBe("a\nc\n");
    const block = view.blocks[0]!;
    expect(block.from).toBe(block.to);
    expect(
      insertConflictMarkers(
        view.text,
        [{ from: block.from, to: block.to, theirs: model.ranges[0]!.theirs }],
        model.labels,
      ),
    ).toBe("a\n<<<<<<< LOCAL\n=======\nB\n>>>>>>> REMOTE\nc\n");
  });

  it("finds a conflict when zdiff3 pulled shared lines out of the section", () => {
    // zdiff3 leaves the common suffix (`m1`) outside the markers, so the
    // section's body is narrower than the conflict range.
    const base = "a\nc\nb\nb\n";
    const ours = "a\nc\nb\nm1\n";
    const theirs = "a\nc\nm4\nm1\n";
    const zdiff3 = "a\nc\n<<<<<<< HEAD\nb\n||||||| base\nb\nb\n=======\nm4\n>>>>>>> dev\nm1\n";
    const view = buildMergeView(computeMerge(base, ours, theirs), zdiff3);
    expect(view.open).toEqual([0]);
    expect(view.blocks[0]).toMatchObject({ lines: ["b", "m1"], resolved: false });
    expect(view.text).toBe("a\nc\nb\nm1\n");
  });

  it("keeps text the reader typed into a resolved range", () => {
    const two = computeMerge("a\nb\nc\n", "a\nX\nc\n", "a\nY\nc\n");
    const view = buildMergeView(two, "a\nCUSTOM\nc\n");
    expect(view.open).toEqual([]);
    expect(view.blocks[0]).toMatchObject({ lines: ["CUSTOM"], resolved: true });
    expect(view.text).toBe("a\nCUSTOM\nc\n");
  });

  it("writes markers around open blocks and plain text elsewhere", () => {
    const view = buildMergeView(model, working);
    const block = view.blocks[0]!;
    const marked = insertConflictMarkers(
      view.text,
      [{ from: block.from, to: block.to, theirs: model.ranges[0]!.theirs }],
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

  it("keeps the empty last line of a conflict block when the other side is applied", () => {
    const base = "void load();\n}, [load]);\n\nuseEffect(() => {\n};\n";
    const ours = "// changed 7\n}, [load]);\n\nuseEffect(() => {\n};\n";
    const theirs = "// changed 6\nuseEffect(() => {\n};\n";
    const working =
      "<<<<<<< HEAD\n// changed 7\n}, [load]);\n\n||||||| base\nvoid load();\n}, [load]);\n\n=======\n// changed 6\n>>>>>>> dev\nuseEffect(() => {\n};\n";
    const model = computeMerge(base, ours, theirs);
    const view = buildMergeView(model, working);
    const block = view.blocks[0]!;
    const replace = (lines: string[]) =>
      view.text.slice(0, block.from) + blockText(view.text, block, lines) + view.text.slice(block.to);
    expect(replace(model.ranges[0]!.ours)).toBe(view.text);
    expect(replace(model.ranges[0]!.theirs)).toBe("// changed 6\nuseEffect(() => {\n};\n");
  });
});

describe("ignoreRangeLines", () => {
  const range = (kind: MergeRange["kind"], overrides: Partial<MergeRange> = {}): MergeRange => ({
    index: 0,
    kind,
    baseStart: 0,
    baseEnd: 1,
    oursStart: 0,
    oursEnd: 1,
    theirsStart: 0,
    theirsEnd: 1,
    oursChanged: kind === "conflict",
    theirsChanged: kind === "conflict",
    base: ["b"],
    ours: ["O"],
    theirs: ["T"],
    ...overrides,
  });

  it("keeps the other side when both sides changed the range", () => {
    const conflict = range("conflict");
    expect(ignoreRangeLines(conflict, "ours")).toEqual(["T"]);
    expect(ignoreRangeLines(conflict, "theirs")).toEqual(["O"]);
  });

  it("brings the base back when only the ignored side changed", () => {
    const oursOnly = range("modified", { oursChanged: true, theirsChanged: false, theirs: ["b"] });
    expect(ignoreRangeLines(oursOnly, "ours")).toEqual(["b"]);
    const theirsOnly = range("modified", { oursChanged: false, theirsChanged: true, ours: ["b"] });
    expect(ignoreRangeLines(theirsOnly, "theirs")).toEqual(["b"]);
  });

  it("ignoring an added side empties the range", () => {
    const added = range("inserted", {
      oursChanged: false,
      theirsChanged: true,
      base: [],
      baseEnd: 0,
      ours: [],
      oursEnd: 0,
      theirs: ["T"],
    });
    expect(ignoreRangeLines(added, "theirs")).toEqual([]);
  });
});

describe("resetRangeLines", () => {
  it("reopens a conflict with the local side", () => {
    const model = computeMerge("a\nbase\n", "a\nours\n", "a\ntheirs\n");
    const conflict = model.ranges.find((r) => r.kind === "conflict")!;
    expect(resetRangeLines(conflict)).toEqual({ lines: ["ours"], resolved: false });
  });

  it("reverts a decided change to the merge base", () => {
    const model = computeMerge("a\nbase\nc\nlast\n", "a\nBASE\nc\nlast\n", "a\nbase\nc\nLAST\n");
    const oursRange = model.ranges.find((r) => r.oursChanged && r.kind !== "conflict")!;
    expect(resetRangeLines(oursRange)).toEqual({ lines: ["base"], resolved: true });
  });

  it("removes an added block when reverted", () => {
    const model = computeMerge("a\nb\n", "a\nnew\nb\n", "a\nb\n");
    const added = model.ranges.find((r) => r.kind === "inserted")!;
    expect(resetRangeLines(added)).toEqual({ lines: [], resolved: true });
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
