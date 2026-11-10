import { describe, expect, it } from "bun:test";
import { ribbonPath, ribbonTone } from "./ribbons";

describe("ribbonTone", () => {
  it("names a block by the sides that hold text", () => {
    expect(ribbonTone(true, true)).toBe("modified");
    expect(ribbonTone(true, false)).toBe("deleted");
    expect(ribbonTone(false, true)).toBe("inserted");
  });
});

describe("ribbonPath", () => {
  it("curves from one pane's range to the other's", () => {
    const path = ribbonPath(0, 38, { top: 20, bottom: 80 }, { top: 20, bottom: 40 });
    expect(path.startsWith("M0,20")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path.match(/C/g)).toHaveLength(2);
    expect(path).toContain("38,40");
    expect(path).toContain("0,80");
  });

  it("keeps a zero-height side drawable as a one-pixel taper", () => {
    const path = ribbonPath(0, 38, { top: 20, bottom: 20 }, { top: 20, bottom: 60 });
    expect(path.startsWith("M0,20")).toBe(true);
    expect(path).toContain("0,21");
    expect(path.endsWith("Z")).toBe(true);
  });
});
