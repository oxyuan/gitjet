/** The fields of a commit row the history's speed search reads. */
export interface SpeedRow {
  subject: string;
  short: string;
  author: string;
}

/**
 * IDEA's `TableSpeedSearch` order for the commit table: a subject that starts
 * with what was typed wins, then any subject containing it, then a hash or an
 * author that starts with it, then anything containing it. The search wraps
 * from `from`, so typing with the last row selected finds the first row again.
 */
export function commitSpeedMatch(rows: SpeedRow[], query: string, from = 0): number {
  const needle = query.trim().toLowerCase();
  if (needle === "" || rows.length === 0) return -1;
  const order = rows.map((_, offset) => (from + offset) % rows.length);
  const tests: ((row: SpeedRow) => boolean)[] = [
    (row) => row.subject.toLowerCase().startsWith(needle),
    (row) => row.subject.toLowerCase().includes(needle),
    (row) => row.short.toLowerCase().startsWith(needle) || row.author.toLowerCase().startsWith(needle),
    (row) => row.short.toLowerCase().includes(needle) || row.author.toLowerCase().includes(needle),
  ];
  for (const matches of tests) {
    for (const index of order) {
      const row = rows[index];
      if (row && matches(row)) return index;
    }
  }
  return -1;
}
