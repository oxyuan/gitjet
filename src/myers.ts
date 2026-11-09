/**
 * Myers diff over two string lists. One implementation serves both the line
 * merge view and the word-level conflict resolver, which compares words,
 * newlines and punctuation markers in the same way.
 */

export type DiffOp =
  | { kind: "equal" | "delete"; aStart: number; aEnd: number; bStart: number; bEnd: number }
  | { kind: "insert"; aStart: number; aEnd: number; bStart: number; bEnd: number };

export type Equality = (a: string, b: string) => boolean;

const exact: Equality = (a, b) => a === b;

/** Common prefix and suffix are trimmed first, which keeps the edit graph
 *  small for the usual case of two similar files. */
export function myersOps(a: readonly string[], b: readonly string[], eq: Equality = exact): DiffOp[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && eq(a[prefix]!, b[prefix]!)) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    eq(a[a.length - 1 - suffix]!, b[b.length - 1 - suffix]!)
  ) {
    suffix++;
  }

  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  const ops: DiffOp[] = [];
  const fallback = (): DiffOp[] => {
    if (prefix > 0) ops.push({ kind: "equal", aStart: 0, aEnd: prefix, bStart: 0, bEnd: prefix });
    if (n > 0) ops.push({ kind: "delete", aStart: prefix, aEnd: prefix + n, bStart: prefix, bEnd: prefix });
    if (m > 0) ops.push({ kind: "insert", aStart: prefix, aEnd: prefix, bStart: prefix, bEnd: prefix + m });
    if (suffix > 0) {
      ops.push({
        kind: "equal",
        aStart: a.length - suffix,
        aEnd: a.length,
        bStart: b.length - suffix,
        bEnd: b.length,
      });
    }
    return ops;
  };

  const max = n + m;
  if (n === 0 || m === 0) return fallback();
  {
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3).fill(-1);
    v[offset + 1] = 0;
    const trace: Int32Array[] = [];
    let done = false;
    for (let d = 0; d <= max && !done; d++) {
      // A pathological diff is not worth an out-of-memory crash: when the
      // trace outgrows its budget, treat the different middle as one change.
      if ((d + 1) * (2 * max + 3) > 4_000_000) return fallback();
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
        else x = v[offset + k - 1]! + 1;
        let y = x - k;
        while (x < n && y < m && x >= 0 && y >= 0 && eq(a[prefix + x]!, b[prefix + y]!)) {
          x++;
          y++;
        }
        v[offset + k] = x;
        if (x >= n && y >= m) {
          done = true;
          break;
        }
      }
    }

    if (!done) return fallback();
    if (prefix > 0) ops.push({ kind: "equal", aStart: 0, aEnd: prefix, bStart: 0, bEnd: prefix });
    const middle: DiffOp[] = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const vd = trace[d]!;
      const k = x - y;
      const prevK =
        k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!) ? k + 1 : k - 1;
      const prevX = vd[offset + prevK]!;
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        middle.push({
          kind: "equal",
          aStart: prefix + x - 1,
          aEnd: prefix + x,
          bStart: prefix + y - 1,
          bEnd: prefix + y,
        });
        x--;
        y--;
      }
      if (d === 0) break;
      if (x === prevX) {
        middle.push({ kind: "insert", aStart: prefix + x, aEnd: prefix + x, bStart: prefix + y - 1, bEnd: prefix + y });
        y--;
      } else {
        middle.push({ kind: "delete", aStart: prefix + x - 1, aEnd: prefix + x, bStart: prefix + y, bEnd: prefix + y });
        x--;
      }
    }
    ops.push(...middle.reverse());
  }

  if (suffix > 0) {
    ops.push({
      kind: "equal",
      aStart: a.length - suffix,
      aEnd: a.length,
      bStart: b.length - suffix,
      bEnd: b.length,
    });
  }
  return ops;
}
