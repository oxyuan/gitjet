import { describe, expect, it } from "bun:test";
import { occurrencesIn } from "./occurrences";

describe("occurrencesIn", () => {
  it("finds every whole-word match", () => {
    expect(occurrencesIn("foo(foo, fooBar, barfoo, foo)", "foo")).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 25, to: 28 },
    ]);
  });

  it("keeps $ in identifiers instead of splitting them", () => {
    expect(occurrencesIn("$scope.$scope == window.$scope", "$scope")).toEqual([
      { from: 0, to: 6 },
      { from: 7, to: 13 },
      { from: 24, to: 30 },
    ]);
  });

  it("honours the match cap and an empty word", () => {
    expect(occurrencesIn("a a a a", "a", 2)).toHaveLength(2);
    expect(occurrencesIn("anything", "")).toEqual([]);
  });
});
