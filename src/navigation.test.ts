import { describe, expect, it } from "bun:test";
import type { SymbolHit } from "./mygo";
import {
  MAX_HISTORY,
  canStep,
  declarationUnderCaret,
  emptyHistory,
  mergeNavigationTargets,
  normalizeTargets,
  planTextJump,
  recordPoint,
  stepHistory,
  targetAtPosition,
  targetKey,
  targetPoint,
  targetsToHits,
  usageTargets,
  type NavigationPoint,
  type NavigationTarget,
} from "./navigation";

const fromUri = (uri: string) => uri.replace("file://", "");

function target(path: string, line: number, column = 1): NavigationTarget {
  return { uri: `file://${path}`, path, line, column, endLine: line, endColumn: column + 1 };
}

function point(path: string, line: number, column = 1): NavigationPoint {
  return { path, line, column };
}

describe("normalizeTargets", () => {
  it("reads a single Location", () => {
    const found = normalizeTargets(
      { uri: "file:///repo/a.go", range: { start: { line: 2, character: 4 }, end: { line: 2, character: 7 } } },
      fromUri,
    );
    expect(found).toEqual([
      { uri: "file:///repo/a.go", path: "/repo/a.go", line: 3, column: 5, endLine: 3, endColumn: 8 },
    ]);
  });

  it("reads a LocationLink's selection range", () => {
    const found = normalizeTargets(
      {
        targetUri: "file:///repo/a.go",
        targetRange: { start: { line: 9, character: 0 }, end: { line: 12, character: 1 } },
        targetSelectionRange: { start: { line: 9, character: 6 }, end: { line: 9, character: 9 } },
      },
      fromUri,
    );
    expect(found[0]).toMatchObject({ line: 10, column: 7, endLine: 10, endColumn: 10 });
  });

  it("accepts an array, drops duplicates and non-file schemes, and sorts", () => {
    const location = (path: string, line: number) => ({
      uri: `file://${path}`,
      range: { start: { line, character: 0 }, end: { line, character: 2 } },
    });
    const found = normalizeTargets(
      [
        location("/repo/b.go", 4),
        location("/repo/a.go", 8),
        location("/repo/a.go", 2),
        location("/repo/a.go", 2),
        { uri: "untitled:Untitled-1", range: location("/x", 0).range },
      ],
      fromUri,
    );
    expect(found.map((t) => `${t.path}:${t.line}`)).toEqual(["/repo/a.go:3", "/repo/a.go:9", "/repo/b.go:5"]);
  });

  it("treats null and malformed answers as empty", () => {
    expect(normalizeTargets(null, fromUri)).toEqual([]);
    expect(normalizeTargets({ uri: "file:///a" }, fromUri)).toEqual([]);
    expect(normalizeTargets(42, fromUri)).toEqual([]);
  });
});

describe("navigation history", () => {
  it("records points and steps between them", () => {
    let history = emptyHistory();
    history = recordPoint(history, point("a.go", 1));
    history = recordPoint(history, point("b.go", 5));
    history = recordPoint(history, point("c.go", 9));
    expect(history.index).toBe(2);
    expect(canStep(history, -1)).toBe(true);
    expect(canStep(history, 1)).toBe(false);
    history = stepHistory(history, -1)!;
    expect(history.entries[history.index]!.path).toBe("b.go");
    history = stepHistory(history, 1)!;
    expect(history.entries[history.index]!.path).toBe("c.go");
  });

  it("does not record the same file, line and column twice in a row", () => {
    let history = recordPoint(emptyHistory(), point("a.go", 3));
    history = recordPoint(history, point("a.go", 3));
    expect(history.entries).toHaveLength(1);
    history = recordPoint(history, point("a.go", 3, 8));
    expect(history.entries).toHaveLength(2);
  });

  it("separates a revision from the working tree at the same line", () => {
    let history = recordPoint(emptyHistory(), point("a.go", 3));
    history = recordPoint(history, { ...point("a.go", 3), revision: "HEAD" });
    expect(history.entries).toHaveLength(2);
  });

  it("drops the forward branch after a new jump", () => {
    let history = recordPoint(emptyHistory(), point("a.go", 1));
    history = recordPoint(history, point("b.go", 2));
    history = stepHistory(history, -1)!;
    history = recordPoint(history, point("c.go", 3));
    expect(history.entries.map((entry) => entry.path)).toEqual(["a.go", "c.go"]);
    expect(history.index).toBe(1);
  });

  it("caps the history and keeps the newest entries", () => {
    let history = emptyHistory();
    for (let line = 1; line <= MAX_HISTORY + 5; line++) history = recordPoint(history, point("a.go", line));
    expect(history.entries).toHaveLength(MAX_HISTORY);
    expect(history.entries[0]!.line).toBe(6);
    expect(history.entries[history.index]!.line).toBe(MAX_HISTORY + 5);
  });

  it("returns null at either end", () => {
    const history = recordPoint(emptyHistory(), point("a.go", 1));
    expect(stepHistory(history, -1)).toBeNull();
    expect(stepHistory(history, 1)).toBeNull();
  });
});

describe("merging targets", () => {
  it("merges by path and drops exact duplicates", () => {
    const declaration = target("b.go", 3);
    const usage = target("a.go", 9);
    const merged = mergeNavigationTargets([declaration], [usage, declaration]);
    expect(merged.map((t) => t.path)).toEqual(["a.go", "b.go"]);
  });

  it("marks rows by path and line", () => {
    expect(targetKey(target("dir/a.go", 4))).toBe("dir/a.go:4");
    expect(targetPoint(target("dir/a.go", 4, 7))).toEqual({ path: "dir/a.go", line: 4, column: 7 });
  });

  it("lays line text onto targets", () => {
    const hits = targetsToHits([target("a.go", 2), target("a.go", 4)], [
      { path: "a.go", line: 2, text: "func Run()" },
    ]);
    expect(hits[0]!.text).toBe("func Run()");
    expect(hits[1]!.text).toBe("");
  });
});

describe("declaration detection", () => {
  const declaration: NavigationTarget = {
    uri: "file:///repo/a.go",
    path: "/repo/a.go",
    line: 3,
    column: 7,
    endLine: 3,
    endColumn: 10,
  };

  it("recognizes the declaration under the caret", () => {
    expect(targetAtPosition([declaration], "/repo/a.go", 3, 7)).toBe(declaration);
    expect(targetAtPosition([declaration], "/repo/a.go", 3, 9)).toBe(declaration);
  });

  it("rejects the columns around the name and another file", () => {
    expect(targetAtPosition([declaration], "/repo/a.go", 3, 6)).toBeUndefined();
    expect(targetAtPosition([declaration], "/repo/a.go", 3, 10)).toBeUndefined();
    expect(targetAtPosition([declaration], "/repo/b.go", 3, 8)).toBeUndefined();
  });

  it("contains a position inside a multi-line range", () => {
    const block = { ...declaration, line: 3, column: 1, endLine: 6, endColumn: 2 };
    expect(targetAtPosition([block], "/repo/a.go", 5, 1)).toBe(block);
    expect(targetAtPosition([block], "/repo/a.go", 6, 2)).toBeUndefined();
  });

  it("asks for usages only on a live declaration", () => {
    const targets = [declaration];
    expect(declarationUnderCaret("definition", "", targets, "/repo/a.go", 3, 8)).toBe(true);
    expect(declarationUnderCaret("definition", "EXTERNAL", targets, "/repo/a.go", 3, 8)).toBe(true);
    expect(declarationUnderCaret("definition", "", targets, "/repo/a.go", 4, 8)).toBe(false);
    expect(declarationUnderCaret("definition", "HEAD", targets, "/repo/a.go", 3, 8)).toBe(false);
    expect(declarationUnderCaret("implementation", "", targets, "/repo/a.go", 3, 8)).toBe(false);
  });
});

describe("usage filtering", () => {
  it("drops a declaration the reference list echoed", () => {
    const declaration = target("a.go", 4, 2);
    const usage = target("a.go", 9, 2);
    expect(usageTargets([declaration], [declaration, usage])).toEqual([usage]);
  });

  it("keeps a reference to another symbol on the declaration's line", () => {
    const declaration = target("a.go", 4, 2);
    const other = { ...target("a.go", 4, 20), endColumn: 22 };
    expect(usageTargets([declaration], [other])).toEqual([other]);
  });
});

function hit(path: string, line: number, column: number, text: string): SymbolHit {
  return { path, line, column, text };
}

describe("planTextJump", () => {
  // What `git grep -w` returns for `greet`: one declaration, one call and a
  // same-named symbol that is not a declaration of this word.
  const hits = [
    hit("/repo/a.ts", 2, 17, "export function greet(name: string): string {"),
    hit("/repo/a.ts", 7, 15, '  console.log(greet("x"));'),
    hit("/repo/b.ts", 4, 10, "function greet2(): void {}"),
  ];

  it("jumps from a usage to the one declaration", () => {
    const plan = planTextJump("greet", "typescript", point("/repo/a.ts", 7, 15), hits);
    expect(plan).toEqual({ kind: "target", hit: hits[0]! });
  });

  it("lists the usages when the click is on the declaration", () => {
    expect(planTextJump("greet", "typescript", point("/repo/a.ts", 2, 17), hits)).toEqual({
      kind: "declaration",
    });
  });

  it("asks which declaration when the search finds several", () => {
    const second = hit("/repo/c.ts", 9, 17, "export function greet(name: string): string {");
    const plan = planTextJump("greet", "typescript", point("/repo/a.ts", 7, 15), [...hits, second]);
    expect(plan).toEqual({ kind: "choose", hits: [hits[0]!, second] });
  });

  it("keeps the list when nothing reads as a declaration", () => {
    expect(planTextJump("value", "typescript", point("/repo/a.ts", 7, 15), [hits[1]!])).toEqual({
      kind: "list",
    });
  });

  it("keeps the list in a snapshot revision", () => {
    const origin = { ...point("/repo/a.ts", 2, 17), revision: "HEAD" };
    expect(planTextJump("greet", "typescript", origin, hits)).toEqual({ kind: "list" });
    expect(planTextJump("greet", "typescript", { ...origin, revision: "EXTERNAL" }, hits)).toEqual({
      kind: "list",
    });
  });
});
