import { describe, expect, it } from "bun:test";
import { imageSource, isImagePath } from "./images";

describe("isImagePath", () => {
  it("matches the extensions the viewer draws", () => {
    expect(isImagePath("docs/logo.PNG")).toBe(true);
    expect(isImagePath("a/b/photo.jpeg")).toBe(true);
    expect(isImagePath("icon.svg")).toBe(true);
  });

  it("rejects text and unknown binaries", () => {
    expect(isImagePath("main.go")).toBe(false);
    expect(isImagePath("photo.png.txt")).toBe(false);
    expect(isImagePath("archive.zip")).toBe(false);
  });
});

describe("imageSource", () => {
  it("builds a data URL from the mime and base64 payload", () => {
    expect(imageSource({ mime: "image/png", data: "QUJD" })).toBe("data:image/png;base64,QUJD");
  });
});
