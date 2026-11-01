/** Filtering, matching and initial expansion for the source explorer's project
 *  tree.
 *
 *  All of it is pure: the panel owns the data and the expansion set, so a
 *  refresh or a fresh query cannot mutate the tree it is showing. */

import { buildChangeTree, type TreeNode } from "./changes";

/** A working-tree path, tracked or not. */
export interface ExplorerFile {
  path: string;
  tracked: boolean;
}

/**
 * Keeps the files whose path contains the query's characters in order
 * ("srcts" finds "src/mygo.ts"), case-insensitively. An empty query keeps
 * everything, and the order of the input is preserved so the tree stays
 * sorted by path.
 */
export function filterFiles<T extends { path: string }>(files: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return files;
  const kept: T[] = [];
  for (const file of files) {
    const haystack = file.path.toLowerCase();
    let i = 0;
    for (let c = 0; c < haystack.length && i < needle.length; c++) {
      if (haystack[c] === needle[i]) i++;
    }
    if (i === needle.length) kept.push(file);
  }
  return kept;
}

/** Every directory key down to `depth` levels, so a project tree opens with
 *  its top folder visible instead of a single collapsed row. */
export function expandedTo<T extends { path: string }>(nodes: TreeNode<T>[], depth = 1): Set<string> {
  const keys = new Set<string>();
  const walk = (node: TreeNode<T>, level: number) => {
    if (!node.isDir) return;
    if (level < depth) keys.add(node.path);
    node.children.forEach((child) => walk(child, level + 1));
  };
  nodes.forEach((node) => walk(node, 0));
  return keys;
}

/**
 * Where a query's characters land in `name`, or null when it does not contain
 * them all in order. Matched a character at a time, so the positions index the
 * string the caller drew, and case-insensitively, so "spt" finds "SourceTree"
 * at 0, 6 and 10.
 */
export function matchIndices(name: string, query: string): number[] | null {
  const needle = query.toLowerCase();
  if (needle === "") return null;
  const hits: number[] = [];
  let at = 0;
  for (let c = 0; c < name.length && at < needle.length; c++) {
    if (name.charAt(c).toLowerCase() === needle.charAt(at)) {
      hits.push(c);
      at++;
    }
  }
  return at === needle.length ? hits : null;
}

/**
 * The files a tree is actually showing, in the order it draws them: a
 * directory's children count only while it is open, so what the eye sees and
 * what the keyboard steps through are the same list.
 */
export function visibleFiles<T extends { path: string }>(
  files: T[],
  expanded: ReadonlySet<string>,
): T[] {
  const shown: T[] = [];
  const walk = (nodes: TreeNode<T>[]) => {
    for (const node of nodes) {
      if (!node.isDir) shown.push(node.file);
      else if (expanded.has(node.path)) walk(node.children);
    }
  };
  walk(buildChangeTree(files));
  return shown;
}
