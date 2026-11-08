import { describe, expect, it } from "bun:test";
import { completeFiles, messageToken } from "./commitMessage";

describe("messageToken", () => {
  it("reads the path-like token before the caret", () => {
    expect(messageToken("fix the login flow src/auth", 27)).toBe("src/auth");
    expect(messageToken("hello world", 5)).toBe("hello");
    expect(messageToken("done: ", 6)).toBe("");
  });
});

describe("completeFiles", () => {
  const paths = ["src/App.tsx", "src/auth/login.ts", "README.md"];

  it("prefers a base-name prefix, then a substring, then the directory", () => {
    expect(completeFiles(paths, "app")[0]).toBe("src/App.tsx");
    expect(completeFiles(paths, "login")[0]).toBe("src/auth/login.ts");
    expect(completeFiles(paths, "src/")[0]).toBe("src/App.tsx");
  });

  it("returns no match for an unrelated token", () => {
    expect(completeFiles(paths, "zzz")).toEqual([]);
  });
});
