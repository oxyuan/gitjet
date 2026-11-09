import { describe, expect, it } from "bun:test";
import { tryResolveText } from "./wordmerge";

/** Every expectation here is IDEA's own answer: the cases were run through
 *  `MergeResolveUtil.tryResolve` from the IDE's bytecode. */
describe("tryResolveText", () => {
  it("merges edits to different words of the same line", () => {
    expect(tryResolveText("x = 2", "x = 1", "y = 1")).toBe("y = 2");
  });

  it("takes the side that changed a stretch", () => {
    expect(tryResolveText("one RED three", "one two three", "one two three")).toBe("one RED three");
    expect(tryResolveText("foo(a)", "foo(b)", "foo(b)")).toBe("foo(a)");
    expect(tryResolveText("a ", "a", "  a")).toBe("  a ");
    expect(tryResolveText("a  b", "a b", "a b")).toBe("a  b");
    expect(tryResolveText("a b", "a b", "a  b")).toBe("a  b");
  });

  it("refuses when both sides changed the same words", () => {
    expect(tryResolveText("one RED three", "one two three", "one two BLUE")).toBeNull();
    expect(tryResolveText("let y = 2;", "let x = 1;", "let x = 3;")).toBeNull();
    expect(tryResolveText("", "x", "y")).toBeNull();
  });

  it("merges line by line", () => {
    expect(tryResolveText("A\nb", "a\nb", "a\nB")).toBe("A\nB");
  });

  it("compares a continuous script one character at a time", () => {
    expect(tryResolveText("你好世界", "你好世界", "你 好 世界")).toBe("你 好 世界");
    expect(tryResolveText("你好x世界", "你好世界", "你好y世界")).toBeNull();
  });

  it("handles empty and identical sides", () => {
    expect(tryResolveText("", "", "")).toBe("");
    expect(tryResolveText("added", "", "")).toBe("added");
    expect(tryResolveText("", "gone", "")).toBe("");
    expect(tryResolveText("same", "same", "same")).toBe("same");
  });
});
