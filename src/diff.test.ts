import { describe, expect, it } from "bun:test";
import type { FileDiff } from "./mygo";
import type { AlignedRow } from "./diff";
import { buildDiffRows, changeBlockRows, changeBlockSelections, charDiff, foldRanges, lineWidth, textLines, visibleRows, wordDiff } from "./diff";

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

describe("charDiff", () => {
  it("marks only the characters that changed", () => {
    const [left, right] = charDiff("abcd", "abXd");
    expect(left.some((s) => s.changed && s.text === "c")).toBe(true);
    expect(right.some((s) => s.changed && s.text === "X")).toBe(true);
    expect(left.filter((s) => !s.changed).map((s) => s.text).join("")).toBe("abd");
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
    const changed = rows.filter((r) => r.kind === "change");
    expect(changed).toHaveLength(1);
    const row = changed[0]!;
    expect(row.left?.text).toBe("two");
    expect(row.right?.text).toBe("TWO");
    expect(row.left?.segments?.some((s) => s.changed)).toBe(true);
  });

  it("keeps unchanged context rows around the change", () => {
    const rows = buildDiffRows(file);
    expect(rows.filter((r) => r.kind === "context")).toHaveLength(2);
  });

  it("keeps every unchanged line so a fold can be reopened", () => {
    const long = {
      ...file,
      wholeFile: true,
      oldText: longText(30),
      newText: longText(30).replace("line 15", "LINE 15"),
    };
    const rows = buildDiffRows(long);
    expect(rows.filter((r) => r.kind === "context")).toHaveLength(29);
  });
});

describe("buildDiffRows alignment", () => {
  const fileWith = (lines: FileDiff["hunks"][number]["lines"], oldText: string, newText: string): FileDiff => ({
    path: "a.txt",
    oldPath: "a.txt",
    status: "modified",
    binary: false,
    additions: lines.filter((line) => line.kind === "add").length,
    deletions: lines.filter((line) => line.kind === "del").length,
    hunks: [
      {
        header: "",
        oldStart: 1,
        oldLines: oldText.split("\n").length - 1,
        newStart: 1,
        newLines: newText.split("\n").length - 1,
        lines,
      },
    ],
    oldText,
    newText,
    oldLabel: "HEAD",
    newLabel: "Working Tree",
    truncated: false,
    patch: "",
    hasChanges: true,
    wholeFile: true,
  });

  it("pairs a changed line with the line it actually resembles", () => {
    const diff = fileWith(
      [
        { kind: "del", oldNo: 1, newNo: 0, text: "foo(a, b);" },
        { kind: "del", oldNo: 2, newNo: 0, text: "result = compute(x);" },
        { kind: "add", oldNo: 0, newNo: 1, text: "foo(a, X);" },
        { kind: "add", oldNo: 0, newNo: 2, text: 'log("inserted");' },
        { kind: "add", oldNo: 0, newNo: 3, text: "result = compute(x) + 1;" },
      ],
      'foo(a, b);\nresult = compute(x);\n',
      'foo(a, X);\nlog("inserted");\nresult = compute(x) + 1;\n',
    );
    const rows = buildDiffRows(diff);
    expect(rows.map((row) => [row.kind, row.left?.no, row.right?.no])).toEqual([
      ["change", 1, 1],
      ["add", undefined, 2],
      ["change", 2, 3],
    ]);
    const last = rows[2]!;
    expect(last.kind).toBe("change");
    expect(changedText(last.right?.segments)).toBe(" + 1");
    expect(changedText(last.left?.segments)).toBe("");
  });

  it("marks the changed word, not the punctuation around it", () => {
    const diff = fileWith(
      [
        { kind: "del", oldNo: 1, newNo: 0, text: "foo(a, b)" },
        { kind: "add", oldNo: 0, newNo: 1, text: "foo(a, c)" },
      ],
      "foo(a, b)\n",
      "foo(a, c)\n",
    );
    const row = buildDiffRows(diff)[0]!;
    expect(changedText(row.left?.segments)).toBe("b");
    expect(changedText(row.right?.segments)).toBe("c");
  });

  it("leaves a whitespace-only change without word marks on the old side", () => {
    const diff = fileWith(
      [
        { kind: "del", oldNo: 1, newNo: 0, text: "x = 1" },
        { kind: "add", oldNo: 0, newNo: 1, text: "x  =  1" },
      ],
      "x = 1\n",
      "x  =  1\n",
    );
    const row = buildDiffRows(diff)[0]!;
    expect(changedText(row.left?.segments)).toBe("");
    expect(changedText(row.right?.segments)).toBe("  ");
  });
});

function changedText(segments: { text: string; changed: boolean }[] | undefined): string {
  return (segments ?? [])
    .filter((segment) => segment.changed)
    .map((segment) => segment.text)
    .join("");
}

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
    );
    expect(changeBlockRows(rows)).toEqual([1, 3]);
  });
});

function longText(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

describe("changeBlockSelections", () => {
  it("groups each run of changed rows with signed line numbers", () => {
    const diff = {
      path: "a.txt",
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
            { kind: "context", oldNo: 1, newNo: 1, text: "one", noNewline: false },
            { kind: "del", oldNo: 2, newNo: 0, text: "two", noNewline: false },
            { kind: "add", oldNo: 0, newNo: 2, text: "TWO", noNewline: false },
            { kind: "context", oldNo: 3, newNo: 3, text: "three", noNewline: false },
            { kind: "del", oldNo: 4, newNo: 0, text: "four", noNewline: false },
            { kind: "add", oldNo: 0, newNo: 4, text: "FOUR", noNewline: false },
          ],
        },
      ],
      oldText: "one\ntwo\nthree\nfour\n",
      newText: "one\nTWO\nthree\nFOUR\n",
      oldLabel: "a",
      newLabel: "b",
      truncated: false,
      patch: "",
      hasChanges: true,
    } as const;
    const rows = buildDiffRows(diff as never);
    const blocks = changeBlockSelections(rows);
    expect([...blocks.values()]).toEqual([
      [-2, 2],
      [-4, 4],
    ]);
    expect([...blocks.keys()]).toEqual([1, 3]);
  });
});

describe("foldRanges", () => {
  const changed = (n: number, lines: number[]): AlignedRow[] => {
    const oldText = longText(n);
    let newText = oldText;
    for (const line of lines) newText = newText.replace(`line ${line}\n`, `LINE ${line}\n`);
    const rows = buildDiffRows({
      path: "a.txt",
      oldPath: "a.txt",
      status: "modified",
      binary: false,
      additions: lines.length,
      deletions: lines.length,
      hunks: [
        {
          header: "",
          oldStart: 1,
          oldLines: n,
          newStart: 1,
          newLines: n,
          lines: Array.from({ length: n }, (_, i) => {
            const no = i + 1;
            if (!lines.includes(no)) return { kind: "context", oldNo: no, newNo: no, text: `line ${no}` };
            return [
              { kind: "del", oldNo: no, newNo: 0, text: `line ${no}` },
              { kind: "add", oldNo: 0, newNo: no, text: `LINE ${no}` },
            ];
          }).flat(),
        },
      ],
      oldText,
      newText,
      oldLabel: "HEAD",
      newLabel: "Working Tree",
      truncated: false,
      patch: "",
      hasChanges: true,
      wholeFile: true,
    });
    return rows;
  };

  it("folds the file edges without inventing context there", () => {
    const rows = changed(30, [15]);
    expect(foldRanges(rows)).toEqual([
      { start: 0, end: 11, count: 11 },
      { start: 18, end: 30, count: 12 },
    ]);
  });

  it("keeps the configured context on both sides of a middle run", () => {
    const folds = foldRanges(changed(30, [5, 25]));
    expect(folds).toEqual([{ start: 8, end: 21, count: 13 }]);
  });

  it("does not fold a run shorter than the context it keeps", () => {
    expect(foldRanges(changed(12, [6]))).toEqual([]);
  });
});

describe("visibleRows", () => {
  const rows = buildDiffRows({
    path: "a.txt",
    oldPath: "a.txt",
    status: "modified",
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "",
        oldStart: 1,
        oldLines: 20,
        newStart: 1,
        newLines: 20,
        lines: Array.from({ length: 20 }, (_, i) => {
          const no = i + 1;
          if (no !== 10) return { kind: "context", oldNo: no, newNo: no, text: `line ${no}` };
          return [
            { kind: "del", oldNo: no, newNo: 0, text: `line ${no}` },
            { kind: "add", oldNo: 0, newNo: no, text: "LINE 10" },
          ];
        }).flat(),
      },
    ],
    oldText: longText(20),
    newText: longText(20).replace("line 10", "LINE 10"),
    oldLabel: "",
    newLabel: "",
    truncated: false,
    patch: "",
    hasChanges: true,
    wholeFile: true,
  });
  const folds = foldRanges(rows);

  it("replaces a closed fold with one marker and keeps row indices", () => {
    const visible = visibleRows(rows, folds, new Set());
    expect(visible[0]).toEqual({ kind: "fold", fold: { start: 0, end: 6, count: 6 } });
    const indexed = visible.filter((item) => item.kind === "row");
    expect(indexed.map((item) => item.index)).toEqual([...indexed.map((item) => item.index)]);
    expect(indexed[0]).toMatchObject({ index: 6 });
  });

  it("draws the hidden rows once the fold is open", () => {
    const visible = visibleRows(rows, folds, new Set([0, 13]));
    expect(visible).toHaveLength(rows.length);
    expect(visible.every((item) => item.kind === "row")).toBe(true);
  });
});

describe("lineWidth", () => {
  it("counts tabs to the next stop and wide characters as two cells", () => {
    expect(lineWidth("abc")).toBe(3);
    expect(lineWidth("a\tb")).toBe(9);
    expect(lineWidth("代码")).toBe(4);
  });
});
