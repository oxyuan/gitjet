import { useMemo, useState } from "react";
import { useT } from "./i18n";
import type { Commit, LogResult, RefsSnapshot } from "./mygo";
import { computeGraph, graphWidth } from "./graph";
import { Icon } from "./icons";
import { ContextMenu, cx, formatStamp, IconButton, RefChip, Spinner, type ContextItem } from "./ui";
import { AuthorPicker, BranchPicker, type AuthorOption } from "./BranchPicker";
import type { BranchLeaf } from "./branches";

const T = {
  en: {
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
    refresh: "Refresh",
    fetchAll: "Fetch all remotes",
    branchFilter: "Branch filter",
    loadMoreCommits: "Load more commits",
    searchCommits: "Search commits",
    clearSearch: "Clear search",
    noCommits: "No commits",
    noMatch: "No commit matches “{search}”.",
    loadingCommits: "Loading commits",
    authored: "authored {date}",
    filesChangedOne: "1 file changed",
    filesChangedOther: "{n} files changed",
  },
  zh: {
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
    refresh: "刷新",
    fetchAll: "获取所有远程仓库",
    branchFilter: "分支筛选",
    loadMoreCommits: "加载更多提交",
    searchCommits: "搜索提交",
    clearSearch: "清除搜索",
    noCommits: "没有提交",
    noMatch: "没有匹配“{search}”的提交。",
    loadingCommits: "正在加载提交",
    authored: "作者提交于 {date}",
    filesChangedOne: "1 个文件已更改",
    filesChangedOther: "{n} 个文件已更改",
  },
} as const;

export type LogBranchFilter = "all" | "current" | string;

/** Height of one log row; the graph lanes are drawn against it. */
const ROW = 38;
const MID = ROW / 2;

export function LogPanel({
  result,
  refs,
  currentBranch,
  loading,
  selected,
  filter,
  search,
  author,
  authors,
  favorites,
  onFilter,
  onSearch,
  onAuthor,
  onToggleFavorite,
  onSelect,
  onRefresh,
  onFetch,
  onLoadMore,
  onCheckout,
  onNewBranch,
  onNewTag,
  onCherryPick,
  onRevert,
  onReset,
  onCopy,
}: {
  result: LogResult | null;
  refs: RefsSnapshot | null;
  currentBranch: string;
  loading: boolean;
  selected: string | null;
  filter: LogBranchFilter;
  search: string;
  author: string;
  authors: AuthorOption[];
  favorites: string[];
  onFilter: (f: LogBranchFilter) => void;
  onSearch: (s: string) => void;
  onAuthor: (name: string) => void;
  onToggleFavorite: (key: string) => void;
  onSelect: (commit: Commit) => void;
  onRefresh: () => void;
  onFetch: () => void;
  onLoadMore: () => void;
  onCheckout: (ref: string) => void;
  onNewBranch: (start: string) => void;
  onNewTag: (start: string) => void;
  onCherryPick: (hash: string) => void;
  onRevert: (hash: string) => void;
  onReset: (hash: string, mode: "soft" | "mixed" | "hard") => void;
  onCopy: (text: string) => void;
}) {
  const t = useT(T);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const commits = result?.commits ?? [];
  const graph = useMemo(() => computeGraph(commits), [commits]);
  const width = useMemo(() => graphWidth(graph), [graph]);

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

  const pickBranch = (leaf: BranchLeaf | "all" | "current") => {
    onFilter(typeof leaf === "string" ? leaf : leaf.name);
  };

  return (
    <div className="log-panel">
      <div className="panel-toolbar">
        <IconButton icon="refresh" title={t("refresh")} onClick={onRefresh} spinner={loading} />
        <IconButton icon="fetch" title={t("fetchAll")} onClick={onFetch} />
        <span className="toolbar-sep" />
        <BranchPicker
          refs={refs}
          current={currentBranch}
          value={filter}
          mode="filter"
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
          onPick={pickBranch}
        />
        <AuthorPicker authors={authors} value={author} onChange={onAuthor} />
        <span className="spacer" />
        <IconButton
          icon="download"
          title={t("loadMoreCommits")}
          onClick={onLoadMore}
          disabled={!result?.hasMore || loading}
        />
      </div>
      <div className="log-search-row">
        <div className="search-field">
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
      </div>
      <div className="log-list" role="listbox">
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
              className={cx("log-row", selected === commit.hash && "selected")}
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
                      className={`lane-${lane % 6}`}
                    />
                  ) : null,
                )}
                {row.before[row.lane] && (
                  <line x1={10 + row.lane * 14} y1={0} x2={10 + row.lane * 14} y2={MID} className={`lane-${row.lane % 6}`} />
                )}
                {row.edges.map((target, e) => (
                  <path
                    key={"e" + e}
                    d={
                      target === row.lane
                        ? `M ${10 + row.lane * 14} ${MID} L ${10 + row.lane * 14} ${ROW}`
                        : `M ${10 + row.lane * 14} ${MID} C ${10 + row.lane * 14} ${MID + 12}, ${10 + target * 14} ${ROW - 12}, ${10 + target * 14} ${ROW}`
                    }
                    className={`lane-${target % 6}`}
                  />
                ))}
                <circle cx={10 + row.lane * 14} cy={MID} r={4.6} className={cx("graph-dot", `lane-${row.lane % 6}`)} />
              </svg>
              <div className="log-main">
                <div className="log-line">
                  <span className="log-hash">{commit.short}</span>
                  {commit.refs.slice(0, 4).map((ref, ri) => (
                    <RefChip key={ri} name={ref.name} type={ref.type} head={ref.head} />
                  ))}
                  <span className="log-subject" title={commit.subject}>
                    {commit.subject}
                  </span>
                </div>
                <div className="log-sub">
                  <span className="log-author" title={commit.author}>
                    {commit.author}
                  </span>
                  <span className="log-dot">·</span>
                  <span className="log-time">{formatStamp(commit.authorTime)}</span>
                </div>
              </div>
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
