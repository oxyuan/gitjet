import { describe, expect, it } from "bun:test";
import { reformatCommitMessage } from "./commitMessage";

describe("reformatCommitMessage", () => {
  it("keeps the subject and wraps the body", () => {
    const body = "This body line is long enough that it has to be wrapped at the configured width because it keeps going.";
    const out = reformatCommitMessage(`subject\n\n${body}`, 40);
    const lines = out.split("\n");
    expect(lines[0]).toBe("subject");
    expect(lines[1]).toBe("");
    for (const line of lines.slice(2)) expect(line.length).toBeLessThanOrEqual(40);
    expect(out.replace(/\s+/g, " ")).toContain("because it keeps going.");
  });

  it("separates the subject from a body that touched it", () => {
    expect(reformatCommitMessage("subject\nbody")).toBe("subject\n\nbody");
  });

  it("leaves list items and trailers alone", () => {
    const out = reformatCommitMessage("s\n\n- one very long list item that should not be reflowed at all because lists keep their shape\nSigned-off-by: Someone <a@b.c>", 30);
    expect(out).toContain("- one very long list item that should not be reflowed at all because lists keep their shape");
    expect(out).toContain("Signed-off-by: Someone <a@b.c>");
  });

  it("returns an empty message for blank input", () => {
    expect(reformatCommitMessage("  \n\t\n")).toBe("");
  });
});
