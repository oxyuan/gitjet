import { describe, expect, it } from "bun:test";
import type { LanguageDescription, LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { loadLanguage } from "./editor";

/** A grammar of this test's own, whose load can fail: the catalog is the one
 *  the pane searches, so a name only it knows is enough to reach the cache. */
function addGrammar(name: string, load: () => Promise<LanguageSupport>): () => void {
  const description = { name, alias: [], extensions: [], load } as unknown as LanguageDescription;
  languages.unshift(description);
  return () => {
    const at = languages.indexOf(description);
    if (at >= 0) languages.splice(at, 1);
  };
}

describe("loadLanguage", () => {
  it("loads a grammar once, even when asked twice at the same time", async () => {
    let calls = 0;
    const support = {} as LanguageSupport;
    const remove = addGrammar("counting-grammar", async () => {
      calls += 1;
      return support;
    });
    try {
      const [first, second] = await Promise.all([
        loadLanguage("counting-grammar"),
        loadLanguage("counting-grammar"),
      ]);
      expect(first).toBe(support);
      expect(second).toBe(support);
      expect(calls).toBe(1);
    } finally {
      remove();
    }
  });

  it("does not remember a failed load as the grammar of that language", async () => {
    let calls = 0;
    const support = {} as LanguageSupport;
    const remove = addGrammar("failing-grammar", async () => {
      calls += 1;
      if (calls === 1) throw new Error("chunk missing");
      return support;
    });
    try {
      expect(await loadLanguage("failing-grammar")).toBeNull();
      expect(await loadLanguage("failing-grammar")).toBe(support);
      expect(calls).toBe(2);
    } finally {
      remove();
    }
  });

  it("resolves a name no grammar answers to plain text, without caching it", async () => {
    expect(await loadLanguage("no-such-language-grammar")).toBeNull();
    expect(await loadLanguage("no-such-language-grammar")).toBeNull();
  });
});
