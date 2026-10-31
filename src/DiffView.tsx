import { useEffect, useMemo, useRef, useState } from "react";
import { annotateDate, blameDepth } from "./annotate";
import { blameMenuItems } from "./blameMenu";
import { Git, type BlameLine, type DiffOptions, type FileDiff } from "./mygo";
import { buildDiffRows, changeBlockRows, isCollapsed, type AlignedRow, type DiffRows, type WordSegment } from "./diff";
import { FileIcon, Icon } from "./icons";
import { useT } from "./i18n";
import { paintLine, tokenize, type LineTokens } from "./syntax";
import { ContextMenu, cx, formatWhen, IconButton, Spinner, useStoredState } from "./ui";
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
    uncommitted: "Uncommitted changes",
    lineHistory: "Show history of this line",
    copyHash: "Copy commit hash",
    annotateWithBlame: "Annotate with Git Blame",
    closeAnnotations: "Close Annotations",
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
    stageWholeFile: "Stage 整个文件",
    unstageWholeFile: "Unstage 整个文件",
    stageFile: "Stage 文件",
    unstageFile: "Unstage 文件",
    rollbackFile: "还原文件",
    rollback: "还原",
    uncommitted: "未提交的更改",
    lineHistory: "查看该行的历史",
    copyHash: "复制提交哈希",
    annotateWithBlame: "使用 Git Blame 标注",
    closeAnnotations: "关闭 Blame",
    binaryDiff: "二进制文件 — 无文本差异可显示",
    noDifferences: "无差异",
    before: "更改前",
    after: "更改后",
    workingTree: "工作区",
    index: "暂存区",
    truncated: "此文件过大：仅显示开头部分。",
    stageHunk: "Stage 此代码块",
    unstageHunk: "Unstage 此代码块",
    rollbackHunk: "还原此代码块",
    unchangedLines: "{n} 行未更改",
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
  onOpenFile,
  onShowFileHistory,
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
  onOpenFile: () => void;
  /** Line history of one side of the diff, at that side's revision. */
  onShowFileHistory?: (path: string, line: number, revision: string) => void;
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
  // One annotation preference for every viewer: the source pane and the diff
  // gutter answer the same way.
  const [annotate, setAnnotate] = useStoredState<boolean>("gitjet.annotate", false);
  const [menu, setMenu] = useState<{ x: number; y: number; side: Side; line: number } | null>(null);
  const revisions = useMemo(() => blameRevisions(opts), [opts.target, opts.revision, opts.from]);
  const beforePath = opts.oldPath || opts.path;
  const before = useBlame(beforePath, revisions.before, !diff.binary && (annotate || menu?.side === "before"));
  const after = useBlame(diff.path, revisions.after, !diff.binary && (annotate || menu?.side === "after"));
  const beforeIndex = useMemo(() => indexBlame(before), [before]);
  const afterIndex = useMemo(() => indexBlame(after), [after]);

  const openGutter = (side: Side, line: number, x: number, y: number) => setMenu({ x, y, side, line });
  const menuLine = menu?.side === "before" ? beforeIndex.get(menu.line) : menu ? afterIndex.get(menu.line) : undefined;
  const menuItems = menu
    ? blameMenuItems({
        blame: menuLine,
        line: menu.line,
        labels: {
          uncommitted: t("uncommitted"),
          lineHistory: t("lineHistory"),
          copyHash: t("copyHash"),
          annotate: t("annotateWithBlame"),
          closeAnnotations: t("closeAnnotations"),
        },
        annotate,
        onToggleAnnotate: () => setAnnotate(!annotate),
        onLineHistory:
          onShowFileHistory && (menu.side === "before" ? revisions.before : revisions.after) !== "INDEX"
            ? (line) =>
                onShowFileHistory(
                  menu.side === "before" ? beforePath : diff.path,
                  line,
                  menu.side === "before" ? revisions.before : revisions.after,
                )
            : undefined,
        onCopy: onCopyPath,
      })
    : [];

  useEffect(() => {
    setExpanded(new Set());
    setCurrent(-1);
  }, [reloadKey, diff.path]);

  const changeRows = useMemo(() => changeBlockRows(rows), [rows]);
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
          <FileIcon path={diff.path} size={15} />
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
              annotate={annotate}
              left={beforeIndex}
              right={afterIndex}
              onGutter={openGutter}
              local={t("local")}
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
              annotate={annotate}
              left={beforeIndex}
              right={afterIndex}
              onGutter={openGutter}
              local={t("local")}
            />
          )}
          {diff.truncated && <div className="diff-truncated">{t("truncated")}</div>}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
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

/** Which revision each column of the diff belongs to, for blame. The left
 *  side of a commit is its parent; the right side of the working tree is the
 *  file on disk. */
function blameRevisions(opts: DiffOptions): { before: string; after: string } {
  switch (opts.target) {
    case "commit":
      return { before: opts.revision ? `${opts.revision}^` : "", after: opts.revision };
    case "range":
      return { before: opts.from, after: opts.revision };
    case "staged":
      return { before: "HEAD", after: "INDEX" };
    default:
      return { before: opts.revision || "HEAD", after: "" };
  }
}

function indexBlame(lines: BlameLine[] | null): Map<number, BlameLine> {
  const index = new Map<number, BlameLine>();
  for (const line of lines ?? []) index.set(line.line, line);
  return index;
}

/** Blame loads when a gutter asks for it or the column is on, and stays for
 *  the life of this diff so a second click is instant. */
function useBlame(path: string, revision: string, enabled: boolean): BlameLine[] | null {
  const [lines, setLines] = useState<BlameLine[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLines(null);
    Git.blame(path, revision)
      .then((result) => {
        if (alive) setLines(result.lines);
      })
      .catch(() => {
        if (alive) setLines(null);
      });
    return () => {
      alive = false;
    };
  }, [path, revision, enabled]);
  return lines;
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

/** The two versions a diff compares; the gutter menu names them the same
 *  way the columns do. */
type Side = "before" | "after";

interface GutterProps {
  /** Draw the blame column beside each side's line numbers. */
  annotate: boolean;
  left: Map<number, BlameLine>;
  right: Map<number, BlameLine>;
  onGutter: (side: Side, line: number, x: number, y: number) => void;
  local: string;
}

/** The blame of one line, drawn where the source editor draws it: beside the
 *  line number, tinted by the commit's age. */
function AnnotateCell({
  entry,
  side,
  line,
  onGutter,
  local,
}: {
  entry?: BlameLine;
  side: Side;
  line?: number;
  onGutter: GutterProps["onGutter"];
  local: string;
}) {
  const depth = entry ? (entry.uncommitted ? -1 : blameDepth(entry.time)) : -1;
  return (
    <div
      className={cx("diff-annotate", entry && depth >= 0 && `depth-${depth}`, entry?.uncommitted && "uncommitted")}
      title={entry ? `${entry.short} ${entry.summary}\n${formatWhen(entry.time)}` : undefined}
      onClick={line === undefined ? undefined : (e) => onGutter(side, line, e.clientX, e.clientY)}
      onContextMenu={
        line === undefined
          ? undefined
          : (e) => {
              e.preventDefault();
              onGutter(side, line, e.clientX, e.clientY);
            }
      }
    >
      {entry && (
        <>
          <span className="diff-annotate-date">{entry.uncommitted ? "" : annotateDate(entry.time)}</span>
          <span className="diff-annotate-author">{entry.uncommitted ? local : entry.author}</span>
        </>
      )}
    </div>
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
  annotate,
  left,
  right,
  onGutter,
  local,
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
} & GutterProps) {
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
    const oldLine = aligned.left;
    const newLine = aligned.right;
    out.push(
      <div
        className={cx("diff-row", aligned.kind, currentRow === i && "current")}
        key={i}
        data-row={i}
      >
        {annotate && (
          <AnnotateCell
            entry={oldLine ? left.get(oldLine.no) : undefined}
            side="before"
            line={oldLine?.no}
            onGutter={onGutter}
            local={local}
          />
        )}
        <div
          className={cx("line-no", oldLine?.kind === "del" && "del")}
          onClick={oldLine ? (e) => onGutter("before", oldLine.no, e.clientX, e.clientY) : undefined}
          onContextMenu={
            oldLine
              ? (e) => {
                  e.preventDefault();
                  onGutter("before", oldLine.no, e.clientX, e.clientY);
                }
              : undefined
          }
        >
          {oldLine?.no ?? ""}
        </div>
        <div className={cx("line-text", oldLine?.kind)}>
          {oldLine ? (
            <LineText text={oldLine.text} no={oldLine.no} segs={oldLine.segments} tokens={tokens.left} />
          ) : (
            "\u00a0"
          )}
        </div>
        {isFirst ? (
          <ApplyChevrons hunk={aligned.hunk} action={hunkAction} canApply={canApply} onApply={onApply} />
        ) : (
          <div className="diff-action" />
        )}
        {annotate && (
          <AnnotateCell
            entry={newLine ? right.get(newLine.no) : undefined}
            side="after"
            line={newLine?.no}
            onGutter={onGutter}
            local={local}
          />
        )}
        <div
          className={cx("line-no", newLine?.kind === "add" && "add")}
          onClick={newLine ? (e) => onGutter("after", newLine.no, e.clientX, e.clientY) : undefined}
          onContextMenu={
            newLine
              ? (e) => {
                  e.preventDefault();
                  onGutter("after", newLine.no, e.clientX, e.clientY);
                }
              : undefined
          }
        >
          {newLine?.no ?? ""}
        </div>
        <div className={cx("line-text", newLine?.kind)}>
          {newLine ? (
            <LineText text={newLine.text} no={newLine.no} segs={newLine.segments} tokens={tokens.right} />
          ) : (
            "\u00a0"
          )}
        </div>
      </div>,
    );
  });
  void diff;
  return <div className={cx("diff-rows split", annotate && "annotate")}>{out}</div>;
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
  annotate,
  left,
  right,
  onGutter,
  local,
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
} & GutterProps) {
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
    // An unchanged line exists on both sides; a unified view shows it once,
    // with the after side's blame, and only changed rows are drawn twice.
    const firstSide: Side = aligned.kind !== "context" && aligned.left ? "before" : "after";
    const emit = (side: Side) => {
      const line = side === "before" ? aligned.left : aligned.right;
      if (!line) return;
      out.push(
        <div
          className={cx("diff-row unified-row", line.kind, currentRow === i && "current")}
          key={`${i}-${side}`}
          data-row={`${i}-${side}`}
        >
          {annotate && (
            <AnnotateCell
              entry={(side === "before" ? left : right).get(line.no)}
              side={side}
              line={line.no}
              onGutter={onGutter}
              local={local}
            />
          )}
          <div
            className={cx("line-no", line.kind === "del" && "del", line.kind === "add" && "add")}
            onClick={(e) => onGutter(side, line.no, e.clientX, e.clientY)}
            onContextMenu={(e) => {
              e.preventDefault();
              onGutter(side, line.no, e.clientX, e.clientY);
            }}
          >
            {line.no || ""}
          </div>
          <div className="line-prefix">{line.kind === "del" ? "−" : line.kind === "add" ? "+" : " "}</div>
          <div className={cx("line-text", line.kind)}>
            <LineText
              text={line.text}
              no={line.no}
              segs={line.segments}
              tokens={side === "before" ? tokens.left : tokens.right}
            />
          </div>
          {isFirst && side === firstSide ? (
            <ApplyChevrons hunk={aligned.hunk} action={hunkAction} canApply={canApply} onApply={onApply} />
          ) : (
            <div className="diff-action" />
          )}
        </div>,
      );
    };
    if (aligned.kind === "context") {
      emit("after");
      return;
    }
    if (aligned.left) emit("before");
    if (aligned.right) emit("after");
  });
  void diff;
  return <div className={cx("diff-rows unified", annotate && "annotate")}>{out}</div>;
}
