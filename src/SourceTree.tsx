import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Git, type RepoFile } from "./mygo";
import { buildChangeTree } from "./changes";
import { expandedTo, filterFiles, matchIndices, visibleFiles } from "./explorer";
import { FileTree, type ChangeView, type ListedFile } from "./FileTree";
import { useFileMenu } from "./FileMenu";
import { FileIcon, Icon } from "./icons";
import { cx, IconButton, Spinner, useStoredState } from "./ui";
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
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    viewTree: "Group by folder",
    viewFlat: "Plain file list",
    trackedCount: "{n} files",
    matchHint: "Type to match names · ↑↓ step · Enter opens · Esc clears",
    matchCount: "{at}/{total}",
    matchNone: "nothing matches",
    clearMatch: "Clear the match",
  },
  zh: {
    title: "文件",
    search: "按路径筛选",
    refresh: "重新读取工作区",
    openRepositoryFirst: "请先打开仓库",
    noFiles: "没有文件",
    noMatch: "没有路径匹配“{query}”",
    untracked: "尚未被 git 跟踪",
    expandAll: "全部展开",
    collapseAll: "全部折叠",
    viewTree: "按目录分组",
    viewFlat: "平铺文件列表",
    trackedCount: "{n} 个文件",
    matchHint: "直接键入匹配文件名 · ↑↓ 切换 · Enter 打开 · Esc 清除",
    matchCount: "{at}/{total}",
    matchNone: "没有匹配",
    clearMatch: "清除匹配",
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
  onIgnore,
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
  onIgnore: (paths: string[]) => void;
}) {
  const t = useT(T);
  const [files, setFiles] = useState<ExplorerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useStoredState<ChangeView>("gitjet.sourceView", "tree");
  const [nonce, setNonce] = useState(0);
  const menu = useFileMenu({
    root,
    onChanged: () => setNonce((n) => n + 1),
    onError: onActionError,
    onIgnore,
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

  // Typing anywhere that is not a text field matches the names of the files on
  // screen. The tree keeps every row; the match only lights up the characters
  // that were typed and picks one row to step through, so a keystroke never
  // hides the file you were looking at.
  const [typing, setTyping] = useState<{ q: string; at: number }>({ q: "", at: 0 });
  // In the flat view every file is on screen, in the same order FileTree draws
  // them; stepping through a collapsed tree's rows would miss what is shown.
  const rows = useMemo(
    () =>
      viewMode === "flat"
        ? [...visible].sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }))
        : visibleFiles(visible, shownExpanded),
    [viewMode, visible, shownExpanded],
  );
  const matches = useMemo(() => {
    if (typing.q === "") return [] as { path: string; hits: number[] }[];
    const found: { path: string; hits: number[] }[] = [];
    for (const row of rows) {
      const hits = matchIndices(row.path.slice(row.path.lastIndexOf("/") + 1), typing.q);
      if (hits) found.push({ path: row.path, hits });
    }
    return found;
  }, [rows, typing.q]);
  const at = matches.length === 0 ? -1 : Math.min(typing.at, matches.length - 1);
  const hit = at >= 0 ? matches[at] : undefined;
  const hits = useMemo(() => new Map(matches.map((m) => [m.path, m.hits])), [matches]);

  // The keyboard handler is registered once and reads the latest values
  // through a mirror: re-subscribing per keystroke could drop the characters
  // typed between a render and its effect.
  const live = useRef({ q: "", matches, at, open: onOpen });
  live.current = { q: typing.q, matches, at, open: onOpen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as Element | null;
      if (isTextTarget(target) || isTextTarget(document.activeElement)) return;
      // A dialog owns the keyboard while it is up, even with nothing focused.
      if (document.querySelector(".modal-overlay")) return;
      const state = live.current;
      if (e.key === "Escape") {
        if (state.q === "") return;
        e.preventDefault();
        setTyping({ q: "", at: 0 });
        return;
      }
      if (e.key === "Backspace") {
        if (state.q === "") return;
        e.preventDefault();
        setTyping((s) => ({ q: s.q.slice(0, -1), at: 0 }));
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const total = state.matches.length;
        if (total === 0) return;
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setTyping((s) => {
          const from = Math.min(s.at, total - 1);
          return { q: s.q, at: (from + step + total) % total };
        });
        return;
      }
      if (e.key === "Enter") {
        const pick = state.at >= 0 ? state.matches[state.at] : undefined;
        if (!pick) return;
        e.preventDefault();
        state.open(pick.path);
        return;
      }
      if (e.key.length !== 1) return;
      // A space only scrolls: it starts a match when there is one to extend.
      if (state.q === "" && e.key === " ") return;
      e.preventDefault();
      setTyping((s) => ({ q: s.q + e.key, at: 0 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The stepped row must be reachable without the mouse: scroll it into the
  // explorer's own viewport, and no further.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hit) return;
    const row = bodyRef.current?.querySelector(`[data-path="${CSS.escape(hit.path)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [hit]);

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
        {typing.q !== "" && (
          <span className="explorer-match" title={t("matchHint")}>
            <span className="explorer-match-text">{typing.q}</span>
            <span className="explorer-match-count">
              {matches.length === 0
                ? t("matchNone")
                : t("matchCount", { at: at + 1, total: matches.length })}
            </span>
            <button
              className="explorer-clear"
              title={t("clearMatch")}
              onClick={() => setTyping({ q: "", at: 0 })}
            >
              <Icon name="close" size={11} />
            </button>
          </span>
        )}
        <span className="spacer" />
        {loading && <Spinner />}
        <IconButton
          icon="expand"
          title={t("expandAll")}
          small
          disabled={!repoOpen || viewMode === "flat"}
          onClick={() => setExpanded(expandedTo(buildChangeTree(visible), 99))}
        />
        <IconButton
          icon="collapse"
          title={t("collapseAll")}
          small
          disabled={!repoOpen || viewMode === "flat"}
          onClick={() => setExpanded(new Set())}
        />
        <IconButton
          icon={viewMode === "tree" ? "list" : "folder"}
          title={viewMode === "tree" ? t("viewFlat") : t("viewTree")}
          small
          disabled={!repoOpen}
          onClick={() => setViewMode(viewMode === "tree" ? "flat" : "tree")}
        />
        <IconButton icon="refresh" title={t("refresh")} small onClick={() => setNonce((n) => n + 1)} disabled={!repoOpen} />
      </div>
      <div
        className="explorer-body"
        ref={bodyRef}
        onContextMenu={(e) => menu.openMenu(e, { path: "", isDir: true })}
      >
        {visible.length === 0 ? (
          <div className="explorer-empty muted">
            {files.length === 0 ? (repoOpen ? t("noFiles") : t("openRepositoryFirst")) : t("noMatch", { query })}
          </div>
        ) : (
          <FileTree
            files={visible}
            view={viewMode}
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
                    activePath === file.path && "selected",
                    hit?.path === file.path && "match-current",
                  )}
                  style={{ paddingLeft: 6 + depth * 12 }}
                  data-path={file.path}
                  title={file.untracked ? `${file.path}\n${t("untracked")}` : file.path}
                  onClick={() => onOpen(file.path)}
                  onContextMenu={(e) => menu.openMenu(e, { path: file.path, isDir: false })}
                >
                  <span className="tree-chevron-spacer" />
                  <FileIcon path={file.path} size={14} />
                  <span className="tree-name">
                    <span className="file-base">
                      <Matched name={name} hits={hits.get(file.path)} />
                    </span>
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

/** Whether an element is somewhere the keyboard types text: a field, the
 *  editor, or any editable host. Those keep their keys. */
function isTextTarget(el: Element | null): boolean {
  if (!el) return false;
  const node = el as HTMLElement;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return node.closest?.(".cm-editor") != null;
}

/** A file name with the characters the typed match landed on lit up. Runs of
 *  neighbouring matches share one mark, so "app" is one highlight, not three. */
function Matched({ name, hits }: { name: string; hits?: number[] }) {
  if (!hits || hits.length === 0) return <>{name}</>;
  const parts: ReactNode[] = [];
  let start = 0;
  let i = 0;
  while (i < hits.length) {
    let end = i;
    while (end + 1 < hits.length && hits[end + 1] === hits[end]! + 1) end++;
    const from = hits[i]!;
    const to = hits[end]! + 1;
    if (from > start) parts.push(name.slice(start, from));
    parts.push(
      <mark key={from} className="file-match">
        {name.slice(from, to)}
      </mark>,
    );
    start = to;
    i = end + 1;
  }
  if (start < name.length) parts.push(name.slice(start));
  return <>{parts}</>;
}
