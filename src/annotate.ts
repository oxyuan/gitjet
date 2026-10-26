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
