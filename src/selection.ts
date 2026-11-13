import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** A half-open document range, in offsets. */
export type SelectionRange = { from: number; to: number };

/** The identifier around `pos`, digits included: IDEA's "Select Word at
 *  Caret" selects numbers too, and no other command here treats them as
 *  navigable names. */
export function identifierRange(state: EditorState, pos: number): SelectionRange | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  while (start > 0 && /[\w$]/.test(text[start - 1] ?? "")) start--;
  while (end < text.length && /[\w$]/.test(text[end] ?? "")) end++;
  if (start === end) return null;
  return { from: line.from + start, to: line.from + end };
}

/** One step of IDEA's "Extend Selection": the word, then the line, then the
 *  smallest enclosing syntax node larger than what is selected, up to the
 *  document. Returns null at the document, which is where the IDE stops. */
export function expandSelection(state: EditorState): SelectionRange | null {
  const main = state.selection.main;
  const from = main.from;
  const to = main.to;
  if (from === to) {
    const word = identifierRange(state, from);
    if (word) return word;
    const line = state.doc.lineAt(from);
    return { from: line.from, to: line.to };
  }
  // A language without a grammar still has lines and a document.
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  if (first.from < from || last.to > to) return { from: first.from, to: last.to };

  // The tree nests, so the smallest node that strictly contains the current
  // range is the next syntactic step; a node with the same range adds nothing.
  const nodes: SelectionRange[] = [];
  type SyntaxRange = { from: number; to: number; parent: SyntaxRange | null };
  let node: SyntaxRange | null = syntaxTree(state).resolveInner(from, 1);
  while (node) {
    if (node.from <= from && node.to >= to && (node.from < from || node.to > to)) {
      nodes.push({ from: node.from, to: node.to });
    }
    node = node.parent;
  }
  nodes.sort((a, b) => a.to - a.from - (b.to - b.from));
  const next = nodes[0];
  if (next) return next;

  if (from > 0 || to < state.doc.length) return { from: 0, to: state.doc.length };
  return null;
}
