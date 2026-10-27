/** Filtering and initial expansion for the source explorer's project tree.
 *
 *  Both are pure: the panel owns the data and the expansion set, so a refresh
 *  or a fresh query cannot mutate the tree it is showing. */

import type { TreeNode } from "./changes";

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
