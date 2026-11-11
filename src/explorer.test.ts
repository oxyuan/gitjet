import { describe, expect, it } from "bun:test";
import { buildChangeTree } from "./changes";
import { ancestorDirs, expandedTo, filterFiles, matchIndices, visibleFiles } from "./explorer";

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

describe("ancestorDirs", () => {
  it("lists every folder above a file, outermost first", () => {
    expect(ancestorDirs("internal/git/files.go")).toEqual(["internal", "internal/git"]);
    expect(ancestorDirs("src/App.tsx")).toEqual(["src"]);
  });

  it("has no folders for a root file", () => {
    expect(ancestorDirs("readme.md")).toEqual([]);
  });
});

describe("matchIndices", () => {
  it("reports where the query's characters sit in the name", () => {
    expect(matchIndices("SourceTree.tsx", "src")).toEqual([0, 3, 4]);
    expect(matchIndices("App.tsx", "app")).toEqual([0, 1, 2]);
  });

  it("asks for nothing with an empty query", () => {
    expect(matchIndices("App.tsx", "")).toBeNull();
  });

  it("returns null when the characters are missing or out of order", () => {
    expect(matchIndices("App.tsx", "tsx")).toEqual([4, 5, 6]);
    expect(matchIndices("App.tsx", "xts")).toBeNull();
    expect(matchIndices("App.tsx", "z")).toBeNull();
  });

  it("does not run past the end of the name", () => {
    expect(matchIndices("a", "aa")).toBeNull();
  });
});

describe("visibleFiles", () => {
  const tree = [
    { path: "src/App.tsx" },
    { path: "src/diff.ts" },
    { path: "internal/git/files.go" },
    { path: "readme.md" },
  ];

  it("lists only what an open directory shows, in drawing order", () => {
    // Directories come first, and a closed one contributes no rows at all.
    expect(visibleFiles(tree, new Set(["src"])).map((f) => f.path)).toEqual([
      "src/App.tsx",
      "src/diff.ts",
      "readme.md",
    ]);
  });

  it("lists everything when every directory is open", () => {
    const all = expandedTo(buildChangeTree(tree), 99);
    expect(visibleFiles(tree, all).map((f) => f.path)).toEqual([
      "internal/git/files.go",
      "src/App.tsx",
      "src/diff.ts",
      "readme.md",
    ]);
  });
});
