import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffOptions, FileDiff } from "./mygo";
import { buildDiffRows, isCollapsed, type AlignedRow, type DiffRows, type WordSegment } from "./diff";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { paintLine, tokenize, type LineTokens } from "./syntax";
import { cx, formatWhen, IconButton, Spinner } from "./ui";
import { PathCopyButton } from "./PathCopy";

type Mode = "split" | "unified";

const T = {
  en: {
    from: "from {path}",
    openSourceFile: "Open the source file",
    openFile: "Open File",
    copyPath: "Copy path",
    diffLayout: "Diff layout",
    sideBySide: "Side-by-side diff",
    unifiedDiff: "Unified diff",
    wrapLongLines: "Wrap long lines",
    wrap: "Wrap",
    ignoreWhitespace: "Ignore whitespace",
    whitespace: "Whitespace",
    previousChange: "Previous change",
    nextChange: "Next change",
    noChanges: "No changes",
    position: "{current} of {total}",
    stageWholeFile: "Stage the whole file",
    unstageWholeFile: "Unstage the whole file",
    stageFile: "Stage file",
    unstageFile: "Unstage file",
    rollbackFile: "Roll back the file",
    rollback: "Rollback",
    annotateBlame: "Annotate with Git blame",
    annotate: "Annotate",
    binaryDiff: "Binary file — no textual diff to show",
    noDifferences: "No differences",
    before: "Before",
    after: "After",
    workingTree: "Working Tree",
    index: "Index",
    truncated: "This file is too large: only its beginning is shown.",
    stageHunk: "Stage this hunk",
    unstageHunk: "Unstage this hunk",
    rollbackHunk: "Roll back this hunk",
    unchangedLines: "{n} unchanged lines",
    annotations: "Annotations · {path}",
    close: "Close",
    local: "local",
  },
  zh: {
    from: "来自 {path}",
    openSourceFile: "打开源文件",
    openFile: "打开文件",
    copyPath: "复制路径",
    diffLayout: "差异布局",
    sideBySide: "并排差异",
    unifiedDiff: "统一差异",
    wrapLongLines: "长行折行显示",
    wrap: "折行",
    ignoreWhitespace: "忽略空白字符",
    whitespace: "忽略空白",
    previousChange: "上一处更改",
    nextChange: "下一处更改",
    noChanges: "无更改",
    position: "{current} / {total}",
    stageWholeFile: "暂存整个文件",
    unstageWholeFile: "取消暂存整个文件",
    stageFile: "暂存文件",
    unstageFile: "取消暂存文件",
    rollbackFile: "还原文件",
    rollback: "还原",
    annotateBlame: "使用 Git blame 标注",
    annotate: "标注",
    binaryDiff: "二进制文件 — 无文本差异可显示",
    noDifferences: "无差异",
    before: "更改前",
    after: "更改后",
    workingTree: "工作区",
    index: "暂存区",
    truncated: "此文件过大：仅显示开头部分。",
    stageHunk: "暂存此代码块",
    unstageHunk: "取消暂存此代码块",
    rollbackHunk: "还原此代码块",
    unchangedLines: "{n} 行未更改",
    annotations: "标注 · {path}",
    close: "关闭",
    local: "本地",
  },
} as const;

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
  onOpenFile,
  root,
  onCopyPath,
  busy,
  reloadKey,
  wrap,
  onToggleWrap,
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
  onOpenFile: () => void;
  root: string;
  onCopyPath: (text: string) => void;
  busy?: boolean;
  reloadKey: number;
  wrap: boolean;
  onToggleWrap: () => void;
}) {
  const t = useT(T);
  // git names these sides; translate the two the app itself introduces.
  const sideLabel = (raw: string) =>
    raw === "Working Tree" ? t("workingTree") : raw === "Index" ? t("index") : raw;
  const rows = useMemo(() => buildDiffRows(diff), [diff]);
  const tokens = useDiffTokens(diff);
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
          {diff.oldPath && diff.oldPath !== diff.path && (
            <span className="diff-oldpath">{t("from", { path: diff.oldPath })}</span>
          )}
          {stats && <span className="diff-stats">{stats}</span>}
          {busy && <Spinner />}
          <span className="spacer" />
          <button className="toolbar-text-btn" onClick={onOpenFile} title={t("openSourceFile")}>
            <Icon name="file" /> {t("openFile")}
          </button>
          <PathCopyButton path={diff.path} root={root} onCopy={onCopyPath} />
        </div>
        <div className="diff-toolbar">
          <div className="segmented" role="group" aria-label={t("diffLayout")}>
            <button
              className={cx("segmented-btn", mode === "split" && "active")}
              onClick={() => setMode("split")}
              title={t("sideBySide")}
            >
              <Icon name="columns" />
            </button>
            <button
              className={cx("segmented-btn", mode === "unified" && "active")}
              onClick={() => setMode("unified")}
              title={t("unifiedDiff")}
            >
              <Icon name="rows" />
            </button>
          </div>
          <button
            className={cx("toolbar-text-btn", wrap && "active")}
            onClick={onToggleWrap}
            title={t("wrapLongLines")}
          >
            <Icon name="rows" /> {t("wrap")}
          </button>
          <button
            className={cx("toolbar-text-btn", ignoreWhitespace && "active")}
            onClick={onToggleWhitespace}
            title={t("ignoreWhitespace")}
          >
            <Icon name="eye" /> {t("whitespace")}
          </button>
          <span className="toolbar-sep" />
          <IconButton icon="prevDiff" title={t("previousChange")} small onClick={() => goto(-1)} />
          <IconButton icon="nextDiff" title={t("nextChange")} small onClick={() => goto(1)} />
          <span className="diff-nav-count">
            {changeRows.length === 0
              ? t("noChanges")
              : t("position", { current: current + 1 || "–", total: changeRows.length })}
          </span>
          <span className="spacer" />
          {canApply && (
            <>
              <button
                className="toolbar-text-btn"
                onClick={() => onApplyFile(fileAction)}
                title={fileAction === "stage" ? t("stageWholeFile") : t("unstageWholeFile")}
              >
                <Icon name={fileAction === "stage" ? "stage" : "unstage"} />
                {fileAction === "stage" ? t("stageFile") : t("unstageFile")}
              </button>
              {opts.target === "worktree" && (
                <button className="toolbar-text-btn" onClick={() => onApplyFile("rollback")} title={t("rollbackFile")}>
                  <Icon name="undo" />
                  {t("rollback")}
                </button>
              )}
            </>
          )}
          {onBlame && (
            <button className="toolbar-text-btn" onClick={onBlame} title={t("annotateBlame")}>
              <Icon name="user" />
              {t("annotate")}
            </button>
          )}
        </div>
      </div>
      {diff.binary ? (
        <div className="diff-empty">
          <Icon name="file" size={24} />
          <div>{t("binaryDiff")}</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="diff-empty">
          <Icon name="check" size={24} />
          <div>{t("noDifferences")}</div>
        </div>
      ) : (
        <div className={cx("diff-body", mode, wrap && "wrap")} ref={bodyRef}>
          <div className="diff-columns">
            <div className="diff-col-label left">{sideLabel(diff.oldLabel) || t("before")}</div>
            <div className="diff-col-label right">{sideLabel(diff.newLabel) || t("after")}</div>
          </div>
          {mode === "split" ? (
            <SplitRows
              rows={rows}
              diff={diff}
              tokens={tokens}
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
              tokens={tokens}
              expanded={expanded}
              setExpanded={setExpanded}
              firstRowOfHunk={firstRowOfHunk}
              canApply={canApply}
              hunkAction={hunkAction}
              onApply={onApply}
              currentRow={current >= 0 ? (changeRows[current] ?? -1) : -1}
            />
          )}
          {diff.truncated && <div className="diff-truncated">{t("truncated")}</div>}
        </div>
      )}
    </div>
  );
}

/** Syntax colours for both sides of the diff, or nulls while they load. The
 *  viewer paints plain text meanwhile: colours arriving a frame later is
 *  better than a blank pane. */
function useDiffTokens(diff: FileDiff): { left: LineTokens | null; right: LineTokens | null } {
  const [tokens, setTokens] = useState<{ left: LineTokens | null; right: LineTokens | null }>({
    left: null,
    right: null,
  });
  const language = diff.language;
  const left = diff.oldText;
  const right = diff.newText;
  useEffect(() => {
    setTokens({ left: null, right: null });
    if (diff.binary || language === "" || language === "plain") return;
    let alive = true;
    void Promise.all([tokenize(left, language), tokenize(right, language)]).then(([l, r]) => {
      if (alive) setTokens({ left: l, right: r });
    });
    return () => {
      alive = false;
    };
  }, [left, right, language, diff.binary]);
  return tokens;
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
  const t = useT(T);
  if (!canApply) return <div className="diff-action" />;
  return (
    <div className="diff-action">
      <button
        className="diff-apply"
        title={action === "stage" ? t("stageHunk") : t("unstageHunk")}
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
          title={t("rollbackHunk")}
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

/** One side of one row, painted with its syntax colours and, for a changed
 *  word, the change mark on top of them. */
function LineText({
  text,
  no,
  segs,
  tokens,
}: {
  text: string;
  /** Line number in the side's own text, which is how tokens are keyed. */
  no?: number;
  segs?: WordSegment[];
  tokens?: LineTokens | null;
}) {
  const spans = no === undefined ? undefined : tokens?.get(no);
  const pieces = useMemo(() => paintLine(text, spans, segs), [text, spans, segs]);
  if (text === "") return <>{"\u00a0"}</>;
  return (
    <>
      {pieces.map((piece, i) =>
        piece.cls === "" ? <span key={i}>{piece.text}</span> : <span className={piece.cls} key={i}>{piece.text}</span>,
      )}
    </>
  );
}

function SplitRows({
  rows,
  diff,
  tokens,
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
  tokens: { left: LineTokens | null; right: LineTokens | null };
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  firstRowOfHunk: Map<number, number>;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  currentRow: number;
}) {
  const t = useT(T);
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
            {t("unchangedLines", { n: row.collapsed })}
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
          {aligned.left ? (
            <LineText text={aligned.left.text} no={aligned.left.no} segs={aligned.left.segments} tokens={tokens.left} />
          ) : (
            "\u00a0"
          )}
        </div>
        {isFirst ? (
          <ApplyChevrons hunk={aligned.hunk} action={hunkAction} canApply={canApply} onApply={onApply} />
        ) : (
          <div className="diff-action" />
        )}
        <div className={cx("line-no", aligned.right?.kind === "add" && "add")}>{aligned.right?.no ?? ""}</div>
        <div className={cx("line-text", aligned.right?.kind)}>
          {aligned.right ? (
            <LineText text={aligned.right.text} no={aligned.right.no} segs={aligned.right.segments} tokens={tokens.right} />
          ) : (
            "\u00a0"
          )}
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
  tokens,
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
  tokens: { left: LineTokens | null; right: LineTokens | null };
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  firstRowOfHunk: Map<number, number>;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  currentRow: number;
}) {
  const t = useT(T);
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
            {t("unchangedLines", { n: row.collapsed })}
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
            <LineText text={line.text} no={line.no} segs={line.segments} tokens={side === "left" ? tokens.left : tokens.right} />
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
  const t = useT(T);
  return (
    <div className="blame-view">
      <div className="diff-header">
        <div className="diff-title-row">
          <Icon name="user" />
          <span className="diff-path">{t("annotations", { path })}</span>
          <span className="spacer" />
          <button className="toolbar-text-btn" onClick={onClose}>
            <Icon name="close" /> {t("close")}
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
              <span className="blame-hash">{l.uncommitted ? t("local") : l.short}</span>
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
