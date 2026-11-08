import { highlightTree } from "@lezer/highlight";
import { loadLanguage } from "./editor";
import { classHighlighter } from "./highlight";
import type { WordSegment } from "./diff";

/** A coloured run inside one line, with offsets relative to that line. */
export interface TokenSpan {
  from: number;
  to: number;
  cls: string;
}

/** Tokens of one whole text, keyed by 1-based line number. */
export type LineTokens = Map<number, TokenSpan[]>;

/** Above this, parsing costs more than the colours are worth; the diff still
 *  renders, plainly. */
const maxHighlightBytes = 400_000;

/**
 * Reads a text with the grammar for `language` and returns the colour of
 * every line it could parse. Grammars are error tolerant, so an unfinished
 * document still gets most of its tokens. Unknown languages and texts too
 * large to be worth it return null, which the caller renders as plain text.
 */
export async function tokenize(text: string, language: string): Promise<LineTokens | null> {
  if (text === "" || language === "" || language === "plain" || text.length > maxHighlightBytes) return null;
  const support = await loadLanguage(language);
  const parser = support?.language.parser;
  if (!parser) return null;

  const starts = lineStarts(text);
  const byLine: LineTokens = new Map();
  const tree = parser.parse(text);
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    // A token can cross a newline (a block comment, a template literal), so
    // it is cut at every line boundary it spans.
    let index = lineIndexAt(starts, from);
    let start = from;
    while (index < starts.length) {
      const lineEnd = index + 1 < starts.length ? starts[index + 1]! - 1 : text.length;
      if (to <= lineEnd) {
        push(byLine, index + 1, start - starts[index]!, to - starts[index]!, classes);
        return;
      }
      if (lineEnd > start) push(byLine, index + 1, start - starts[index]!, lineEnd - starts[index]!, classes);
      index++;
      start = lineEnd + 1;
    }
  });
  return byLine;
}

function push(byLine: LineTokens, line: number, from: number, to: number, cls: string) {
  if (to <= from) return;
  const spans = byLine.get(line);
  const span = { from, to, cls };
  if (spans) spans.push(span);
  else byLine.set(line, [span]);
}

/** Offsets at which each line starts, so a token offset can be attributed to
 *  a line with a binary search instead of a scan per token. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineIndexAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** A run of one line's text with the classes it should be painted with. */
export interface Piece {
  text: string;
  cls: string;
}

/**
 * Layers syntax colours and word-level change marks over one line.
 *
 * Both are ranges over the same text, so the line is cut at every boundary
 * either of them introduces: a keyword that is also part of the changed word
 * keeps its colour and gains the change background. With neither input the
 * line comes back as one unclassed piece.
 */
export function paintLine(
  text: string,
  tokens?: readonly TokenSpan[],
  segments?: readonly WordSegment[],
): Piece[] {
  if (text === "") return [{ text: "", cls: "" }];
  const bounds = new Set<number>([0, text.length]);
  for (const token of tokens ?? []) {
    bounds.add(clamp(token.from, text.length));
    bounds.add(clamp(token.to, text.length));
  }
  const changed = changedRuns(segments);
  for (const [from, to] of changed) {
    bounds.add(clamp(from, text.length));
    bounds.add(clamp(to, text.length));
  }
  const cuts = [...bounds].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i]!;
    const to = cuts[i + 1]!;
    if (to <= from) continue;
    const classes = [tokenClassAt(tokens, from)];
    if (isChanged(changed, from)) classes.push("word-changed");
    const cls = classes.filter(Boolean).join(" ");
    const last = pieces[pieces.length - 1];
    if (last && last.cls === cls) last.text += text.slice(from, to);
    else pieces.push({ text: text.slice(from, to), cls });
  }
  return pieces.length > 0 ? pieces : [{ text, cls: "" }];
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}

/** The offsets a word-diff marked as changed. The segments concatenate to the
 *  line, so their starts are a running total. */
function changedRuns(segments?: readonly WordSegment[]): [number, number][] {
  if (!segments) return [];
  const runs: [number, number][] = [];
  let offset = 0;
  for (const segment of segments) {
    if (segment.changed) runs.push([offset, offset + segment.text.length]);
    offset += segment.text.length;
  }
  return runs;
}

function isChanged(runs: [number, number][], offset: number): boolean {
  for (const [from, to] of runs) {
    if (offset >= from && offset < to) return true;
    if (offset < from) break;
  }
  return false;
}

function tokenClassAt(tokens: readonly TokenSpan[] | undefined, offset: number): string {
  if (!tokens) return "";
  for (const token of tokens) {
    if (offset >= token.from && offset < token.to) return token.cls;
    if (offset < token.from) break;
  }
  return "";
}
