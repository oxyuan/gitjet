import { describe, expect, it } from "bun:test";
import { fileBadge } from "./fileIcons";

describe("file badges", () => {
  it("picks a language from the extension, case-insensitively", () => {
    expect(fileBadge("src/main.go")).toEqual({ label: "GO", lang: "go" });
    expect(fileBadge("SRC/MAIN.GO")).toEqual({ label: "GO", lang: "go" });
    expect(fileBadge("src/app.tsx")).toEqual({ label: "TS", lang: "ts" });
    expect(fileBadge("src/App.java")).toEqual({ label: "JV", lang: "java" });
  });

  it("keeps compound extensions on the real language", () => {
    expect(fileBadge("src/types.d.ts")).toEqual({ label: "TS", lang: "ts" });
    expect(fileBadge("archive/app.tar.gz")).toEqual({ label: "ZIP", lang: "archive" });
  });

  it("recognises whole file names before extensions", () => {
    expect(fileBadge("Dockerfile")).toEqual({ label: "DK", lang: "docker" });
    expect(fileBadge("Makefile")).toEqual({ label: "MK", lang: "make" });
    expect(fileBadge("package.json")).toEqual({ label: "NP", lang: "npm" });
    expect(fileBadge("go.mod")).toEqual({ label: "GO", lang: "go" });
    expect(fileBadge("Cargo.toml")).toEqual({ label: "RS", lang: "rust" });
    expect(fileBadge("README")).toEqual({ label: "MD", lang: "markdown" });
  });

  it("treats dotfiles as configuration, .env specially", () => {
    expect(fileBadge(".gitignore")).toEqual({ label: "GIT", lang: "git" });
    expect(fileBadge(".env.local")).toEqual({ label: "ENV", lang: "config" });
    expect(fileBadge(".unknownrc")).toEqual({ label: "CFG", lang: "config" });
    expect(fileBadge(".eslintrc.js")).toEqual({ label: "JS", lang: "js" });
    expect(fileBadge(".prettierrc.json")).toEqual({ label: "{}", lang: "json" });
  });

  it("falls back to a neutral monogram so unknown files still differ", () => {
    expect(fileBadge("notes.xyz")).toEqual({ label: "XY", lang: "plain" });
    expect(fileBadge("Procfile")).toEqual({ label: "PR", lang: "plain" });
    expect(fileBadge("")).toEqual({ label: "", lang: "plain" });
  });
});
