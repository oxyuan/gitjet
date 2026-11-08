import { describe, expect, it } from "bun:test";
import { hasSignature, signatureKey, signatureTone } from "./signature";
import type { CommitSignature } from "./mygo";

const sig = (status: string, signer = "", key = ""): CommitSignature => ({
  status,
  signer,
  key,
  checked: true,
});

describe("signatureTone", () => {
  it("paints a verified signature good and a broken one bad", () => {
    expect(signatureTone("G")).toBe("good");
    expect(signatureTone("B")).toBe("bad");
    expect(signatureTone("E")).toBe("bad");
  });

  it("leaves an unsigned commit alone", () => {
    expect(signatureTone("N")).toBe("");
    expect(signatureTone("")).toBe("");
  });
});

describe("signatureKey", () => {
  it("maps each verification letter to its own sentence", () => {
    const keys = ["G", "B", "U", "X", "Y", "R", "E"].map((s) => signatureKey(s));
    expect(new Set(keys).size).toBe(keys.length);
    expect(signatureKey("G")).toBe("signatureGood");
    expect(signatureKey("R")).toBe("signatureRevoked");
  });

  it("reports no sentence for an unsigned or unknown status", () => {
    expect(signatureKey("N")).toBeNull();
    expect(signatureKey("")).toBeNull();
    expect(signatureKey("?")).toBeNull();
  });
});

describe("hasSignature", () => {
  it("is false when git verified nothing", () => {
    expect(hasSignature(undefined)).toBe(false);
    expect(hasSignature(sig("N"))).toBe(false);
    expect(hasSignature({ ...sig("G"), checked: false })).toBe(false);
  });

  it("is true for a signed commit", () => {
    expect(hasSignature(sig("G", "Ada <ada@example.com>"))).toBe(true);
  });
});
