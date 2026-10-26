import { useEffect, useMemo, useRef, useState } from "react";
import type { Commit, CommitDetail, CommitFile, LogResult } from "./mygo";
import { computeGraph, graphWidth } from "./graph";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { count } from "./i18n";
import {
  ContextMenu,
  cx,
  formatStamp,
  IconButton,
  RefChip,
  Spinner,
  StatusMark,
  useStoredState,
  type ContextItem,
} from "./ui";
import { AuthorPicker, type AuthorOption } from "./AuthorPicker";
import { FileTree, type ChangeView } from "./FileTree";

/** Widths of the fixed columns of the history list, in pixels. */
interface LogColumns {
  hash: number;
  refs: number;
  author: number;
  time: number;
}

const DEFAULT_COLUMNS: LogColumns = { hash: 58, refs: 210, author: 92, time: 116 };
const COLUMN_LIMITS: Record<keyof LogColumns, [number, number]> = {
  hash: [40, 140],
  refs: [60, 460],
  author: [50, 220],
  time: [70, 220],
};

function clampColumn(key: keyof LogColumns, value: number): number {
  const [min, max] = COLUMN_LIMITS[key];
  return Math.round(Math.min(max, Math.max(min, value)));
}

const T = {
  en: {
    title: "History",
    refresh: "Refresh",
    fetchAll: "Fetch all remotes",
    searchCommits: "Search commits",
    clearSearch: "Clear search",
    loadMoreCommits: "Load more commits",
    noCommits: "No commits",
    noMatch: "No commit matches “{search}”.",
    loadingCommits: "Loading commits",
    selectCommit: "Select a commit to see its details",
    authored: "authored {date}",
    committedBy: "committed by {name} {date}",
    copyHash: "Copy hash",
    filesChangedOne: "1 file changed",
    filesChangedOther: "{n} files changed",
    stepFiles: "↑ ↓ switch files",
    openSource: "Open source at this commit",
    showHistory: "Show file history",
    checkoutRevision: "Checkout Revision",
    newBranchHere: "New Branch from Here…",
    newTag: "New Tag…",
    cherryPick: "Cherry-Pick",
    revertCommit: "Revert Commit",
    resetSoft: "Reset Current Branch to Here — Soft",
    resetMixed: "Reset Current Branch to Here — Mixed",
    resetHard: "Reset Current Branch to Here — Hard",
    copyRevision: "Copy Revision Number",
    copyMessage: "Copy Commit Message",
    scope: "History of {branch}",
    clearScope: "Show the checked out branch instead",
    inBranchesOne: "In 1 branch",
    inBranchesOther: "In {n} branches",
    resizeDetails: "Drag to resize",
    mergeParents: "Merge",
    collapsePanel: "Hide the history panel",
    expandPanel: "Show the history panel",
    viewTree: "Group by folder",
    viewFlat: "Plain file list",
    moreRefs: "Also: {names}",
    resizeColumn: "Drag to resize this column",
  },
  zh: {
    title: "历史",
    refresh: "刷新",
    fetchAll: "获取所有远程仓库",
    searchCommits: "搜索提交",
    clearSearch: "清除搜索",
    loadMoreCommits: "加载更多提交",
    noCommits: "没有提交",
    noMatch: "没有匹配“{search}”的提交。",
    loadingCommits: "正在加载提交",
    selectCommit: "选择一个提交以查看详情",
    authored: "作者提交于 {date}",
    committedBy: "由 {name} 提交于 {date}",
    copyHash: "复制提交哈希",
    filesChangedOne: "1 个文件已更改",
    filesChangedOther: "{n} 个文件已更改",
    stepFiles: "↑ ↓ 切换文件",
    openSource: "打开该提交下的源文件",
    showHistory: "查看文件历史",
    checkoutRevision: "检出此提交",
    newBranchHere: "从此处新建分支…",
    newTag: "新建标签…",
    cherryPick: "摘取提交",
    revertCommit: "还原提交",
    resetSoft: "将当前分支重置到此处 — 软重置",
    resetMixed: "将当前分支重置到此处 — 混合重置",
    resetHard: "将当前分支重置到此处 — 硬重置",
    copyRevision: "复制提交哈希",
    copyMessage: "复制提交信息",
    scope: "历史：{branch}",
    clearScope: "回到当前分支",
    inBranchesOne: "在 1 个分支中",
    inBranchesOther: "在 {n} 个分支中",
    resizeDetails: "拖动调整高度",
    mergeParents: "合并",
    collapsePanel: "收起历史面板",
    expandPanel: "展开历史面板",
    viewTree: "按目录分组",
    viewFlat: "平铺文件列表",
    moreRefs: "另有：{names}",
    resizeColumn: "拖动调整列宽",
  },
} as const;

const ROW = 26;
const MID = 13;

/** Commit history on the left and the selected commit on the right. */
export function LogDock({
  result,
  detail,
  loading,
  selected,
  selectedFile,
  search,
  author,
  authors,
  scope,
  onClearScope,
  height,
  onResize,
  collapsed,
  onToggleCollapsed,
  viewMode,
  onViewMode,
  infoRatio,
  onInfoResize,
  onSelect,
  onOpenCommit,
  onSelectFile,
  onStepFile,
  onSearch,
  onAuthor,
  onRefresh,
  onFetch,
  onLoadMore,
  onCopy,
  onOpenSource,
  onShowHistory,
  onCheckout,
  onNewBranch,
  onNewTag,
  onCherryPick,
  onRevert,
  onReset,
}: {
  result: LogResult | null;
  detail: CommitDetail | null;
  loading: boolean;
  selected: string | null;
  selectedFile: string | null;
  search: string;
  author: string;
  authors: AuthorOption[];
  /** Branch whose history is listed; "" when it follows HEAD. */
  scope: string;
  onClearScope: () => void;
  height: number;
  onResize: (h: number) => void;
  /** The panel folds to its toolbar so the editor gets the whole window. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** How the changed files of the commit are listed. */
  viewMode: ChangeView;
  onViewMode: (view: ChangeView) => void;
  /** Share of the details pane taken by the commit information block. */
  infoRatio: number;
  onInfoResize: (ratio: number) => void;
  onSelect: (commit: Commit) => void;
  onOpenCommit: (hash: string) => void;
  onSelectFile: (file: CommitFile) => void;
  onStepFile: (delta: number) => void;
  onSearch: (s: string) => void;
  onAuthor: (name: string) => void;
  onRefresh: () => void;
  onFetch: () => void;
  onLoadMore: () => void;
  onCopy: (text: string) => void;
  onOpenSource: (path: string, revision: string) => void;
  onShowHistory: (path: string) => void;
  onCheckout: (ref: string) => void;
  onNewBranch: (start: string) => void;
  onNewTag: (start: string) => void;
  onCherryPick: (hash: string) => void;
  onRevert: (hash: string) => void;
  onReset: (hash: string, mode: "soft" | "mixed" | "hard") => void;
}) {
  const t = useT(T);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const fileRowRef = useRef<HTMLDivElement>(null);
  const [fileDirs, setFileDirs] = useState<Set<string>>(new Set());
  const [storedCols, setStoredCols] = useStoredState<LogColumns>("gitjet.logColumns", DEFAULT_COLUMNS);
  const cols: LogColumns = { ...DEFAULT_COLUMNS, ...storedCols };

  // Arrow keys switch files, so the details pane takes focus with the commit.
  useEffect(() => {
    if (!detail) return;
    detailRef.current?.focus({ preventScroll: true });
  }, [detail?.hash]);

  // Directories of the changed files start collapsed for every commit.
  useEffect(() => {
    setFileDirs(new Set());
  }, [detail?.hash]);

  // Keep the highlighted file visible while the arrow keys walk the list.
  useEffect(() => {
    fileRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedFile]);
  const commits = result?.commits ?? [];
  const graph = useMemo(() => computeGraph(commits), [commits]);
  const width = useMemo(() => graphWidth(graph), [graph]);

  // Dragging a column edge resizes the column to its left; the columns to the
  // right of the message are laid out from the end, so they grow leftwards.
  const startColumn = (key: keyof LogColumns, direction: 1 | -1) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = cols[key];
    const move = (ev: MouseEvent) => {
      setStoredCols({ ...cols, [key]: clampColumn(key, startWidth + (ev.clientX - startX) * direction) });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("col-resizing");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("col-resizing");
  };

  const startResize = (e: React.MouseEvent) => {
    drag.current = { y: e.clientY, h: height };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const next = Math.max(160, Math.min(window.innerHeight - 260, drag.current.h - (ev.clientY - drag.current.y)));
      onResize(next);
    };
    const up = () => {
      drag.current = null;
      document.body.classList.remove("resizing-row");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    document.body.classList.add("resizing-row");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // The files list and the commit's information share the details pane and
  // the divider between them moves.
  const startInfoResize = (e: React.MouseEvent) => {
    const startY = e.clientY;
    const startRatio = infoRatio;
    const pane = detailRef.current?.getBoundingClientRect().height ?? 0;
    if (pane <= 0) return;
    const move = (ev: MouseEvent) => {
      const next = Math.min(0.85, Math.max(0.16, startRatio + (startY - ev.clientY) / pane));
      onInfoResize(Math.round(next * 1000) / 1000);
    };
    const up = () => {
      document.body.classList.remove("resizing-row");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    document.body.classList.add("resizing-row");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const commitMenu = (commit: Commit, x: number, y: number) => {
    const items: ContextItem[] = [
      { label: t("checkoutRevision"), icon: "branch", onClick: () => onCheckout(commit.hash) },
      { label: t("newBranchHere"), icon: "plus", onClick: () => onNewBranch(commit.hash) },
      { label: t("newTag"), icon: "tag", onClick: () => onNewTag(commit.hash) },
      { separator: true },
      { label: t("cherryPick"), icon: "cherry", onClick: () => onCherryPick(commit.hash) },
      { label: t("revertCommit"), icon: "revert", onClick: () => onRevert(commit.hash) },
      { separator: true },
      { label: t("resetSoft"), icon: "reset", onClick: () => onReset(commit.hash, "soft") },
      { label: t("resetMixed"), icon: "reset", onClick: () => onReset(commit.hash, "mixed") },
      { label: t("resetHard"), icon: "reset", danger: true, onClick: () => onReset(commit.hash, "hard") },
      { separator: true },
      { label: t("copyRevision"), icon: "copy", onClick: () => onCopy(commit.hash) },
      { label: t("copyMessage"), icon: "copy", onClick: () => onCopy(commit.message) },
    ];
    setMenu({ x, y, items });
  };

  const step = (e: React.KeyboardEvent) => {
    if (!detail) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      onStepFile(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onStepFile(-1);
    }
  };

  return (
    <section className={cx("log-dock", collapsed && "collapsed")} style={{ height: collapsed ? undefined : height }}>
      {collapsed && (
        <div className="log-dock-head" onClick={onToggleCollapsed} title={t("expandPanel")}>
          <button className="log-collapse" aria-expanded={false}>
            <Icon name="chevronUp" size={12} />
          </button>
          <span className="log-title">{t("title")}</span>
          {detail && (
            <span className="log-dock-head-sub">
              <code>{detail.short}</code>
              <span>{detail.subject}</span>
            </span>
          )}
        </div>
      )}
      {!collapsed && <div className="log-dock-resizer" onMouseDown={startResize} />}
      <div className="log-dock-body" hidden={collapsed}>
        <div className="log-history">
          <div className="panel-toolbar">
            <button
              className="log-collapse"
              title={t("collapsePanel")}
              aria-expanded
              onClick={onToggleCollapsed}
            >
              <Icon name="chevronDown" size={12} />
            </button>
            <span className="log-title">{t("title")}</span>
            <IconButton icon="refresh" title={t("refresh")} onClick={onRefresh} spinner={loading} />
            <IconButton icon="fetch" title={t("fetchAll")} onClick={onFetch} />
            <span className="toolbar-sep" />
            <div className="search-field log-search">
              <Icon name="search" size={13} />
              <input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder={t("searchCommits")}
                aria-label={t("searchCommits")}
              />
              {search && (
                <button className="search-clear" onClick={() => onSearch("")} aria-label={t("clearSearch")}>
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
            <AuthorPicker authors={authors} value={author} onChange={onAuthor} />
            {scope && (
              <button className="log-scope" title={t("clearScope")} onClick={onClearScope}>
                <Icon name="branch" size={11} />
                <span>{t("scope", { branch: scope })}</span>
                <Icon name="close" size={11} />
              </button>
            )}
            <span className="spacer" />
            <IconButton
              icon="download"
              title={t("loadMoreCommits")}
              onClick={onLoadMore}
              disabled={!result?.hasMore || loading}
            />
          </div>
          <div
            className="log-cols"
            style={
              {
                "--col-hash": `${cols.hash}px`,
                "--col-refs": `${cols.refs}px`,
                "--col-author": `${cols.author}px`,
                "--col-time": `${cols.time}px`,
              } as React.CSSProperties
            }
          >
            <span className="log-cols-graph" style={{ width }} />
            <span className="log-col" style={{ width: cols.hash }}>
              <span className="col-grip" title={t("resizeColumn")} onMouseDown={startColumn("hash", 1)} />
            </span>
            <span className="log-col flexible" />
            <span className="log-col end" style={{ width: cols.refs }}>
              <span className="col-grip start" title={t("resizeColumn")} onMouseDown={startColumn("refs", -1)} />
            </span>
            <span className="log-col end" style={{ width: cols.author }}>
              <span className="col-grip start" title={t("resizeColumn")} onMouseDown={startColumn("author", -1)} />
            </span>
            <span className="log-col end" style={{ width: cols.time }} />
          </div>
          <div
            className="log-list"
            role="listbox"
            style={
              {
                "--col-hash": `${cols.hash}px`,
                "--col-refs": `${cols.refs}px`,
                "--col-author": `${cols.author}px`,
                "--col-time": `${cols.time}px`,
              } as React.CSSProperties
            }
          >
            {commits.length === 0 && !loading && (
              <div className="changes-empty">
                <Icon name="log" size={20} />
                <span>{t("noCommits")}</span>
                {search && <span className="muted">{t("noMatch", { search })}</span>}
              </div>
            )}
            {commits.map((commit, i) => {
              const row = graph[i]!;
              return (
                <div
                  key={commit.hash}
                  role="option"
                  aria-selected={selected === commit.hash}
                  className={cx(
                    "log-row",
                    commit.parents.length > 1 && "merge",
                    selected === commit.hash && "selected",
                  )}
                  onClick={() => onSelect(commit)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    commitMenu(commit, e.clientX, e.clientY);
                  }}
                >
                  <svg className="graph" width={width} height={ROW} aria-hidden="true">
                    {row.before.map((hash, lane) =>
                      hash && lane !== row.lane ? (
                        <line
                          key={"b" + lane}
                          x1={10 + lane * 14}
                          y1={0}
                          x2={10 + lane * 14}
                          y2={ROW}
                          className={cx(`lane-${lane % 6}`, row.faint[lane] && "faint")}
                        />
                      ) : null,
                    )}
                    {row.before[row.lane] && (
                      <line
                        x1={10 + row.lane * 14}
                        y1={0}
                        x2={10 + row.lane * 14}
                        y2={MID}
                        className={cx(`lane-${row.lane % 6}`, row.faint[row.lane] && "faint")}
                      />
                    )}
                    {row.edges.map((target, e) => (
                      <path
                        key={"e" + e}
                        d={
                          target === row.lane
                            ? `M ${10 + row.lane * 14} ${MID} L ${10 + row.lane * 14} ${ROW}`
                            : `M ${10 + row.lane * 14} ${MID} C ${10 + row.lane * 14} ${MID + 12}, ${10 + target * 14} ${ROW - 12}, ${10 + target * 14} ${ROW}`
                        }
                        className={cx(`lane-${target % 6}`, row.faint[target] && "faint")}
                      />
                    ))}
                    <circle
                      cx={10 + row.lane * 14}
                      cy={MID}
                      r={4.6}
                      className={cx("graph-dot", `lane-${row.lane % 6}`, commit.parents.length > 1 && "merge")}
                    />
                  </svg>
                  <span className="log-hash">{commit.short}</span>
                  <span className="log-subject" title={commit.subject}>
                    {commit.subject}
                  </span>
                  {commit.refs.length > 0 && (
                    <span className="log-refs">
                      {commit.refs.slice(0, 2).map((ref, ri) => (
                        <RefChip key={ri} name={ref.name} type={ref.type} head={ref.head} />
                      ))}
                      {commit.refs.length > 2 && (
                        <span
                          className="log-refs-more"
                          title={t("moreRefs", {
                            names: commit.refs.slice(2).map((ref) => ref.name).join(", "),
                          })}
                        >
                          +{commit.refs.length - 2}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="log-author" title={commit.author}>
                    {commit.author}
                  </span>
                  <span className="log-time">{formatStamp(commit.authorTime)}</span>
                </div>
              );
            })}
            {loading && (
              <div className="log-loading">
                <Spinner label={t("loadingCommits")} />
              </div>
            )}
            {result?.hasMore && !loading && (
              <button className="load-more" onClick={onLoadMore}>
                {t("loadMoreCommits")}
              </button>
            )}
          </div>
        </div>
        <div
          ref={detailRef}
          className="log-detail"
          tabIndex={0}
          role="region"
          aria-label={detail?.short ?? t("selectCommit")}
          onKeyDown={step}
        >
          {!detail ? (
            <div className="log-detail-empty">
              <Icon name="commit" size={18} />
              <span>{t("selectCommit")}</span>
            </div>
          ) : (
            <>
              <div className="log-detail-files">
                <div className="log-detail-files-head">
                  <button
                    className="toolbar-text-btn"
                    title={viewMode === "tree" ? t("viewFlat") : t("viewTree")}
                    onClick={() => onViewMode(viewMode === "tree" ? "flat" : "tree")}
                  >
                    <Icon name={viewMode === "tree" ? "list" : "folder"} size={12} />
                  </button>
                  <span className="spacer" />
                  <span className="details-stats">
                    {count(detail.stats.files, t("filesChangedOne"), t("filesChangedOther", { n: detail.stats.files }))}
                    {detail.stats.additions > 0 && <span className="add-count"> +{detail.stats.additions}</span>}
                    {detail.stats.deletions > 0 && <span className="del-count"> −{detail.stats.deletions}</span>}
                  </span>
                </div>
                <div className="log-detail-files-list">
                  <FileTree
                    files={detail.files}
                    view={viewMode}
                    expanded={fileDirs}
                    onToggleDir={(key) =>
                      setFileDirs((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    indent={8}
                    renderFile={(file, depth, flat) => (
                      <div
                        ref={selectedFile === file.path ? fileRowRef : undefined}
                        style={{ marginLeft: depth * 12 }}
                        className={cx("details-file", selectedFile === file.path && "selected")}
                        onClick={() => onSelectFile(file)}
                        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                      >
                      <StatusMark kind={file.status} />
                      <span className="details-file-path">
                        <span className="file-base">{file.path.slice(file.path.lastIndexOf("/") + 1)}</span>
                        {flat && file.path.includes("/") && (
                          <span className="file-dir">{file.path.slice(0, file.path.lastIndexOf("/") + 1)}</span>
                        )}
                      </span>
                      <button
                        className="mini-icon"
                        title={t("openSource")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSource(file.path, detail.hash);
                        }}
                      >
                        <Icon name="file" size={12} />
                      </button>
                      <button
                        className="mini-icon"
                        title={t("showHistory")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onShowHistory(file.path);
                        }}
                      >
                        <Icon name="log" size={12} />
                      </button>
                      <span className="tree-stats">
                        {file.additions > 0 && <span className="add-count">+{file.additions}</span>}
                        {file.deletions > 0 && <span className="del-count">−{file.deletions}</span>}
                      </span>
                      </div>
                    )}
                  />
                </div>
              </div>
              <div
                className="log-detail-split"
                onMouseDown={startInfoResize}
                title={t("resizeDetails")}
              />
              <div className="log-detail-info" style={{ flexBasis: `${infoRatio * 100}%` }}>
                <div className="log-detail-subject">{detail.subject}</div>
                <div className="log-detail-meta">
                  <button className="hash-copy" title={t("copyHash")} onClick={() => onCopy(detail.hash)}>
                    <Icon name="hash" size={11} />
                    <code>{detail.short}</code>
                    <Icon name="copy" size={11} />
                  </button>
                  <span className="bp-avatar">{(detail.author || "?").slice(0, 1).toUpperCase()}</span>
                  <span className="log-detail-author" title={detail.authorEmail}>
                    {detail.author}
                  </span>
                  <span className="muted">{formatStamp(detail.authorTime)}</span>
                </div>
                {detail.parents.length > 1 && (
                  <div className="log-detail-merge">
                    <span>{t("mergeParents")}</span>
                    {detail.parents.map((parent) => (
                      <button
                        key={parent}
                        className="merge-parent"
                        title={parent}
                        onClick={() => onOpenCommit(parent)}
                      >
                        {parent.slice(0, 8)}
                      </button>
                    ))}
                  </div>
                )}
                {detail.committer !== detail.author && (
                  <div className="log-detail-meta muted">
                    {t("committedBy", { name: detail.committer, date: formatStamp(detail.commitTime) })}
                  </div>
                )}
                {detail.refs.length > 0 && (
                  <div className="log-detail-refs">
                    {detail.refs.map((r, i) => (
                      <RefChip key={i} name={r.name} type={r.type} head={r.head} />
                    ))}
                  </div>
                )}
                {detail.branches.length > 0 && (
                  <div className="log-detail-branches">
                    <span className="log-detail-branches-count">
                      {count(detail.branches.length, t("inBranchesOne"), t("inBranchesOther", { n: detail.branches.length }))}
                    </span>
                    <div className="log-detail-branch-names">
                      {detail.branches.map((name) => (
                        <span key={name} className="log-detail-branch">
                          <Icon name="branch" size={10} />
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {detail.body && <pre className="details-body">{detail.body}</pre>}
              </div>
              <div className="log-detail-foot">
                <span>{t("stepFiles")}</span>
              </div>
            </>
          )}
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </section>
  );
}
