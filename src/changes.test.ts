import { describe, expect, it } from "bun:test";
import { buildChangeTree, directoryKeys, splitTracked, treeFiles, treeTotals, type TreeNode } from "./changes";

interface File {
  path: string;
  kind: string;
  additions: number;
  deletions: number;
}

const file = (path: string, additions = 1, deletions = 0, kind = "modified"): File => ({
  path,
  kind,
  additions,
  deletions,
});

const names = (nodes: TreeNode<File>[]): string[] =>
  nodes.map((node) => (node.isDir ? `${node.name}/` : node.name));

/** Children of a node, empty for a file, so tests need no casts. */
const childrenOf = (node: TreeNode<File> | undefined): TreeNode<File>[] =>
  node && node.isDir ? node.children : [];

describe("buildChangeTree", () => {
  it("groups files by directory, directories first and sorted", () => {
    const tree = buildChangeTree([file("b/x.java"), file("A.java"), file("a/y.java")]);
    expect(names(tree)).toEqual(["a/", "b/", "A.java"]);
    expect(names(childrenOf(tree[0]))).toEqual(["y.java"]);
  });

  it("folds a chain of single-directory children into one row", () => {
    const tree = buildChangeTree([file("beijia/platform/service/Pay.java")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("beijia/platform/service");
    // The row keeps the outer directory as its key, so it stays stable.
    expect(tree[0]!.path).toBe("beijia");
  });

  it("keeps a directory that also holds files as its own row", () => {
    const tree = buildChangeTree([file("dao/Pay.java"), file("dao/impl/PayImpl.java")]);
    expect(tree[0]!.name).toBe("dao");
    expect(names(childrenOf(tree[0]))).toEqual(["impl/", "Pay.java"]);
  });

  it("counts every file below a directory and sums their lines", () => {
    const tree = buildChangeTree([file("a/x.java", 3, 1), file("a/b/y.java", 2, 4), file("z.java", 5, 5)]);
    const dir = tree.find((node) => node.isDir)!;
    expect(treeTotals(dir, (f) => f)).toEqual({ files: 2, additions: 5, deletions: 5 });
  });

  it("starts collapsed by listing every directory key", () => {
    const tree = buildChangeTree([file("a/b/x.java"), file("c/y.java")]);
    expect(directoryKeys(tree).sort()).toEqual(["a", "c"]);
    expect(treeFiles(tree[0]!).map((f) => f.path)).toEqual(["a/b/x.java"]);
  });
});

describe("splitTracked", () => {
  it("separates files git does not track from the rest", () => {
    const { tracked, untracked } = splitTracked([
      file("a.java"),
      file("new.html", 0, 0, "untracked"),
      file("b.java", 1, 1, "deleted"),
      file("doc/x.sql", 0, 0, "untracked"),
    ]);
    expect(tracked.map((f) => f.path)).toEqual(["a.java", "b.java"]);
    expect(untracked.map((f) => f.path)).toEqual(["new.html", "doc/x.sql"]);
  });
});
