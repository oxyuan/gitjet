import { describe, expect, it } from "bun:test";
import { detectLineEnding, normalizeText, withLineEnding } from "./editorText";

describe("detectLineEnding", () => {
  it("sees Windows and Unix files", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(detectLineEnding("a\nb\n")).toBe("\n");
    expect(detectLineEnding("")).toBe("\n");
  });
});

describe("normalizeText", () => {
  it("folds every separator into a line feed", () => {
    expect(normalizeText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });
});

describe("withLineEnding", () => {
  it("writes a CRLF file back with CRLF and keeps the final newline", () => {
    expect(withLineEnding("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(withLineEnding("a\nb", "\r\n")).toBe("a\r\nb");
  });

  it("leaves an LF file alone", () => {
    expect(withLineEnding("a\nb\n", "\n")).toBe("a\nb\n");
  });
});
