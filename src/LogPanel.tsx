import { useMemo, useRef, useState } from "react";
import type { Commit, CommitDetail, CommitFile, LogResult, RefsSnapshot } from "./mygo";
import { computeGraph, graphWidth } from "./graph";
import { Icon } from "./icons";
import {
  ContextMenu,
  cx,
  formatFullDate,
  formatWhen,
  IconButton,
  RefChip,
  Spinner,
  StatusMark,
  type ContextItem,
} from "./ui";

export type LogBranchFilter = "all" | "current" | string;

export function LogPanel({
  result,
  detail,
  refs,
  loading,
  selected,
  filter,
  search,
  onFilter,
  onSearch,
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
  onOpenFile,
  onOpenSource,
  onShowFileHistory,
}: {
  result: LogResult | null;
  detail: CommitDetail | null;
  refs: RefsSnapshot | null;
  loading: boolean;
  selected: string | null;
  filter: LogBranchFilter;
  search: string;
  onFilter: (f: LogBranchFilter) => void;
  onSearch: (s: string) => void;
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
  onOpenFile: (hash: string, file: CommitFile) => void;
  onOpenSource: (path: string, revision: string) => void;
  onShowFileHistory: (path: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [detailsHeight, setDetailsHeight] = useState(280);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const commits = result?.commits ?? [];
  const graph = useMemo(() => computeGraph(commits), [commits]);
  const width = useMemo(() => graphWidth(graph), [graph]);

  const onDetailsDrag = (e: React.MouseEvent) => {
    drag.current = { y: e.clientY, h: detailsHeight };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const next = Math.max(140, Math.min(window.innerHeight - 260, drag.current.h - (ev.clientY - drag.current.y)));
      setDetailsHeight(next);
      document.body.classList.add("resizing-row");
    };
    const up = () => {
      drag.current = null;
      document.body.classList.remove("resizing-row");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const commitMenu = (commit: Commit, x: number, y: number) => {
    const items: ContextItem[] = [
      { label: "Checkout Revision", icon: "branch", onClick: () => onCheckout(commit.hash) },
      { label: "New Branch from Here…", icon: "plus", onClick: () => onNewBranch(commit.hash) },
      { label: "New Tag…", icon: "tag", onClick: () => onNewTag(commit.hash) },
      { separator: true },
      { label: "Cherry-Pick", icon: "cherry", onClick: () => onCherryPick(commit.hash) },
      { label: "Revert Commit", icon: "revert", onClick: () => onRevert(commit.hash) },
      { separator: true },
      { label: "Reset Current Branch to Here — Soft", icon: "reset", onClick: () => onReset(commit.hash, "soft") },
      { label: "Reset Current Branch to Here — Mixed", icon: "reset", onClick: () => onReset(commit.hash, "mixed") },
      { label: "Reset Current Branch to Here — Hard", icon: "reset", danger: true, onClick: () => onReset(commit.hash, "hard") },
      { separator: true },
      { label: "Copy Revision Number", icon: "copy", onClick: () => onCopy(commit.hash) },
      { label: "Copy Commit Message", icon: "copy", onClick: () => onCopy(commit.message) },
    ];
    setMenu({ x, y, items });
  };

  return (
    <div className="log-panel">
      <div className="panel-toolbar">
        <IconButton icon="refresh" title="Refresh" onClick={onRefresh} spinner={loading} />
        <IconButton icon="fetch" title="Fetch all remotes" onClick={onFetch} />
        <span className="toolbar-sep" />
        <select
          className="select compact"
          value={filter === "all" || filter === "current" ? filter : filter}
          onChange={(e) => onFilter(e.target.value)}
          title="Branch filter"
        >
          <option value="current">Current branch</option>
          <option value="all">All branches</option>
          {refs?.local.map((r) => (
            <option key={r.fullName} value={r.name}>
              {r.name}
            </option>
          ))}
          {refs?.remote.map((r) => (
            <option key={r.fullName} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
        <div className="search-field">
          <Icon name="search" size={13} />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search commits"
            aria-label="Search commits"
          />
          {search && (
            <button className="search-clear" onClick={() => onSearch("")} aria-label="Clear search">
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
        <span className="spacer" />
        <IconButton
          icon="download"
          title="Load more commits"
          onClick={onLoadMore}
          disabled={!result?.hasMore || loading}
        />
      </div>
      <div className="log-list" role="listbox">
        {commits.length === 0 && !loading && (
          <div className="changes-empty">
            <Icon name="log" size={20} />
            <span>No commits</span>
            {search && <span className="muted">No commit matches “{search}”.</span>}
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
              <svg className="graph" width={width} height={24} aria-hidden="true">
                {row.before.map((hash, lane) =>
                  hash && lane !== row.lane ? (
                    <line
                      key={"b" + lane}
                      x1={10 + lane * 14}
                      y1={0}
                      x2={10 + lane * 14}
                      y2={24}
                      className={`lane-${lane % 6}`}
                    />
                  ) : null,
                )}
                {row.lane && row.before[row.lane] && (
                  <line
                    x1={10 + row.lane * 14}
                    y1={0}
                    x2={10 + row.lane * 14}
                    y2={12}
                    className={`lane-${row.lane % 6}`}
                  />
                )}
                {row.edges.map((target, e) => (
                  <path
                    key={"e" + e}
                    d={
                      target === row.lane
                        ? `M ${10 + row.lane * 14} 12 L ${10 + row.lane * 14} 24`
                        : `M ${10 + row.lane * 14} 12 C ${10 + row.lane * 14} 20, ${10 + target * 14} 16, ${10 + target * 14} 24`
                    }
                    className={`lane-${target % 6}`}
                  />
                ))}
                <circle
                  cx={10 + row.lane * 14}
                  cy={12}
                  r={4.6}
                  className={cx("graph-dot", `lane-${row.lane % 6}`)}
                />
              </svg>
              <span className="log-hash">{commit.short}</span>
              {commit.refs.slice(0, 4).map((ref, ri) => (
                <RefChip key={ri} name={ref.name} type={ref.type} head={ref.head} />
              ))}
              <span className="log-subject">{commit.subject}</span>
              <span className="log-meta">
                {commit.author} · {formatWhen(commit.authorTime)}
              </span>
            </div>
          );
        })}
        {loading && (
          <div className="log-loading">
            <Spinner label="Loading commits" />
          </div>
        )}
        {result?.hasMore && !loading && (
          <button className="load-more" onClick={onLoadMore}>
            Load more commits
          </button>
        )}
      </div>
      <div className="details-resizer" onMouseDown={onDetailsDrag} />
      <div className="commit-details" style={{ height: detailsHeight }}>
        {!detail ? (
          <div className="details-empty">
            <Icon name="log" size={18} />
            <span>Select a commit to see its details</span>
          </div>
        ) : (
          <div className="details-scroll">
            <div className="details-title">
              {detail.refs.map((r, i) => (
                <RefChip key={i} name={r.name} type={r.type} head={r.head} />
              ))}
              <span className="details-subject">{detail.subject}</span>
            </div>
            <div className="details-meta">
              <span className="details-avatar" title={detail.authorEmail}>
                {detail.author.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <b>{detail.author}</b> &lt;{detail.authorEmail}&gt;
              </span>
              <span className="muted">authored {formatFullDate(detail.authorTime)}</span>
              {detail.committer !== detail.author && (
                <span className="muted">
                  committed by {detail.committer} {formatFullDate(detail.commitTime)}
                </span>
              )}
            </div>
            <div className="details-hash-row">
              <Icon name="hash" size={12} />
              <code>{detail.hash}</code>
              <button className="mini-btn" onClick={() => onCopy(detail.hash)}>
                Copy
              </button>
            </div>
            {detail.body && <pre className="details-body">{detail.body}</pre>}
            <div className="details-stats">
              {detail.stats.files} files changed
              {detail.stats.additions > 0 && <span className="add-count"> +{detail.stats.additions}</span>}
              {detail.stats.deletions > 0 && <span className="del-count"> −{detail.stats.deletions}</span>}
            </div>
            <div className="details-files">
              {detail.files.map((file) => (
                <div
                  className="details-file"
                  key={file.path}
                  onClick={() => onOpenFile(detail.hash, file)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { label: "Show Diff", icon: "diff", onClick: () => onOpenFile(detail.hash, file) },
                        { label: "Open Source File", icon: "file", onClick: () => onOpenSource(file.path, detail.hash) },
                        { label: "Show History", icon: "log", onClick: () => onShowFileHistory(file.path) },
                        { label: "Copy Path", icon: "copy", onClick: () => onCopy(file.path) },
                      ],
                    });
                  }}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                >
                  <StatusMark kind={file.status} />
                  <span className="details-file-path">
                    {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  </span>
                  <span className="tree-stats">
                    {file.additions > 0 && <span className="add-count">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="del-count">−{file.deletions}</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
