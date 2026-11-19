import { describe, expect, it } from "bun:test";
import { speedSearchMatch, textSpeedSearch } from "./speedSearch";

describe("speedSearchMatch", () => {
  const paths = ["src/merge.ts", "src/MergeWindow.tsx", "docs/merging.md"];

  it("prefers a file name that starts with the query", () => {
    expect(speedSearchMatch(paths, "mergew")).toBe(1);
  });

  it("falls back to a file name that contains the query", () => {
    expect(speedSearchMatch(paths, "window")).toBe(1);
    expect(speedSearchMatch(paths, "ging")).toBe(2);
  });

  it("falls back to the whole path", () => {
    expect(speedSearchMatch(paths, "src/me")).toBe(0);
  });

  it("matches without regard to case", () => {
    expect(speedSearchMatch(paths, "MERGEWINDOW")).toBe(1);
  });

  it("wraps from the selected row", () => {
    expect(speedSearchMatch(paths, "merge.t", 1)).toBe(0);
  });

  it("answers -1 for an empty query or no match", () => {
    expect(speedSearchMatch(paths, "  ")).toBe(-1);
    expect(speedSearchMatch(paths, "nothing")).toBe(-1);
    expect(speedSearchMatch([], "a")).toBe(-1);
  });
});

describe("textSpeedSearch", () => {
  const rows = ["WIP on main: 9a0cfd31 feat(log)", "WIP on feature/quick-open: refs"];

  it("prefers a row that starts with the query", () => {
    expect(textSpeedSearch(rows, "WIP on feature")).toBe(1);
  });

  it("falls back to a row that contains it", () => {
    expect(textSpeedSearch(rows, "9a0cfd31")).toBe(0);
  });

  it("wraps from the current row", () => {
    expect(textSpeedSearch(rows, "9a0cfd31", 1)).toBe(0);
  });

  it("answers -1 for an empty query or no match", () => {
    expect(textSpeedSearch(rows, "  ")).toBe(-1);
    expect(textSpeedSearch(rows, "nothing")).toBe(-1);
    expect(textSpeedSearch([], "a")).toBe(-1);
  });
});
