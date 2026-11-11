import type { AlignedRow } from "./diff";

/** One occurrence of the query in a line, as character offsets. */
export interface SearchSpan {
  from: number;
  to: number;
}

/**
 * One occurrence the diff viewer can navigate to. A context row draws the
 * same text in both panes, so it is one hit that marks both sides rather
 * than two hits for one visible match.
 */
export interface SearchHit extends SearchSpan {
  /** Index into the aligned rows, which is what `data-row` carries. */
  row: number;
  side: "left" | "right";
  /** A context row's hit belongs to both sides of a split view. */
  both: boolean;
  /** Line number on the side the hit belongs to. */
  line: number;
}

/**
 * findSpans locates every non-overlapping occurrence of `query`, in text
 * order. Folding and syntax colouring never reach this: it works on the
 * line's own text, so a match under a word mark or inside a folded run is
 * still found.
 */
export function findSpans(text: string, query: string, matchCase = false): SearchSpan[] {
  if (query === "") return [];
  // A regex match reports offsets in the original string, unlike a lowercased
  // copy, so a case folding that changes length cannot shift a mark.
  const needle = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(needle, matchCase ? "gu" : "giu");
  const spans: SearchSpan[] = [];
  for (const match of text.matchAll(pattern)) {
    const from = match.index ?? 0;
    spans.push({ from, to: from + match[0].length });
  }
  return spans;
}

/**
 * searchRows finds the query in both versions of every row, in reading
 * order. A context row whose sides are identical is reported once with
 * `both`, because it is visibly one match even though the split viewer draws
 * it twice; a changed pair really has two texts, so each side counts.
 */
export function searchRows(rows: readonly AlignedRow[], query: string, matchCase = false): SearchHit[] {
  if (query === "") return [];
  const hits: SearchHit[] = [];
  rows.forEach((row, index) => {
    if (row.kind === "context" && row.left && row.right && row.left.text === row.right.text) {
      for (const span of findSpans(row.right.text, query, matchCase)) {
        hits.push({ row: index, side: "right", both: true, line: row.right.no, ...span });
      }
      return;
    }
    if (row.left) {
      for (const span of findSpans(row.left.text, query, matchCase)) {
        hits.push({ row: index, side: "left", both: false, line: row.left.no, ...span });
      }
    }
    if (row.right) {
      for (const span of findSpans(row.right.text, query, matchCase)) {
        hits.push({ row: index, side: "right", both: false, line: row.right.no, ...span });
      }
    }
  });
  return hits;
}

interface Markable {
  text: string;
  cls: string;
}

/**
 * markSearch cuts painted pieces at every match boundary and tags the runs
 * that fall inside one, so a search hit keeps the syntax and word-diff
 * colours underneath it. The active hit is tagged as well, and wins where a
 * merged piece would otherwise lose it.
 */
export function markSearch<T extends Markable>(
  pieces: readonly T[],
  spans: readonly SearchSpan[],
  active?: SearchSpan,
): T[] {
  if (spans.length === 0) return pieces as T[];
  const inside = (from: number, span: SearchSpan) => from >= span.from && from < span.to;
  const marks = (from: number): string => {
    const hit = spans.some((span) => inside(from, span));
    if (!hit) return "";
    return active && inside(from, active) ? "search-hit search-current" : "search-hit";
  };
  const out: T[] = [];
  let offset = 0;
  for (const piece of pieces) {
    const start = offset;
    const end = offset + piece.text.length;
    const cuts = new Set<number>([start, end]);
    for (const span of spans) {
      if (span.from > start && span.from < end) cuts.add(span.from);
      if (span.to > start && span.to < end) cuts.add(span.to);
    }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i]!;
      const to = points[i + 1]!;
      if (to <= from) continue;
      const mark = marks(from);
      const cls = mark === "" ? piece.cls : `${piece.cls} ${mark}`.trim();
      const text = piece.text.slice(from - start, to - start);
      const last = out[out.length - 1];
      if (last && last.cls === cls) last.text += text;
      else out.push({ ...piece, cls, text });
    }
    offset = end;
  }
  return out;
}
