import type { FileDiff } from "./mygo";

/** One run of changed lines in the new side of a file. */
export type ChangeRange = {
  /** 1-based line the bar sits on. */
  start: number;
  /** How many lines the bar covers; 0 for a deletion. */
  count: number;
  kind: "add" | "del";
  /** The hunk it belongs to, which is what rollback names. */
  hunk: number;
};

/** Turns a file diff into the bars a change gutter draws.
 *
 *  Added lines become spans; a run of deleted lines becomes one marker on the
 *  line after them (or the hunk's first new line when nothing survives),
 *  which is where an IDE puts the wedge. */
export function changeRanges(diff: FileDiff | null): ChangeRange[] {
  if (!diff || diff.binary || !diff.hunks?.length) return [];
  const ranges: ChangeRange[] = [];
  diff.hunks.forEach((hunk, index) => {
    let lastNew = hunk.newStart > 0 ? hunk.newStart : 1;
    let addStart = 0;
    let addCount = 0;
    let delStart = 0;
    let delCount = 0;
    const flushAdd = () => {
      if (addCount > 0) ranges.push({ start: addStart, count: addCount, kind: "add", hunk: index });
      addStart = 0;
      addCount = 0;
    };
    const flushDel = () => {
      if (delCount > 0) ranges.push({ start: delStart, count: 0, kind: "del", hunk: index });
      delStart = 0;
      delCount = 0;
    };
    for (const line of hunk.lines) {
      if (line.kind === "add") {
        flushDel();
        if (addCount === 0) addStart = line.newNo;
        addCount++;
        lastNew = line.newNo;
        continue;
      }
      flushAdd();
      if (line.kind === "del") {
        if (delCount === 0) delStart = Math.min(lastNew + 1, hunk.newStart + Math.max(hunk.newLines, 1));
        delCount++;
        continue;
      }
      flushDel();
      lastNew = line.newNo;
    }
    flushAdd();
    flushDel();
  });
  return ranges.sort((a, b) => a.start - b.start);
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
