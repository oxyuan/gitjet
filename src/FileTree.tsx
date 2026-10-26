import type { ReactNode } from "react";
import { buildChangeTree, treeFiles, treeTotals, type TreeNode, type TreeFile } from "./changes";
import { Icon } from "./icons";
import { cx } from "./ui";

/** A changed file as the tree needs it: a path and its line counts. */
export interface ListedFile extends TreeFile {
  additions: number;
  deletions: number;
}

/**
 * The folder view of a change: directories hold their files and start
 * collapsed, so the first look shows modules and totals, not every path.
 *
 * Expansion is owned by the caller, which is also what lets "expand all" and
 * refresh behave: the keys are directory paths, so they survive a rebuild of
 * the tree.
 */
export function FileTree<T extends ListedFile>({
  files,
  expanded,
  onToggleDir,
  renderFile,
  renderDirLead,
  indent = 6,
  step = 12,
}: {
  files: T[];
  expanded: ReadonlySet<string>;
  onToggleDir: (key: string) => void;
  renderFile: (file: T, depth: number) => ReactNode;
  /** Extra controls shown before the folder icon of a directory row. */
  renderDirLead?: (node: TreeNode<T>) => ReactNode;
  indent?: number;
  step?: number;
}) {
  const nodes = buildChangeTree(files);
  return <>{nodes.map((node) => renderNode(node, 0))}</>;

  function renderNode(node: TreeNode<T>, depth: number): ReactNode {
    if (!node.isDir) {
      return <div key={"f:" + node.path}>{renderFile(node.file, depth)}</div>;
    }
    const open = expanded.has(node.path);
    const totals = treeTotals(node, (file) => file);
    return (
      <div key={"d:" + node.path}>
        <div
          className={cx("tree-row dir", open && "expanded")}
          style={{ paddingLeft: indent + depth * step }}
          onClick={() => onToggleDir(node.path)}
          title={treeFiles(node)
            .map((file) => file.path)
            .slice(0, 12)
            .join("\n")}
          role="treeitem"
          aria-expanded={open}
        >
          <button className="tree-chevron" tabIndex={-1}>
            <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
          </button>
          {renderDirLead?.(node)}
          <Icon name="folder" />
          <span className="tree-name">{node.name}</span>
          <span className="tree-count">{totals.files}</span>
          <span className="tree-stats">
            {totals.additions > 0 && <span className="add-count">+{totals.additions}</span>}
            {totals.deletions > 0 && <span className="del-count">−{totals.deletions}</span>}
          </span>
        </div>
        {open && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }
}
