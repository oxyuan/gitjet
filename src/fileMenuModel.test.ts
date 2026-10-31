import { describe, expect, it } from "bun:test";
import { menuPathValues, newEntryPrefix } from "./fileMenuModel";

describe("newEntryPrefix", () => {
  it("creates inside the selected directory", () => {
    expect(newEntryPrefix({ path: "src/app", isDir: true })).toBe("src/app/");
    expect(newEntryPrefix({ path: "src/app/", isDir: true })).toBe("src/app/");
  });

  it("creates beside the selected file", () => {
    expect(newEntryPrefix({ path: "src/app/main.ts", isDir: false })).toBe("src/app/");
    expect(newEntryPrefix({ path: "main.ts", isDir: false })).toBe("");
  });

  it("creates at the root for the background", () => {
    expect(newEntryPrefix({ path: "", isDir: true })).toBe("");
  });
});

describe("menuPathValues", () => {
  it("names a repository file every way the menu offers", () => {
    const values = menuPathValues("/repo", { path: "src/app.ts", isDir: false });
    expect(values.absolute).toBe("/repo/src/app.ts");
    expect(values.name).toBe("app.ts");
    expect(values.contentRoot).toBe("src/app.ts");
    expect(values.reference).toBe("src/app.ts");
    expect(values.repositoryRoot).toBe("/repo");
  });

  it("keeps the repository's separator on Windows", () => {
    const values = menuPathValues("C:\\repo", { path: "src/app.ts", isDir: false });
    expect(values.absolute).toBe("C:\\repo\\src\\app.ts");
  });

  it("appends a known line to the reference", () => {
    const values = menuPathValues("/repo", { path: "src/app.ts", isDir: false, line: 42 });
    expect(values.reference).toBe("src/app.ts:42");
    expect(values.contentRoot).toBe("src/app.ts");
  });

  it("has no file-specific value for the root row", () => {
    const values = menuPathValues("/repo", { path: "", isDir: true });
    expect(values.absolute).toBe("/repo");
    expect(values.name).toBe("");
    expect(values.contentRoot).toBe("");
    expect(values.repositoryRoot).toBe("/repo");
  });
});
