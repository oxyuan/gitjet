import { describe, expect, it } from "bun:test";
import type { FileDiff } from "./mygo";
import { buildDiffRows, changeBlockRows, isCollapsed, textLines, wordDiff } from "./diff";

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
    wholeFile: false,
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

  it("folds long unchanged stretches out of a windowed diff", () => {
    const long = { ...file, oldText: longText(30), newText: longText(30).replace("line 15", "LINE 15") };
    const folded = buildDiffRows(long, true);
    expect(folded.some(isCollapsed)).toBe(true);
  });

  it("shows every line when the diff covers the whole file", () => {
    const long = {
      ...file,
      wholeFile: true,
      oldText: longText(30),
      newText: longText(30).replace("line 15", "LINE 15"),
    };
    const rows = buildDiffRows(long);
    expect(rows.some(isCollapsed)).toBe(false);
    expect(rows.filter((r) => !isCollapsed(r) && r.kind === "context")).toHaveLength(29);
  });
});

describe("changeBlockRows", () => {
  const base: FileDiff = {
    path: "a.txt",
    oldPath: "a.txt",
    status: "modified",
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    oldText: "",
    newText: "",
    oldLabel: "",
    newLabel: "",
    truncated: false,
    patch: "",
    hasChanges: true,
    wholeFile: false,
  };
  const fileWith = (lines: FileDiff["hunks"][number]["lines"], oldText: string, newText: string): FileDiff => ({
    ...base,
    hunks: [{ header: "", oldStart: 1, oldLines: oldText.split("\n").length - 1, newStart: 1, newLines: newText.split("\n").length - 1, lines }],
    oldText,
    newText,
  });

  it("counts consecutive changed lines as one block", () => {
    const rows = buildDiffRows(
      fileWith(
        [
          { kind: "del", oldNo: 1, newNo: 0, text: "a" },
          { kind: "del", oldNo: 2, newNo: 0, text: "b" },
          { kind: "del", oldNo: 3, newNo: 0, text: "c" },
          { kind: "add", oldNo: 0, newNo: 1, text: "A" },
          { kind: "add", oldNo: 0, newNo: 2, text: "B" },
          { kind: "add", oldNo: 0, newNo: 3, text: "C" },
        ],
        "a\nb\nc\n",
        "A\nB\nC\n",
      ),
      false,
    );
    expect(changeBlockRows(rows)).toHaveLength(1);
  });

  it("splits blocks at unchanged lines inside one hunk", () => {
    const rows = buildDiffRows(
      fileWith(
        [
          { kind: "context", oldNo: 1, newNo: 1, text: "a" },
          { kind: "del", oldNo: 2, newNo: 0, text: "b" },
          { kind: "add", oldNo: 0, newNo: 2, text: "B" },
          { kind: "context", oldNo: 3, newNo: 3, text: "c" },
          { kind: "del", oldNo: 4, newNo: 0, text: "d" },
          { kind: "add", oldNo: 0, newNo: 4, text: "D" },
          { kind: "context", oldNo: 5, newNo: 5, text: "e" },
        ],
        "a\nb\nc\nd\ne\n",
        "a\nB\nc\nD\ne\n",
      ),
      false,
    );
    expect(changeBlockRows(rows)).toEqual([1, 3]);
  });
});

function longText(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}
