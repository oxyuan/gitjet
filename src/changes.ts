/** Turning a flat list of changed files into the folder view both the
 *  changelist and the commit details show.
 *
 *  Directories are the default unit: they start collapsed and carry the
 *  totals of everything underneath, so a review sees the shape of a change
 *  before it sees every file. */

/** Anything with a repository-relative path can be listed. */
export interface TreeFile {
  path: string;
}

/** The mutable node used while the tree is being built. */
interface Draft<T extends TreeFile> {
  name: string;
  path: string;
  children: Draft<T>[];
  file?: T;
}

export interface TreeDir<T extends TreeFile> {
  name: string;
  path: string;
  isDir: true;
  children: TreeNode<T>[];
}

export interface TreeLeaf<T extends TreeFile> {
  name: string;
  path: string;
  isDir: false;
  file: T;
}

export type TreeNode<T extends TreeFile> = TreeDir<T> | TreeLeaf<T>;

/**
 * Groups files into directories, folding a chain of directories that holds
 * nothing but the next directory into one row ("dao/src/main" instead of
 * three nested rows), keyed by the outermost directory it covers. Directories
 * come before files, both sorted case-insensitively.
 */
export function buildChangeTree<T extends TreeFile>(files: T[]): TreeNode<T>[] {
  const root: Draft<T> = { name: "", path: "", children: [] };
  const dirs = new Map<string, Draft<T>>([["", root]]);
  for (const file of files) {
    const parts = file.path.split("/");
    let parent = root;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i]!;
      let dir = dirs.get(prefix);
      if (!dir) {
        dir = { name: parts[i]!, path: prefix, children: [] };
        dirs.set(prefix, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push({
      name: parts[parts.length - 1]!,
      path: file.path,
      children: [],
      file,
    });
  }

  const fold = (draft: Draft<T>): TreeNode<T> => {
    if (draft.file) return { name: draft.name, path: draft.path, isDir: false, file: draft.file };
    let name = draft.name;
    let children = draft.children;
    // A directory whose only child is another directory reads as one path.
    while (children.length === 1 && !children[0]!.file) {
      const only = children[0]!;
      name = `${name}/${only.name}`;
      children = only.children;
    }
    const sorted = [...children].sort(compareDrafts);
    return { name, path: draft.path, isDir: true, children: sorted.map(fold) };
  };

  // The root is not a row of its own, so its children are folded directly.
  return [...root.children].sort(compareDrafts).map(fold);
}

function compareDrafts<T extends TreeFile>(a: Draft<T>, b: Draft<T>): number {
  const aDir = !a.file;
  const bDir = !b.file;
  if (aDir !== bDir) return aDir ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Every file under a node, including the node itself when it is a file. */
export function treeFiles<T extends TreeFile>(node: TreeNode<T>): T[] {
  if (!node.isDir) return [node.file];
  return node.children.flatMap(treeFiles);
}

/** Counts for a directory row: files below it plus their line deltas. */
export function treeTotals<T extends TreeFile>(
  node: TreeNode<T>,
  stats: (file: T) => { additions: number; deletions: number },
): { files: number; additions: number; deletions: number } {
  const files = treeFiles(node);
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    const s = stats(file);
    additions += s.additions;
    deletions += s.deletions;
  }
  return { files: files.length, additions, deletions };
}

/** Keys of every directory, for a tree that starts fully collapsed. */
export function directoryKeys<T extends TreeFile>(nodes: TreeNode<T>[]): string[] {
  const keys: string[] = [];
  const walk = (node: TreeNode<T>) => {
    if (!node.isDir) return;
    keys.push(node.path);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return keys;
}

/**
 * Splits a changelist into the files git tracks and the ones it does not,
 * so untracked files never sit mixed in with modified ones.
 */
export function splitTracked<T extends { kind: string }>(files: T[]): { tracked: T[]; untracked: T[] } {
  const tracked: T[] = [];
  const untracked: T[] = [];
  for (const file of files) {
    if (file.kind === "untracked") untracked.push(file);
    else tracked.push(file);
  }
  return { tracked, untracked };
}
