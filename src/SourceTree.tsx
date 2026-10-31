import { useEffect, useMemo, useState } from "react";
import { Git, type RepoFile } from "./mygo";
import { buildChangeTree } from "./changes";
import { expandedTo, filterFiles } from "./explorer";
import { FileTree, type ListedFile } from "./FileTree";
import { useFileMenu } from "./FileMenu";
import { FileIcon, Icon } from "./icons";
import { cx, IconButton, Spinner } from "./ui";
import { useT } from "./i18n";

const T = {
  en: {
    title: "Files",
    search: "Filter by path",
    refresh: "Re-read the working tree",
    openRepositoryFirst: "Open a repository first",
    noFiles: "No files",
    noMatch: "No path matches “{query}”",
    untracked: "Not tracked by git yet",
    trackedCount: "{n} files",
  },
  zh: {
    title: "文件",
    search: "按路径筛选",
    refresh: "重新读取工作区",
    openRepositoryFirst: "请先打开仓库",
    noFiles: "没有文件",
    noMatch: "没有路径匹配“{query}”",
    untracked: "尚未被 git 跟踪",
    trackedCount: "{n} 个文件",
  },
} as const;

/** A listed file plus the one fact the explorer adds: whether git knows it. */
type ExplorerRow = ListedFile & { untracked: boolean };

/** The project tree: every file in the working tree, opened as source rather
 *  than as a diff. It is the view for reading code, so it lists untracked
 *  files too and has no idea what changed. */
export function SourceTree({
  repoOpen,
  root,
  reloadKey,
  activePath,
  onOpen,
  onError,
  onActionError,
}: {
  repoOpen: boolean;
  /** Absolute repository root, for the copy-path choices. */
  root: string;
  /** Changes whenever the working tree might have: branch, file count. */
  reloadKey: string;
  activePath?: string;
  onOpen: (path: string) => void;
  onError: (err: unknown) => void;
  /** A failed create/rename/delete, reported apart from a failed read. */
  onActionError: (err: unknown) => void;
}) {
  const t = useT(T);
  const [files, setFiles] = useState<ExplorerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string>("");
  const [nonce, setNonce] = useState(0);
  const menu = useFileMenu({
    root,
    onChanged: () => setNonce((n) => n + 1),
    onError: onActionError,
  });

  useEffect(() => {
    if (!repoOpen) {
      setFiles([]);
      return;
    }
    let alive = true;
    setLoading(true);
    Git.tree()
      .then((list: RepoFile[]) => {
        if (!alive) return;
        setFiles(list.map((f) => ({ path: f.path, tracked: f.tracked, additions: 0, deletions: 0, untracked: !f.tracked })));
        setExpanded(expandedTo(buildChangeTree(list), 1));
      })
      .catch((err) => {
        if (alive) onError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // onError is recreated on every render of the app; the fetch must not be.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoOpen, reloadKey, nonce]);

  const visible = useMemo(() => filterFiles(files, query), [files, query]);
  const filtered = query.trim() !== "";

  // A filter is a search result, not a browsing session: the tree opens fully
  // so matches are visible rather than hidden inside collapsed folders.
  const shownExpanded = useMemo(
    () => (filtered ? expandedTo(buildChangeTree(visible), 99) : expanded),
    [filtered, visible, expanded],
  );

  const toggleDir = (key: string) => {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  return (
    <div className="source-tree-panel">
      <div className="panel-toolbar explorer-toolbar">
        <span className="explorer-search">
          <Icon name="search" size={13} />
          <input
            className="explorer-input"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={repoOpen ? t("search") : t("openRepositoryFirst")}
            disabled={!repoOpen}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              setQuery("");
            }}
          />
          {query !== "" && (
            <button className="explorer-clear" onClick={() => setQuery("")} title={t("search")}>
              <Icon name="close" size={11} />
            </button>
          )}
        </span>
        <span className="spacer" />
        {loading && <Spinner />}
        <IconButton icon="refresh" title={t("refresh")} small onClick={() => setNonce((n) => n + 1)} disabled={!repoOpen} />
      </div>
      <div
        className="explorer-body"
        onContextMenu={(e) => menu.openMenu(e, { path: "", isDir: true })}
      >
        {visible.length === 0 ? (
          <div className="explorer-empty muted">
            {files.length === 0 ? (repoOpen ? t("noFiles") : t("openRepositoryFirst")) : t("noMatch", { query })}
          </div>
        ) : (
          <FileTree
            files={visible}
            expanded={shownExpanded}
            onToggleDir={toggleDir}
            indent={6}
            onDirContextMenu={(node, e) => menu.openMenu(e, { path: node.path, isDir: true })}
            renderFile={(file, depth, flat) => {
              const slash = file.path.lastIndexOf("/");
              const name = slash < 0 ? file.path : file.path.slice(slash + 1);
              const dir = slash < 0 ? "" : file.path.slice(0, slash + 1);
              return (
                <div
                  className={cx(
                    "tree-row file",
                    flat && "flat",
                    file.untracked && "untracked",
                    (activePath === file.path || picked === file.path) && "selected",
                  )}
                  style={{ paddingLeft: 6 + depth * 12 }}
                  title={file.untracked ? `${file.path}\n${t("untracked")}` : file.path}
                  onClick={() => setPicked(file.path)}
                  onDoubleClick={() => onOpen(file.path)}
                  onContextMenu={(e) => menu.openMenu(e, { path: file.path, isDir: false })}
                >
                  <span className="tree-chevron-spacer" />
                  <FileIcon path={file.path} size={14} />
                  <span className="tree-name">
                    <span className="file-base">{name}</span>
                    {flat && dir !== "" && <span className="file-dir">{dir}</span>}
                  </span>
                  {file.untracked && <span className="untracked-dot" title={t("untracked")} />}
                </div>
              );
            }}
          />
        )}
      </div>
      {menu.menuNode}
    </div>
  );
}
