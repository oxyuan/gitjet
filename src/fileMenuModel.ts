import { baseName, joinRoot } from "./paths";

/** The row a context menu was opened on. An empty path is the repository
 *  root, which is what a right-click on the panel background means. */
export interface FileMenuTarget {
  path: string;
  isDir: boolean;
  /** 1-based line for "Copy File Reference", when the view knows one. */
  line?: number;
}

/** Where a new file or directory starts: the selected directory, or the
 *  parent of the selected file. Absolute paths are the caller's job. */
export function newEntryPrefix(target: FileMenuTarget): string {
  if (target.path === "") return "";
  if (target.isDir) return target.path.replace(/\/+$/, "") + "/";
  const cut = target.path.lastIndexOf("/");
  return cut < 0 ? "" : target.path.slice(0, cut + 1);
}

/** The strings behind the Copy Path/Reference submenu. */
export function menuPathValues(root: string, target: FileMenuTarget) {
  const path = target.path;
  const absolute = path === "" ? root : root ? joinRoot(root, path) : path;
  return {
    absolute,
    name: path === "" ? "" : baseName(path),
    contentRoot: path,
    reference: target.line && target.line > 0 ? `${path}:${target.line}` : path,
    repositoryRoot: root,
  };
}
