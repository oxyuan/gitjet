import { describe, expect, it } from "bun:test";
import type { FileDiff } from "./mygo";
import { buildDiffRows, isCollapsed, textLines, wordDiff } from "./diff";

describe("textLines", () => {
  it("drops the empty tail after a final newline", () => {
    expect(textLines("a\nb\n")).toEqual(["a", "b"]);
    expect(textLines("")).toEqual([]);
    expect(textLines("a\r\nb")).toEqual(["a", "b"]);
  });
});

describe("wordDiff", () => {
  it("marks only the words that changed", () => {
    const [left, right] = wordDiff("const a = 1;", "const b = 1;");
    expect(left.some((s) => s.changed && s.text.includes("a"))).toBe(true);
    expect(right.some((s) => s.changed && s.text.includes("b"))).toBe(true);
    expect(left.filter((s) => !s.changed).map((s) => s.text).join("")).toContain("const ");
  });
});

describe("buildDiffRows", () => {
  const file: FileDiff = {
    path: "a.txt",
    oldPath: "a.txt",
    status: "modified",
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -1,3 +1,3 @@",
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        lines: [
          { kind: "context", oldNo: 1, newNo: 1, text: "one" },
          { kind: "del", oldNo: 2, newNo: 0, text: "two" },
          { kind: "add", oldNo: 0, newNo: 2, text: "TWO" },
          { kind: "context", oldNo: 3, newNo: 3, text: "three" },
        ],
      },
    ],
    oldText: "one\ntwo\nthree\n",
    newText: "one\nTWO\nthree\n",
    oldLabel: "HEAD",
    newLabel: "Working Tree",
    truncated: false,
    patch: "",
    hasChanges: true,
  };

  it("pairs a removed and an added line into one change row", () => {
    const rows = buildDiffRows(file);
    const changed = rows.filter((r) => !isCollapsed(r) && r.kind === "change");
    expect(changed).toHaveLength(1);
    const row = changed[0]!;
    if (!isCollapsed(row)) {
      expect(row.left?.text).toBe("two");
      expect(row.right?.text).toBe("TWO");
      expect(row.left?.segments?.some((s) => s.changed)).toBe(true);
    }
  });

  it("keeps unchanged context rows around the change", () => {
    const rows = buildDiffRows(file);
    const contexts = rows.filter((r) => !isCollapsed(r) && r.kind === "context");
    expect(contexts).toHaveLength(2);
  });
});
