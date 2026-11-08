import { describe, expect, it } from "bun:test";
import { isProtectedBranch } from "./protected";

describe("isProtectedBranch", () => {
  it("matches an exact name", () => {
    expect(isProtectedBranch("main", ["main"])).toBe(true);
    expect(isProtectedBranch("mainline", ["main"])).toBe(false);
  });

  it("matches a wildcard", () => {
    expect(isProtectedBranch("release/2.0", ["release/*"])).toBe(true);
    expect(isProtectedBranch("releases/2.0", ["release/*"])).toBe(false);
    expect(isProtectedBranch("anything", ["*"])).toBe(true);
  });

  it("treats regex characters in a pattern literally", () => {
    expect(isProtectedBranch("feat.1", ["feat.1"])).toBe(true);
    expect(isProtectedBranch("featX1", ["feat.1"])).toBe(false);
  });

  it("ignores empty patterns and a detached head", () => {
    expect(isProtectedBranch("main", ["", "  "])).toBe(false);
    expect(isProtectedBranch("", ["*"])).toBe(false);
  });
});
