import { describe, expect, it } from "bun:test";
import { changeRanges } from "./annotate";
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
