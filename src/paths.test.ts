import { describe, expect, it } from "bun:test";
import { baseName, joinRoot, pathChoices, quoteForShell } from "./paths";

describe("joinRoot", () => {
  it("joins a posix root and a git path", () => {
    expect(joinRoot("/Users/me/repo", "src/diff.ts")).toBe("/Users/me/repo/src/diff.ts");
  });

  it("does not double the separator when the root ends with one", () => {
    expect(joinRoot("/Users/me/repo/", "src/diff.ts")).toBe("/Users/me/repo/src/diff.ts");
    expect(joinRoot("C:\\work\\repo\\", "src/diff.ts")).toBe("C:\\work\\repo\\src\\diff.ts");
  });

  it("uses backslashes when the root is a windows path", () => {
    expect(joinRoot("C:\\work\\repo", "src/diff.ts")).toBe("C:\\work\\repo\\src\\diff.ts");
    expect(joinRoot("C:/work/repo", "src/diff.ts")).toBe("C:\\work\\repo\\src\\diff.ts");
  });
});

describe("baseName", () => {
  it("returns the leaf, or the whole path when there is no folder", () => {
    expect(baseName("src/diff.ts")).toBe("diff.ts");
    expect(baseName("README.md")).toBe("README.md");
  });
});

describe("quoteForShell", () => {
  it("leaves a plain path alone", () => {
    expect(quoteForShell("/Users/me/repo/src/diff.ts")).toBe("/Users/me/repo/src/diff.ts");
  });

  it("quotes spaces and closes embedded quotes", () => {
    expect(quoteForShell("/Users/me/my repo/a.ts")).toBe("'/Users/me/my repo/a.ts'");
    expect(quoteForShell("/Users/me/it's")).toBe(`'/Users/me/it'\\''s'`);
  });
});

describe("pathChoices", () => {
  const base = { path: "src/diff.ts", root: "/Users/me/repo" };

  it("lists absolute, relative, name and the quoted form without a line", () => {
    expect(pathChoices(base).map((c) => [c.key, c.value])).toEqual([
      ["absolute", "/Users/me/repo/src/diff.ts"],
      ["relative", "src/diff.ts"],
      ["name", "diff.ts"],
      ["quoted", "/Users/me/repo/src/diff.ts"],
    ]);
  });

  it("adds line variants next to the path they belong to", () => {
    expect(pathChoices({ ...base, line: 12 }).map((c) => [c.key, c.value])).toEqual([
      ["absolute", "/Users/me/repo/src/diff.ts"],
      ["absoluteLine", "/Users/me/repo/src/diff.ts:12"],
      ["relative", "src/diff.ts"],
      ["relativeLine", "src/diff.ts:12"],
      ["name", "diff.ts"],
      ["nameLine", "diff.ts:12"],
      ["quoted", "/Users/me/repo/src/diff.ts"],
    ]);
  });

  it("ignores a nonsense line", () => {
    expect(pathChoices({ ...base, line: 0 }).map((c) => c.key)).toEqual([
      "absolute",
      "relative",
      "name",
      "quoted",
    ]);
  });

  it("falls back to the relative path when no root is known", () => {
    expect(pathChoices({ path: "src/diff.ts", root: "" })[0]).toEqual({
      key: "absolute",
      value: "src/diff.ts",
    });
  });
});
