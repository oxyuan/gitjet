import { describe, expect, it } from "bun:test";
import { baseName, isAbsolutePath, joinRoot, pathChoices, quoteForShell, repoRelative, resolveOpenPath } from "./paths";

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

describe("absolute paths and the repository", () => {
  it("knows what disk paths look like", () => {
    expect(isAbsolutePath("/repo/a.ts")).toBe(true);
    expect(isAbsolutePath("C:\\repo\\a.ts")).toBe(true);
    expect(isAbsolutePath("C:/repo/a.ts")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\a.ts")).toBe(true);
    expect(isAbsolutePath("src/a.ts")).toBe(false);
  });

  it("turns an absolute path inside the repository into a git path", () => {
    expect(repoRelative("/Users/me/repo", "/Users/me/repo/src/a.ts")).toBe("src/a.ts");
    expect(repoRelative("/Users/me/repo/", "/Users/me/repo/src/a.ts")).toBe("src/a.ts");
    expect(repoRelative("/Users/me/repo", "/Users/me/repo2/a.ts")).toBeNull();
    expect(repoRelative("/Users/me/repo", "/usr/local/go/src/fmt/print.go")).toBeNull();
    expect(repoRelative("/Users/me/repo", "src/a.ts")).toBeNull();
  });

  it("handles Windows separators and case", () => {
    expect(repoRelative("C:\\work\\repo", "C:/work/repo/src/a.ts")).toBe("src/a.ts");
    expect(repoRelative("C:\\work\\repo", "c:\\WORK\\repo\\src\\a.ts")).toBe("src/a.ts");
    expect(repoRelative("C:\\work\\repo", "C:\\work\\other\\a.ts")).toBeNull();
  });
});

describe("resolveOpenPath", () => {
  it("keeps a git path as it is", () => {
    expect(resolveOpenPath("/Users/me/repo", "src/a.ts")).toEqual({ scope: "repo", path: "src/a.ts" });
  });

  it("turns an absolute repository path into a git path", () => {
    expect(resolveOpenPath("/Users/me/repo", "/Users/me/repo/src/a.ts")).toEqual({
      scope: "repo",
      path: "src/a.ts",
    });
  });

  it("opens a path outside the repository as an external file", () => {
    expect(resolveOpenPath("/Users/me/repo", "/usr/local/go/src/fmt/print.go")).toEqual({
      scope: "external",
      path: "/usr/local/go/src/fmt/print.go",
    });
  });
});

describe("pathChoices outside the repository", () => {
  it("keeps an external absolute path as the absolute choice", () => {
    const absolute = pathChoices({ path: "/usr/local/go/src/fmt/print.go", root: "/repo" }).find(
      (choice) => choice.key === "absolute",
    );
    expect(absolute?.value).toBe("/usr/local/go/src/fmt/print.go");
  });
});
