import { describe, expect, it } from "bun:test";
import { annotateDate, blameDepth, changeRanges } from "./annotate";
import type { FileDiff } from "./mygo";

function diff(lines: [string, number, number][], newStart = 10): FileDiff {
  return {
    path: "a.ts",
    status: "modified",
    binary: false,
    additions: 0,
    deletions: 0,
    oldText: "",
    newText: "",
    oldLabel: "",
    newLabel: "",
    truncated: false,
    patch: "",
    hasChanges: true,
    hunks: [
      {
        header: "@@",
        oldStart: 8,
        oldLines: 4,
        newStart,
        newLines: 4,
        lines: lines.map(([kind, oldNo, newNo]) => ({ kind, oldNo, newNo, text: "" })),
      },
    ],
  };
}

describe("changeRanges", () => {
  it("groups consecutive added lines into one span", () => {
    const ranges = changeRanges(
      diff([
        ["context", 8, 10],
        ["add", 0, 11],
        ["add", 0, 12],
        ["context", 9, 13],
      ]),
    );
    expect(ranges).toEqual([{ start: 11, count: 2, kind: "add", hunk: 0 }]);
  });

  it("anchors a deletion after the last surviving line", () => {
    const ranges = changeRanges(
      diff([
        ["context", 8, 10],
        ["del", 9, 0],
        ["del", 10, 0],
        ["context", 11, 11],
      ]),
    );
    expect(ranges).toEqual([{ start: 11, count: 0, kind: "del", hunk: 0 }]);
  });

  it("splits an add run when a deletion interrupts it", () => {
    const ranges = changeRanges(
      diff([
        ["add", 0, 10],
        ["del", 8, 0],
        ["add", 0, 11],
      ]),
    );
    expect(ranges.map((r) => `${r.kind}:${r.start}:${r.count}`)).toEqual(["add:10:1", "del:11:0", "add:11:1"]);
  });

  it("keeps one marker for a deletion at the end of the file", () => {
    const ranges = changeRanges(
      diff(
        [
          ["context", 8, 10],
          ["del", 9, 0],
        ],
        10,
      ),
    );
    expect(ranges).toEqual([{ start: 11, count: 0, kind: "del", hunk: 0 }]);
  });

  it("draws nothing for a binary or empty diff", () => {
    expect(changeRanges(null)).toEqual([]);
    const binary = diff([["add", 0, 10]]);
    binary.binary = true;
    expect(changeRanges(binary)).toEqual([]);
  });
});

describe("blameDepth", () => {
  const now = Date.UTC(2025, 0, 1) / 1000;
  const day = 86400;
  const at = (days: number) => blameDepth(now - days * day, now);

  it("steps down as commits age, so newer work is darker", () => {
    expect([at(0), at(7), at(8), at(30), at(31), at(90), at(91), at(180), at(181), at(365), at(366)]).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5,
    ]);
  });

  it("treats a future timestamp as fresh and a missing one as oldest", () => {
    expect(at(-1)).toBe(0);
    expect(blameDepth(0, now)).toBe(5);
  });
});

describe("annotateDate", () => {
  it("formats the local calendar day as YYYY-MM-DD", () => {
    const noon = new Date(2024, 4, 7, 12, 0, 0);
    expect(annotateDate(noon.getTime() / 1000)).toBe("2024-05-07");
    expect(annotateDate(0)).toBe("");
  });
});
