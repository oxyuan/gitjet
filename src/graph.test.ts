import { describe, expect, it } from "bun:test";
import type { Commit } from "./mygo";
import { computeGraph, graphWidth } from "./graph";

const commit = (hash: string, parents: string[] = []): Commit => ({
  hash,
  short: hash.slice(0, 8),
  parents,
  author: "A",
  authorEmail: "a@b",
  authorTime: 0,
  committer: "A",
  committerEmail: "a@b",
  commitTime: 0,
  subject: hash,
  body: "",
  message: hash,
  refs: [],
});

describe("computeGraph", () => {
  it("keeps a linear history on one lane", () => {
    const rows = computeGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(graphWidth(rows)).toBe(32);
  });

  it("does not draw a lane below the last commit whose parent is not listed", () => {
    // "b" is older than the page, so nothing may continue past "a".
    const rows = computeGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a", ["older"])]);
    expect(rows[2]!.edges).toEqual([0]);
    expect(rows[2]!.after).toEqual([]);
  });

  it("drops a side lane whose branch left the page", () => {
    const rows = computeGraph([
      commit("m", ["c", "side"]),
      commit("c", ["older"]),
    ]);
    // The merge's second parent never appears, so it must not run downwards.
    expect(rows[0]!.edges).toHaveLength(2);
    expect(rows[1]!.before.filter((lane) => lane !== null)).toEqual(["c"]);
  });

  it("caps the number of lanes however many branches are open", () => {
    const tips = Array.from({ length: 12 }, (_, i) => commit(`t${i}`, [`gone${i}`]));
    const rows = computeGraph(tips);
    expect(Math.max(...rows.map((row) => row.before.length))).toBeLessThanOrEqual(8);
    expect(graphWidth(rows)).toBeLessThanOrEqual(8 * 14 + 4);
  });
});
