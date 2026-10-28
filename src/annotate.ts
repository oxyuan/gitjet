import type { BlameLine, FileDiff } from "./mygo";

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

/** The colour band of every annotated line: one band per commit, assigned in
 *  line order, so neighbouring commits always differ and one commit keeps the
 *  same band wherever it reappears. Uncommitted lines get -1. */
export function commitBands(lines: BlameLine[]): Map<number, number> {
  const bands = new Map<number, number>();
  const byCommit = new Map<string, number>();
  let next = 0;
  for (const line of [...lines].sort((a, b) => a.line - b.line)) {
    if (line.uncommitted) {
      bands.set(line.line, -1);
      continue;
    }
    let band = byCommit.get(line.commit);
    if (band === undefined) {
      band = next++ % 6;
      byCommit.set(line.commit, band);
    }
    bands.set(line.line, band);
  }
  return bands;
}

/** The annotation column's local calendar day: fixed-width and sortable. */
export function annotateDate(unix: number): string {
  if (!unix) return "";
  const date = new Date(unix * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
