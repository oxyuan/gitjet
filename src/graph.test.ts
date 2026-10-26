import { describe, expect, it } from "bun:test";
import type { Commit } from "./mygo";
import { computeGraph, graphWidth } from "./graph";

function commit(hash: string, parents: string[]): Commit {
  return {
    hash,
    short: hash.slice(0, 7),
    parents,
    author: "A",
    authorEmail: "a@example.com",
    authorTime: 0,
    committer: "A",
    committerEmail: "a@example.com",
    commitTime: 0,
    subject: hash,
    body: "",
    message: hash,
    refs: [],
  };
}

describe("computeGraph", () => {
  it("keeps a linear history on one lane", () => {
    const rows = computeGraph([commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[0]?.edges).toEqual([0]);
    expect(rows[2]?.edges).toEqual([]);
  });

  it("branches a merge commit into two lanes", () => {
    const rows = computeGraph([
      commit("m3", ["m2", "f2"]),
      commit("m2", ["m1"]),
      commit("f2", ["f1"]),
      commit("m1", []),
      commit("f1", []),
    ]);
    expect(rows[0]?.edges).toHaveLength(2);
    expect(new Set(rows[0]?.edges).size).toBe(2);
    expect(graphWidth(rows)).toBeGreaterThan(0);
  });
});
