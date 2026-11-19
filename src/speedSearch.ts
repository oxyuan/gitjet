/**
 * IDEA's `TableSpeedSearch` order for a list of paths: a file name that starts
 * with the query wins, then one that contains it, then the whole path. The
 * search wraps around from `from`, so typing while the last row is selected
 * finds the first row again.
 */
export function speedSearchMatch(paths: string[], query: string, from = 0): number {
  const needle = query.trim().toLowerCase();
  if (needle === "" || paths.length === 0) return -1;
  const name = (path: string) => path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const order = paths.map((_, offset) => (from + offset) % paths.length);
  const tests: ((path: string) => boolean)[] = [
    (path) => name(path).startsWith(needle),
    (path) => name(path).includes(needle),
    (path) => path.toLowerCase().includes(needle),
  ];
  for (const matches of tests) {
    for (const index of order) {
      const path = paths[index];
      if (path !== undefined && matches(path)) return index;
    }
  }
  return -1;
}

/**
 * The same walk for a plain-text list (a stash message, a notice): a row that
 * starts with the query wins, then one that contains it, wrapping from `from`.
 */
export function textSpeedSearch(rows: string[], query: string, from = 0): number {
  const needle = query.trim().toLowerCase();
  if (needle === "" || rows.length === 0) return -1;
  const order = rows.map((_, offset) => (from + offset) % rows.length);
  const tests: ((row: string) => boolean)[] = [
    (row) => row.toLowerCase().startsWith(needle),
    (row) => row.toLowerCase().includes(needle),
  ];
  for (const matches of tests) {
    for (const index of order) {
      const row = rows[index];
      if (row !== undefined && matches(row)) return index;
    }
  }
  return -1;
}
