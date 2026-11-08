import { describe, expect, it } from "bun:test";
import { paintLine, type TokenSpan } from "./syntax";
import type { WordSegment } from "./diff";

const keyword: TokenSpan = { from: 0, to: 5, cls: "tok-keyword" };
const name: TokenSpan = { from: 6, to: 11, cls: "tok-variable" };

describe("paintLine", () => {
  it("returns the line as one piece when there is nothing to paint", () => {
    expect(paintLine("hello world")).toEqual([{ text: "hello world", cls: "" }]);
  });

  it("cuts at token boundaries and keeps the gaps plain", () => {
    expect(paintLine("const total", [keyword, name])).toEqual([
      { text: "const", cls: "tok-keyword" },
      { text: " ", cls: "" },
      { text: "total", cls: "tok-variable" },
    ]);
  });

  it("marks changed words inside a token without losing its colour", () => {
    const segments: WordSegment[] = [
      { text: "const", changed: false },
      { text: " to", changed: true },
      { text: "tal", changed: false },
    ];
    expect(paintLine("const total", [keyword, name], segments)).toEqual([
      { text: "const", cls: "tok-keyword" },
      { text: " ", cls: "word-changed" },
      { text: "to", cls: "tok-variable word-changed" },
      { text: "tal", cls: "tok-variable" },
    ]);
  });

  it("paints a changed run that no token covers", () => {
    const segments: WordSegment[] = [
      { text: "ab", changed: true },
      { text: "cd", changed: false },
    ];
    expect(paintLine("abcd", undefined, segments)).toEqual([
      { text: "ab", cls: "word-changed" },
      { text: "cd", cls: "" },
    ]);
  });

  it("ignores tokens past the end of the line", () => {
    expect(paintLine("ab", [{ from: 1, to: 99, cls: "tok-string" }])).toEqual([
      { text: "a", cls: "" },
      { text: "b", cls: "tok-string" },
    ]);
  });

  it("keeps an empty line as one empty piece", () => {
    expect(paintLine("")).toEqual([{ text: "", cls: "" }]);
  });
});
