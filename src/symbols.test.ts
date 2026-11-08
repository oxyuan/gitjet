import { describe, expect, it } from "bun:test";
import { classifyHits, hitText, wordAt } from "./symbols";
import type { SymbolHit } from "./mygo";

function hit(path: string, line: number, text: string): SymbolHit {
  return { path, line, column: text.indexOf("Run") + 1, text };
}

const hits: SymbolHit[] = [
  hit("a.go", 3, "func Run(ctx context.Context) error {"),
  hit("a.go", 9, "\treturn Run(ctx)"),
  hit("b.go", 1, "// Run starts the server."),
  hit("b.go", 4, "\tif err := Run(ctx); err != nil {"),
];

describe("wordAt", () => {
  it("takes the identifier around the offset", () => {
    expect(wordAt("x := Run(ctx)", 6)).toEqual({ word: "Run", from: 5, to: 8 });
  });

  it("keeps dots and brackets out of the word", () => {
    expect(wordAt("pkg.Run()", 6)?.word).toBe("Run");
    expect(wordAt("Run[0]", 2)?.word).toBe("Run");
  });

  it("refuses numbers and empty space", () => {
    expect(wordAt("int 42", 5)).toBeNull();
    expect(wordAt("  ", 1)).toBeNull();
  });
});

describe("classifyHits", () => {
  it("separates a Go declaration from its uses", () => {
    const { definitions, references } = classifyHits(hits, "Run", "go");
    expect(definitions.map((h) => h.line)).toEqual([3]);
    expect(references.map((h) => h.line)).toEqual([9, 1, 4]);
  });

  it("treats a struct field line as a declaration", () => {
    const { definitions } = classifyHits([hit("a.go", 7, "\tRun string")], "Run", "go");
    expect(definitions).toHaveLength(1);
  });

  it("knows TypeScript declarations", () => {
    const found = classifyHits(
      [hit("a.ts", 1, "export function Run() {"), hit("a.ts", 5, "  Run();")],
      "Run",
      "typescript",
    );
    expect(found.definitions).toHaveLength(1);
    expect(found.references).toHaveLength(1);
  });

  it("does not match a longer identifier that contains the word", () => {
    const { definitions } = classifyHits([hit("b.go", 1, "type Runner struct {")], "Run", "go");
    expect(definitions).toHaveLength(0);
  });

  it("escapes regex characters in the word", () => {
    const { definitions } = classifyHits([hit("a.ts", 1, "function $x() {}")], "$x", "typescript");
    expect(definitions).toHaveLength(1);
  });
});

describe("hitText", () => {
  it("trims indentation and shortens long lines", () => {
    expect(hitText(hit("a.go", 1, "   func Run(){}"))).toBe("func Run(){}");
    const long = "x".repeat(200);
    expect(hitText(hit("a.go", 1, long))).toHaveLength(160);
  });
});
