import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffOptions, FileDiff } from "./mygo";
import { buildDiffRows, isCollapsed, type AlignedRow, type DiffRows, type WordSegment } from "./diff";
import { Icon } from "./icons";
import { cx, formatWhen, IconButton, Spinner } from "./ui";

type Mode = "split" | "unified";

export function DiffView({
  diff,
  opts,
  mode,
  setMode,
  ignoreWhitespace,
  onToggleWhitespace,
  onApply,
  onApplyFile,
  onBlame,
  onCopyPath,
  busy,
  reloadKey,
}: {
  diff: FileDiff;
  opts: DiffOptions;
  mode: Mode;
  setMode: (m: Mode) => void;
  ignoreWhitespace: boolean;
  onToggleWhitespace: () => void;
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyFile: (action: "stage" | "unstage" | "rollback") => void;
  onBlame?: () => void;
  onCopyPath: () => void;
  busy?: boolean;
  reloadKey: number;
}) {
  const rows = useMemo(() => buildDiffRows(diff), [diff]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(-1);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpanded(new Set());
    setCurrent(-1);
  }, [reloadKey, diff.path]);

  const changeRows = useMemo(
    () => rows.flatMap((row, i) => (isCollapsed(row) ? [] : row.kind !== "context" ? [i] : [])),
    [rows],
  );
  const firstRowOfHunk = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, i) => {
      if (!isCollapsed(row) && !map.has(row.hunk)) map.set(row.hunk, i);
    });
    return map;
  }, [rows]);

  const goto = (delta: number) => {
    if (changeRows.length === 0) return;
    let idx = current;
    if (idx === -1) idx = delta > 0 ? 0 : changeRows.length - 1;
    else idx = (idx + delta + changeRows.length) % changeRows.length;
    setCurrent(idx);
    const rowIndex = changeRows[idx]!;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`);
    el?.scrollIntoView({ block: "center" });
  };

  const canApply = opts.target === "worktree" || opts.target === "staged";
  const fileAction = opts.target === "staged" ? "unstage" : "stage";
  const hunkAction = opts.target === "staged" ? "unstage" : "stage";
  const stats = `${diff.additions > 0 ? "+" + diff.additions : ""}${diff.additions > 0 && diff.deletions > 0 ? " " : ""}${diff.deletions > 0 ? "−" + diff.deletions : ""}`;

  return (
    <div className="diff-view">
      <div className="diff-header">
        <div className="diff-title-row">
          <span className={`diff-status ${statusClass(diff.status)}`}>{statusLetter(diff.status)}</span>
          <span className="diff-path" title={diff.path}>
            {diff.path}
          </span>
          {diff.oldPath && diff.oldPath !== diff.path && <span className="diff-oldpath">from {diff.oldPath}</span>}
          {stats && <span className="diff-stats">{stats}</span>}
          {busy && <Spinner />}
          <span className="spacer" />
          <IconButton icon="copy" title="Copy path" small onClick={onCopyPath} />
        </div>
        <div className="diff-toolbar">
          <div className="segmented" role="group" aria-label="Diff layout">
            <button
              className={cx("segmented-btn", mode === "split" && "active")}
              onClick={() => setMode("split")}
              title="Side-by-side diff"
            >
              <Icon name="columns" />
            </button>
            <button
              className={cx("segmented-btn", mode === "unified" && "active")}
              onClick={() => setMode("unified")}
              title="Unified diff"
            >
              <Icon name="rows" />
            </button>
          </div>
          <button
            className={cx("toolbar-text-btn", ignoreWhitespace && "active")}
            onClick={onToggleWhitespace}
            title="Ignore whitespace"
          >
            <Icon name="eye" /> Whitespace
          </button>
          <span className="toolbar-sep" />
          <IconButton icon="prevDiff" title="Previous change" small onClick={() => goto(-1)} />
          <IconButton icon="nextDiff" title="Next change" small onClick={() => goto(1)} />
          <span className="diff-nav-count">
            {changeRows.length === 0 ? "No changes" : `${current + 1 || "–"} of ${changeRows.length}`}
          </span>
          <span className="spacer" />
          {canApply && (
            <>
              <button className="toolbar-text-btn" onClick={() => onApplyFile(fileAction)} title={fileAction === "stage" ? "Stage the whole file" : "Unstage the whole file"}>
                <Icon name={fileAction === "stage" ? "stage" : "unstage"} />
                {fileAction === "stage" ? "Stage file" : "Unstage file"}
              </button>
              {opts.target === "worktree" && (
                <button className="toolbar-text-btn" onClick={() => onApplyFile("rollback")} title="Roll back the file">
                  <Icon name="undo" />
                  Rollback
                </button>
              )}
            </>
          )}
          {onBlame && (
            <button className="toolbar-text-btn" onClick={onBlame} title="Annotate with Git blame">
              <Icon name="user" />
              Annotate
            </button>
          )}
        </div>
      </div>
      {diff.binary ? (
        <div className="diff-empty">
          <Icon name="file" size={24} />
          <div>Binary file — no textual diff to show</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="diff-empty">
          <Icon name="check" size={24} />
          <div>No differences</div>
        </div>
      ) : (
        <div className={cx("diff-body", mode)} ref={bodyRef}>
          <div className="diff-columns">
            <div className="diff-col-label left">{diff.oldLabel || "Before"}</div>
            <div className="diff-col-label right">{diff.newLabel || "After"}</div>
          </div>
          {mode === "split" ? (
            <SplitRows
              rows={rows}
              diff={diff}
              expanded={expanded}
              setExpanded={setExpanded}
              firstRowOfHunk={firstRowOfHunk}
              canApply={canApply}
              hunkAction={hunkAction}
              onApply={onApply}
              currentRow={current >= 0 ? (changeRows[current] ?? -1) : -1}
            />
          ) : (
            <UnifiedRows
              rows={rows}
              diff={diff}
              expanded={expanded}
              setExpanded={setExpanded}
              firstRowOfHunk={firstRowOfHunk}
              canApply={canApply}
              hunkAction={hunkAction}
              onApply={onApply}
              currentRow={current >= 0 ? (changeRows[current] ?? -1) : -1}
            />
          )}
          {diff.truncated && <div className="diff-truncated">This file is too large: only its beginning is shown.</div>}
        </div>
      )}
    </div>
  );
}

function statusLetter(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    default:
      return "M";
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "added":
      return "st-added";
    case "deleted":
      return "st-deleted";
    default:
      return "st-modified";
  }
}

function ApplyChevrons({
  hunk,
  action,
  canApply,
  onApply,
}: {
  hunk: number;
  action: "stage" | "unstage";
  canApply: boolean;
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
}) {
  if (!canApply) return <div className="diff-action" />;
  return (
    <div className="diff-action">
      <button
        className="diff-apply"
        title={action === "stage" ? "Stage this hunk" : "Unstage this hunk"}
        onClick={(e) => {
          e.stopPropagation();
          onApply(hunk, action);
        }}
      >
        <Icon name={action === "stage" ? "chevronRight" : "chevronLeft"} size={12} />
      </button>
      {action === "stage" && (
        <button
          className="diff-apply"
          title="Roll back this hunk"
          onClick={(e) => {
            e.stopPropagation();
            onApply(hunk, "rollback");
          }}
        >
          <Icon name="undo" size={12} />
        </button>
      )}
    </div>
  );
}

function Segments({ segs, text }: { segs?: WordSegment[]; text: string }) {
  if (!segs) return <>{text || "\u00a0"}</>;
  return (
    <>
      {segs.map((s, i) =>
        s.changed ? (
          <span className="word-changed" key={i}>
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

function SplitRows({
  rows,
  diff,
  expanded,
  setExpanded,
  firstRowOfHunk,
  canApply,
  hunkAction,
  onApply,
  currentRow,
}: {
  rows: DiffRows;
  diff: FileDiff;
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  firstRowOfHunk: Map<number, number>;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  currentRow: number;
}) {
  const out: React.ReactNode[] = [];
  rows.forEach((row, i) => {
    if (isCollapsed(row)) {
      const isExpanded = expanded.has(row.key);
      out.push(
        <div className="diff-row collapsed" key={i} data-row={i}>
          <button
            className="expand-btn"
            onClick={() => {
              const next = new Set(expanded);
              if (isExpanded) next.delete(row.key);
              else next.add(row.key);
              setExpanded(next);
            }}
          >
            <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={12} />
            {row.collapsed} unchanged lines
          </button>
        </div>,
      );
      return;
    }
    const aligned = row as AlignedRow;
    const isFirst = firstRowOfHunk.get(aligned.hunk) === i;
    out.push(
      <div
        className={cx("diff-row", aligned.kind, currentRow === i && "current")}
        key={i}
        data-row={i}
      >
        <div className={cx("line-no", aligned.left?.kind === "del" && "del")}>{aligned.left?.no ?? ""}</div>
        <div className={cx("line-text", aligned.left?.kind)}>
          {aligned.left ? <Segments segs={aligned.left.segments} text={aligned.left.text} /> : "\u00a0"}
        </div>
        {isFirst ? (
          <ApplyChevrons hunk={aligned.hunk} action={hunkAction} canApply={canApply} onApply={onApply} />
        ) : (
          <div className="diff-action" />
        )}
        <div className={cx("line-no", aligned.right?.kind === "add" && "add")}>{aligned.right?.no ?? ""}</div>
        <div className={cx("line-text", aligned.right?.kind)}>
          {aligned.right ? <Segments segs={aligned.right.segments} text={aligned.right.text} /> : "\u00a0"}
        </div>
      </div>,
    );
  });
  void diff;
  return <div className="diff-rows split">{out}</div>;
}

function UnifiedRows({
  rows,
  diff,
  expanded,
  setExpanded,
  firstRowOfHunk,
  canApply,
  hunkAction,
  onApply,
  currentRow,
}: {
  rows: DiffRows;
  diff: FileDiff;
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  firstRowOfHunk: Map<number, number>;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  currentRow: number;
}) {
  const out: React.ReactNode[] = [];
  rows.forEach((row, i) => {
    if (isCollapsed(row)) {
      out.push(
        <div className="diff-row collapsed" key={i} data-row={i}>
          <button
            className="expand-btn"
            onClick={() => {
              const next = new Set(expanded);
              if (expanded.has(row.key)) next.delete(row.key);
              else next.add(row.key);
              setExpanded(next);
            }}
          >
            <Icon name={expanded.has(row.key) ? "chevronDown" : "chevronRight"} size={12} />
            {row.collapsed} unchanged lines
          </button>
        </div>,
      );
      return;
    }
    const aligned = row as AlignedRow;
    const isFirst = firstRowOfHunk.get(aligned.hunk) === i;
    const emit = (side: "left" | "right") => {
      const line = side === "left" ? aligned.left : aligned.right;
      if (!line) return;
      out.push(
        <div
          className={cx("diff-row unified-row", line.kind, currentRow === i && "current")}
          key={`${i}-${side}`}
          data-row={`${i}-${side}`}
        >
          <div className={cx("line-no", line.kind === "del" && "del")}>{line.no || ""}</div>
          <div className="line-prefix">{line.kind === "del" ? "−" : line.kind === "add" ? "+" : " "}</div>
          <div className={cx("line-text", line.kind)}>
            <Segments segs={line.segments} text={line.text} />
          </div>
          {isFirst && side === (aligned.left ? "left" : "right") ? (
            <ApplyChevrons hunk={aligned.hunk} action={hunkAction} canApply={canApply} onApply={onApply} />
          ) : (
            <div className="diff-action" />
          )}
        </div>,
      );
    };
    if (aligned.left) emit("left");
    if (aligned.right) emit("right");
  });
  void diff;
  return <div className="diff-rows unified">{out}</div>;
}

export function BlameView({
  path,
  lines,
  onClose,
  onCopy,
}: {
  path: string;
  lines: { line: number; short: string; author: string; time: number; summary: string; text: string; uncommitted: boolean }[];
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="blame-view">
      <div className="diff-header">
        <div className="diff-title-row">
          <Icon name="user" />
          <span className="diff-path">Annotations · {path}</span>
          <span className="spacer" />
          <button className="toolbar-text-btn" onClick={onClose}>
            <Icon name="close" /> Close
          </button>
        </div>
      </div>
      <div className="blame-body">
        {lines.map((l) => (
          <div className="blame-row" key={l.line}>
            <button
              className={cx("blame-gutter", l.uncommitted && "uncommitted")}
              title={`${l.short} ${l.summary}\n${formatWhen(l.time)}`}
              onClick={() => onCopy(l.short)}
            >
              <span className="blame-hash">{l.uncommitted ? "local" : l.short}</span>
              <span className="blame-author">{l.author}</span>
              <span className="blame-time">{formatWhen(l.time)}</span>
            </button>
            <span className="blame-no">{l.line}</span>
            <span className="blame-text">{l.text || "\u00a0"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
