import { describe, expect, it } from "bun:test";
import { moveItem, normalizeTabOrder, TOOL_TABS } from "./tabs";

describe("normalizeTabOrder", () => {
  it("keeps a stored permutation as it is", () => {
    expect(normalizeTabOrder(["console", "commit", "files", "branch"])).toEqual([
      "console",
      "commit",
      "files",
      "branch",
    ]);
  });

  it("drops unknown names and repeats", () => {
    expect(normalizeTabOrder(["branch", "bogus", "branch", "console"])).toEqual([
      "branch",
      "console",
      "commit",
      "files",
    ]);
  });

  it("appends whatever the old value did not mention", () => {
    expect(normalizeTabOrder(["files"])).toEqual(["files", "commit", "branch", "console"]);
  });

  it("falls back to the full default order for junk", () => {
    expect(normalizeTabOrder(null)).toEqual(TOOL_TABS);
    expect(normalizeTabOrder("commit")).toEqual(TOOL_TABS);
    expect(normalizeTabOrder([1, 2, 3])).toEqual(TOOL_TABS);
  });
});

describe("moveItem", () => {
  const tabs = ["a", "b", "c", "d"];

  it("moves forward", () => {
    expect(moveItem(tabs, 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves backward", () => {
    expect(moveItem(tabs, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op for the same index and clamps out-of-range ones", () => {
    expect(moveItem(tabs, 1, 1)).toEqual(tabs);
    expect(moveItem(tabs, 0, 9)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(tabs, -3, 0)).toEqual(tabs);
  });

  it("does not mutate the input", () => {
    moveItem(tabs, 0, 3);
    expect(tabs).toEqual(["a", "b", "c", "d"]);
  });
});
