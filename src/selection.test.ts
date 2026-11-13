import { describe, expect, it } from "bun:test";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { languages } from "@codemirror/language-data";
import { expandSelection, identifierRange, type SelectionRange } from "./selection";

function stateAt(doc: string, from: number, to = from, extensions?: Extension) {
  return EditorState.create({ doc, selection: EditorSelection.range(from, to), extensions });
}

function contains(outer: SelectionRange, inner: SelectionRange): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

describe("identifierRange", () => {
  it("selects the whole identifier around the caret", () => {
    const state = stateAt("const foo = 1", 7);
    expect(identifierRange(state, 7)).toEqual({ from: 6, to: 9 });
  });

  it("selects digits, which the IDE's word selection includes", () => {
    const state = stateAt("x = 42;", 5);
    expect(identifierRange(state, 5)).toEqual({ from: 4, to: 6 });
  });

  it("answers null on whitespace", () => {
    expect(identifierRange(stateAt("a  b", 2), 2)).toBeNull();
  });
});

describe("expandSelection", () => {
  it("walks word, line and document without a grammar", () => {
    const doc = "first line\nsecond line";
    let state = stateAt(doc, 2);
    const word = expandSelection(state);
    expect(word).toEqual({ from: 0, to: 5 });

    state = state.update({ selection: EditorSelection.range(word!.from, word!.to) }).state;
    const line = expandSelection(state);
    expect(line).toEqual({ from: 0, to: 10 });

    state = state.update({ selection: EditorSelection.range(line!.from, line!.to) }).state;
    expect(expandSelection(state)).toEqual({ from: 0, to: doc.length });

    state = state.update({ selection: EditorSelection.range(0, doc.length) }).state;
    expect(expandSelection(state)).toBeNull();
  });

  it("goes through larger syntax nodes before the document", async () => {
    const support = await languages.find((d) => d.name === "JavaScript")!.load();
    const doc = "function foo() {\n  const answer = foo(1);\n}\n";
    const start = doc.indexOf("answer") + 2;
    let state = stateAt(doc, start, start, support);
    const steps: SelectionRange[] = [];
    for (;;) {
      const next = expandSelection(state);
      if (!next) break;
      steps.push(next);
      state = state.update({ selection: EditorSelection.range(next.from, next.to) }).state;
    }
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < steps.length; i++) {
      expect(contains(steps[i]!, steps[i - 1]!)).toBe(true);
      expect(steps[i]!.from === steps[i - 1]!.from && steps[i]!.to === steps[i - 1]!.to).toBe(false);
    }
    expect(steps[steps.length - 1]).toEqual({ from: 0, to: doc.length });
  });
});
