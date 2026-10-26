import { describe, expect, it } from "bun:test";
import { alignLines, assembleForFree, assembleMerge, parseConflicts } from "./merge";

const file = [
  "line1",
  "<<<<<<< HEAD",
  "A1",
  "A2",
  "=======",
  "B1",
  ">>>>>>> feature",
  "line3",
  "line4",
  "<<<<<<< HEAD",
  "C1",
  "=======",
  "C2",
  ">>>>>>> other",
  "line5",
].join("\n");

describe("parseConflicts", () => {
  it("reads two conflict blocks and the text between them", () => {
    const parsed = parseConflicts(file);
    const conflicts = parsed.segments.filter((s) => s.kind === "conflict");
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]).toMatchObject({
      ours: ["A1", "A2"],
      theirs: ["B1"],
      label: "HEAD",
      endLabel: "feature",
    });
    expect(conflicts[1]).toMatchObject({ ours: ["C1"], theirs: ["C2"], label: "HEAD", endLabel: "other" });
    expect(parsed.trailingNewline).toBe(false);
    expect(parsed.segments[0]).toEqual({ kind: "text", text: "line1" });
  });

  it("keeps the common ancestor of diff3 markers", () => {
    const parsed = parseConflicts("<<<<<<< ours\nx\n||||||| base\ny\n=======\nz\n>>>>>>> theirs\n");
    const conflict = parsed.segments[0];
    expect(conflict?.kind).toBe("conflict");
    if (conflict?.kind === "conflict") {
      expect(conflict.base).toEqual(["y"]);
    }
    expect(parsed.trailingNewline).toBe(true);
  });
});

describe("assembleMerge", () => {
  it("joins text and chosen block results", () => {
    const parsed = parseConflicts(file);
    const result = assembleMerge(parsed.segments, ["A1\nA2", "C2"], false);
    expect(result).toBe(["line1", "A1", "A2", "line3", "line4", "C2", "line5"].join("\n"));
  });

  it("keeps unresolved blocks as markers for whole-file editing", () => {
    const parsed = parseConflicts(file);
    const result = assembleForFree(parsed.segments, ["A1\nA2", ""], [true, false], false);
    expect(result).toContain("A1\nA2");
    expect(result).toContain("<<<<<<< HEAD\nC1");
    expect(result).toContain(">>>>>>> other");
  });
});

describe("alignLines", () => {
  it("pairs lines by position and marks word differences", () => {
    const rows = alignLines(["const a = 1;", "same"], ["const b = 1;", "same", "extra"]);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.ours?.text).toBe("const a = 1;");
    expect(rows[0]?.theirs?.text).toBe("const b = 1;");
    expect(rows[0]?.ours?.segments?.some((s) => s.changed)).toBe(true);
    expect(rows[1]?.same).toBe(true);
    expect(rows[2]?.ours).toBeUndefined();
    expect(rows[2]?.theirs?.text).toBe("extra");
  });
});
