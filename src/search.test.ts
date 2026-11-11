import { describe, expect, it } from "bun:test";
import type { AlignedRow } from "./diff";
import { findSpans, markSearch, searchRows } from "./search";

function context(no: number, text: string): AlignedRow {
  return {
    kind: "context",
    hunk: 0,
    left: { no, text, kind: "context" },
    right: { no: no + 10, text, kind: "context" },
  };
}

describe("findSpans", () => {
  it("finds every non-overlapping occurrence, ignoring case", () => {
    expect(findSpans("Foo foo FOOD", "foo")).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it("honours match case when asked", () => {
    expect(findSpans("Foo foo", "foo", true)).toEqual([{ from: 4, to: 7 }]);
  });

  it("returns nothing for an empty query", () => {
    expect(findSpans("anything", "")).toEqual([]);
  });

  it("does not report overlapping runs twice", () => {
    expect(findSpans("aaaa", "aa")).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it("treats regex metacharacters as literal text", () => {
    expect(findSpans("a.b axb", ".")).toEqual([{ from: 1, to: 2 }]);
    expect(findSpans("f(x) f(x)", "(")).toEqual([
      { from: 1, to: 2 },
      { from: 6, to: 7 },
    ]);
  });
});

describe("searchRows", () => {
  it("reports a shared context row once, for both panes", () => {
    const rows = [context(1, "alpha beta alpha")];
    expect(searchRows(rows, "alpha")).toEqual([
      { row: 0, side: "right", both: true, line: 11, from: 0, to: 5 },
      { row: 0, side: "right", both: true, line: 11, from: 11, to: 16 },
    ]);
  });

  it("counts each side of a changed pair separately", () => {
    const rows: AlignedRow[] = [
      {
        kind: "change",
        hunk: 0,
        left: { no: 1, text: "old alpha", kind: "del" },
        right: { no: 2, text: "new alpha", kind: "add" },
      },
    ];
    expect(searchRows(rows, "alpha").map((hit) => [hit.side, hit.line])).toEqual([
      ["left", 1],
      ["right", 2],
    ]);
  });

  it("finds a one-sided line only on the side that has it", () => {
    const rows: AlignedRow[] = [
      { kind: "del", hunk: 0, left: { no: 7, text: "gone", kind: "del" } },
      { kind: "add", hunk: 0, right: { no: 9, text: "here", kind: "add" } },
    ];
    expect(searchRows(rows, "o").map((hit) => [hit.side, hit.line, hit.row])).toEqual([
      ["left", 7, 0],
    ]);
  });

  it("returns nothing when the query is empty", () => {
    expect(searchRows([context(1, "a")], "")).toEqual([]);
  });
});

describe("markSearch", () => {
  it("cuts a painted piece at the match and tags only the hit", () => {
    const pieces = [{ text: "const total = 0;", cls: "tok-keyword" }];
    expect(markSearch(pieces, [{ from: 6, to: 11 }])).toEqual([
      { text: "const ", cls: "tok-keyword" },
      { text: "total", cls: "tok-keyword search-hit" },
      { text: " = 0;", cls: "tok-keyword" },
    ]);
  });

  it("keeps the active hit distinct from the others", () => {
    const pieces = [{ text: "aa aa", cls: "" }];
    expect(markSearch(pieces, [{ from: 0, to: 2 }, { from: 3, to: 5 }], { from: 3, to: 5 })).toEqual([
      { text: "aa", cls: "search-hit" },
      { text: " ", cls: "" },
      { text: "aa", cls: "search-hit search-current" },
    ]);
  });

  it("splits a match that crosses existing piece boundaries", () => {
    const pieces = [
      { text: "foo", cls: "a" },
      { text: "bar", cls: "b" },
    ];
    expect(markSearch(pieces, [{ from: 2, to: 5 }])).toEqual([
      { text: "fo", cls: "a" },
      { text: "o", cls: "a search-hit" },
      { text: "ba", cls: "b search-hit" },
      { text: "r", cls: "b" },
    ]);
  });

  it("returns the pieces untouched when nothing matches", () => {
    const pieces = [{ text: "abc", cls: "" }];
    expect(markSearch(pieces, [])).toBe(pieces);
  });
});
