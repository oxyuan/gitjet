import { describe, expect, it } from "bun:test";
import { pullBranchDefault, pullBranchNames } from "./pullDefaults";

describe("pullBranchNames", () => {
  it("keeps only the chosen remote's branches, without its prefix", () => {
    expect(pullBranchNames(["origin/main", "upstream/main", "origin/topic"], "origin")).toEqual([
      "main",
      "topic",
    ]);
  });

  it("answers nothing for a remote with no branches fetched", () => {
    expect(pullBranchNames([], "origin")).toEqual([]);
  });
});

describe("pullBranchDefault", () => {
  const names = ["main", "release", "topic"];

  it("prefers the tracked branch of the checked-out one", () => {
    expect(
      pullBranchDefault({ current: "feature", upstream: "origin/topic", remote: "origin", names }),
    ).toBe("topic");
  });

  it("falls back to the same-name remote branch", () => {
    expect(pullBranchDefault({ current: "release", upstream: "", remote: "origin", names })).toBe(
      "release",
    );
  });

  it("takes the first branch when nothing matches", () => {
    expect(pullBranchDefault({ current: "local", upstream: "", remote: "origin", names })).toBe("main");
    expect(pullBranchDefault({ current: "local", upstream: "", remote: "origin", names: [] })).toBe("");
  });

  it("ignores an upstream that belongs to another remote", () => {
    expect(
      pullBranchDefault({ current: "local", upstream: "upstream/topic", remote: "origin", names }),
    ).toBe("main");
  });
});
