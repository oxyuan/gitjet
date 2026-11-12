import type { FileDiff } from "./mygo";

/** One run of changed lines in the new side of a file. */
export type ChangeRange = {
  /** 1-based line the bar sits on. */
  start: number;
  /** How many lines the bar covers; 0 for a deletion. */
  count: number;
  /** `mod` is a line that exists on both sides with different text, `add` a
   *  line only the new side has, `del` a removal anchored at the line after
   *  it — the three tones an IDE's change gutter draws. */
  kind: "add" | "del" | "mod";
  /** The hunk it belongs to, which is what rollback names. */
  hunk: number;
};

/** Turns a file diff into the bars a change gutter draws.
 *
 *  A replaced block is one modification, not an unrelated deletion and
 *  insertion: the overlapping lines are `mod` and only the surplus is an
 *  `add` or a `del`. That is how the IDE marks every changed line rather
 *  than the first line of a block. A deletion has no line of its own, so it
 *  becomes one marker on the line after it (or the line after the paired
 *  lines when only part of a block was replaced). */
export function changeRanges(diff: FileDiff | null): ChangeRange[] {
  if (!diff || diff.binary || !diff.hunks?.length) return [];
  const ranges: ChangeRange[] = [];
  diff.hunks.forEach((hunk, index) => {
    let lastNew = hunk.newStart > 0 ? hunk.newStart : 1;
    // One run between two context lines: git lists the deletions first and
    // the additions after them.
    let dels = 0;
    let addStart = 0;
    let adds = 0;
    const flush = () => {
      if (dels === 0 && adds === 0) return;
      const paired = Math.min(dels, adds);
      if (paired > 0) ranges.push({ start: addStart, count: paired, kind: "mod", hunk: index });
      if (adds > paired) ranges.push({ start: addStart + paired, count: adds - paired, kind: "add", hunk: index });
      if (dels > paired) {
        // After the lines that still exist the surplus deletions get the
        // wedge; a pure deletion sits on the first line of the new side.
        const at = adds > 0 ? addStart + paired : Math.min(lastNew + 1, hunk.newStart + Math.max(hunk.newLines, 1));
        ranges.push({ start: at, count: 0, kind: "del", hunk: index });
      }
      dels = 0;
      adds = 0;
      addStart = 0;
    };
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        if (adds === 0) addStart = line.newNo;
        adds++;
        lastNew = line.newNo;
        continue;
      }
      if (line.kind === "del") {
        dels++;
        continue;
      }
      flush();
      lastNew = line.newNo;
    }
    flush();
  });
  return ranges.sort((a, b) => a.start - b.start || Number(a.kind === "del") - Number(b.kind === "del"));
}

/** How strongly a blame row is tinted, 0 being the freshest and 5 the oldest,
 *  so a file reads as a gradient of age. The depth comes from the commit's own
 *  timestamp, so every line of one commit gets the same tint. Uncommitted
 *  lines are marked separately by the caller (-1). */
export function blameDepth(unix: number, now = Date.now() / 1000): number {
  const days = unix > 0 ? Math.max(0, now - unix) / 86400 : Infinity;
  if (days <= 7) return 0;
  if (days <= 30) return 1;
  if (days <= 90) return 2;
  if (days <= 180) return 3;
  if (days <= 365) return 4;
  return 5;
}

/** The annotation column's local calendar day: fixed-width and sortable. */
export function annotateDate(unix: number): string {
  if (!unix) return "";
  const date = new Date(unix * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
