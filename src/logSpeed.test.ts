import { describe, expect, it } from "bun:test";
import { commitSpeedMatch } from "./logSpeed";

describe("commitSpeedMatch", () => {
  const rows = [
    { subject: "Fix merge conflict", short: "a1b2c3d", author: "Ada" },
    { subject: "Add speed search", short: "f00d123", author: "Grace" },
    { subject: "Merge branch 'main'", short: "9e9e9e9", author: "Linus" },
  ];

  it("prefers a subject that starts with the query", () => {
    expect(commitSpeedMatch(rows, "merge")).toBe(2);
    expect(commitSpeedMatch(rows, "FIX")).toBe(0);
  });

  it("falls back to a subject that contains the query", () => {
    expect(commitSpeedMatch(rows, "speed")).toBe(1);
  });

  it("reaches a abbreviated hash and an author", () => {
    expect(commitSpeedMatch(rows, "f00d")).toBe(1);
    expect(commitSpeedMatch(rows, "grace")).toBe(1);
  });

  it("wraps from the current row", () => {
    expect(commitSpeedMatch(rows, "merge", 1)).toBe(2);
    expect(commitSpeedMatch(rows, "merge", 3)).toBe(2);
  });

  it("answers -1 for an empty or unmatched query", () => {
    expect(commitSpeedMatch(rows, "   ")).toBe(-1);
    expect(commitSpeedMatch(rows, "zzz")).toBe(-1);
    expect(commitSpeedMatch([], "a")).toBe(-1);
  });
});
