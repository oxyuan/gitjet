import { wordDiff, type WordSegment } from "./diff";

export type MergeSegment =
  | { kind: "text"; text: string }
  | {
      kind: "conflict";
      ours: string[];
      theirs: string[];
      base: string[];
      label: string;
      endLabel: string;
    };

export type ConflictSegment = Extract<MergeSegment, { kind: "conflict" }>;

export interface MergeRow {
  ours?: { no: number; text: string; segments?: WordSegment[] };
  theirs?: { no: number; text: string; segments?: WordSegment[] };
  same: boolean;
}

/**
 * parseConflicts splits a working file into its unchanged text and its
 * conflict blocks, reading the standard marker format with an optional
 * common ancestor (diff3 style).
 */
export function parseConflicts(text: string): { segments: MergeSegment[]; trailingNewline: boolean } {
  const trailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (trailingNewline) lines.pop();
  const segments: MergeSegment[] = [];
  let buffer: string[] = [];
  let ours: string[] | null = null;
  let theirs: string[] | null = null;
  let base: string[] | null = null;
  let mode: "none" | "ours" | "base" | "theirs" = "none";
  let label = "";
  let endLabel = "";
  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", text: buffer.join("\n") });
      buffer = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      flush();
      ours = [];
      theirs = null;
      base = null;
      mode = "ours";
      label = line.replace(/^<<<<<<<\s*/, "").trim();
      endLabel = "";
    } else if (line.startsWith("|||||||") && mode === "ours") {
      base = [];
      mode = "base";
    } else if (line === "=======" && mode !== "none") {
      theirs = [];
      mode = "theirs";
    } else if (line.startsWith(">>>>>>>") && mode === "theirs" && ours && theirs) {
      endLabel = line.replace(/^>>>>>>>\s*/, "").trim();
      segments.push({
        kind: "conflict",
        ours,
        theirs,
        base: base ?? [],
        label: label || endLabel,
        endLabel: endLabel || label,
      });
      ours = null;
      theirs = null;
      base = null;
      mode = "none";
    } else if (mode === "ours" && ours) ours.push(line);
    else if (mode === "base" && base) base.push(line);
    else if (mode === "theirs" && theirs) theirs.push(line);
    else buffer.push(line);
  }
  flush();
  return { segments, trailingNewline };
}

/**
 * alignLines pairs the two sides of a conflict line by line, so changed
 * lines face each other and can be reviewed and inserted individually.
 */
export function alignLines(ours: string[], theirs: string[]): MergeRow[] {
  const rows: MergeRow[] = [];
  const n = Math.max(ours.length, theirs.length);
  for (let i = 0; i < n; i++) {
    const a = ours[i];
    const b = theirs[i];
    let left: MergeRow["ours"];
    let right: MergeRow["theirs"];
    if (a !== undefined) left = { no: i + 1, text: a };
    if (b !== undefined) right = { no: i + 1, text: b };
    if (a !== undefined && b !== undefined && a !== b) {
      const [leftSegs, rightSegs] = wordDiff(a, b);
      left = { ...left!, segments: leftSegs };
      right = { ...right!, segments: rightSegs };
    }
    rows.push({ ours: left, theirs: right, same: a === b });
  }
  return rows;
}

/** assembleMerge joins the text segments and the chosen block results. */
export function assembleMerge(
  segments: MergeSegment[],
  values: string[],
  trailingNewline: boolean,
): string {
  let index = 0;
  const parts = segments.map((seg) => (seg.kind === "text" ? seg.text : (values[index++] ?? "")));
  return parts.join("\n") + (trailingNewline ? "\n" : "");
}

/**
 * assembleForFree keeps resolved blocks and leaves unresolved ones as
 * conflict markers, so switching to whole-file editing never throws away
 * work or hides a conflict.
 */
export function assembleForFree(
  segments: MergeSegment[],
  values: string[],
  resolved: boolean[],
  trailingNewline: boolean,
): string {
  let index = 0;
  const parts = segments.map((seg) => {
    if (seg.kind === "text") return seg.text;
    const i = index++;
    if (resolved[i]) return values[i] ?? "";
    return `<<<<<<< ${seg.label}\n${seg.ours.join("\n")}\n=======\n${seg.theirs.join("\n")}\n>>>>>>> ${seg.endLabel}`;
  });
  return parts.join("\n") + (trailingNewline ? "\n" : "");
}
