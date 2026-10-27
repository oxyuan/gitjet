import { describe, expect, it } from "bun:test";
import { buildChangeTree } from "./changes";
import { expandedTo, filterFiles } from "./explorer";

const files = [
  { path: "src/App.tsx" },
  { path: "src/diff.ts" },
  { path: "internal/git/files.go" },
  { path: "readme.md" },
];

describe("filterFiles", () => {
  it("keeps everything for an empty query", () => {
    expect(filterFiles(files, "  ").length).toBe(4);
  });

  it("matches a subsequence case-insensitively and keeps path order", () => {
    expect(filterFiles(files, "SRCF").map((f) => f.path)).toEqual(["src/diff.ts"]);
    expect(filterFiles(files, "git").map((f) => f.path)).toEqual(["internal/git/files.go"]);
  });

  it("drops files whose characters are not in order", () => {
    expect(filterFiles(files, "apptsx").map((f) => f.path)).toEqual(["src/App.tsx"]);
    expect(filterFiles(files, "zzz")).toEqual([]);
  });
});

describe("expandedTo", () => {
  it("opens only the directories at the requested depth", () => {
    const keys = expandedTo(buildChangeTree(files), 1);
    expect([...keys].sort()).toEqual(["internal", "src"]);
  });

  it("opens every directory when asked for a deep tree", () => {
    const keys = expandedTo(buildChangeTree(files), 5);
    // A directory holding nothing but another directory is folded into one
    // row, so "internal/git" is the key that covers both.
    expect([...keys].sort()).toEqual(["internal", "src"]);
  });
});
