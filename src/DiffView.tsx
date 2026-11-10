import { useEffect, useMemo, useRef, useState } from "react";
import { annotateDate, blameDepth } from "./annotate";
import { blameMenuItems } from "./blameMenu";
import { Git, type BlameLine, type DiffOptions, type FileDiff, type ThreeWayDiff } from "./mygo";
import { buildDiffRows, changeBlockRows, changeBlockSelections, isCollapsed, type AlignedRow, type DiffRows, type WordSegment } from "./diff";
import { ImageDiff } from "./ImageDiff";
import { isImagePath } from "./images";
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
    externalDiff: "Open this comparison in the configured difftool",
    externalDiffShort: "Difftool",
    ignoreWhitespaceBlame: "Ignore whitespace changes",
    keepWhitespaceBlame: "Attribute whitespace changes",
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
    linesSelected: "{n} lines selected",
    stageLines: "Stage lines",
    unstageLines: "Unstage lines",
    rollbackLines: "Roll back lines",
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
    externalDiff: "用配置的差异工具打开此比较",
    externalDiffShort: "差异工具",
    ignoreWhitespaceBlame: "忽略空白改动",
    keepWhitespaceBlame: "归属空白改动",
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
    linesSelected: "已选 {n} 行",
    stageLines: "暂存选中行",
    unstageLines: "取消暂存选中行",
    rollbackLines: "还原选中行",
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
  onApplyLines,
  onOpenFile,
  onExternalDiff,
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
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
  onOpenFile: () => void;
  onExternalDiff?: () => void;
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
  const [ignoreWs, setIgnoreWs] = useStoredState<boolean>("gitjet.blameIgnoreWhitespace", false);
  const [menu, setMenu] = useState<{ x: number; y: number; side: Side; line: number } | null>(null);
  const revisions = useMemo(() => diffRevisions(opts), [opts.target, opts.revision, opts.from]);
  const beforePath = opts.oldPath || opts.path;
  const before = useBlame(beforePath, revisions.before, !diff.binary && (annotate || menu?.side === "before"), ignoreWs);
  const after = useBlame(diff.path, revisions.after, !diff.binary && (annotate || menu?.side === "after"), ignoreWs);
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
          ignoreWhitespace: t("ignoreWhitespaceBlame"),
          keepWhitespace: t("keepWhitespaceBlame"),
        },
        annotate,
        onToggleAnnotate: () => setAnnotate(!annotate),
        ignoreWhitespace: ignoreWs,
        onToggleIgnoreWhitespace: () => setIgnoreWs(!ignoreWs),
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
  // A whole-file diff is one hunk, so its chevrons have to follow the
  // change blocks instead: one button per run of changed rows, applying
  // exactly those lines.
  const wholeFileBlocks = useMemo(
    () => (diff.wholeFile ? changeBlockSelections(rows) : null),
    [rows, diff.wholeFile],
  );

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
  // F7/Shift+F7 walk the changes, as they do in the IDE's diff viewer. The
  // listener is registered once and reads the latest `goto` through a ref.
  const gotoRef = useRef(goto);
  useEffect(() => {
    gotoRef.current = goto;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F7" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      gotoRef.current(event.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const canApply = opts.target === "worktree" || opts.target === "staged";
  const fileAction = opts.target === "staged" ? "unstage" : "stage";
  const hunkAction = opts.target === "staged" ? "unstage" : "stage";
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState(-1);
  useEffect(() => {
    setSelected(new Set());
    setAnchor(-1);
  }, [reloadKey, diff.path]);
  // A click on a changed line's number selects it; Shift extends from the
  // last click, the way a range selection reads. The old side is stored
  // negative: old and new numbers overlap, and an added line 5 must not
  // drag the deleted line 5 with it. Unchanged lines keep the blame menu,
  // and so does every right-click.
  const selectLine = (no: number, side: "old" | "new", rowIndex: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const shift = e.shiftKey && anchor >= 0;
    const key = side === "new" ? no : -no;
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift) {
        const [from, to] = anchor < rowIndex ? [anchor, rowIndex] : [rowIndex, anchor];
        for (let i = from; i <= to; i++) {
          const row = rows[i];
          if (!row || isCollapsed(row)) continue;
          if (row.left && row.left.kind !== "context") next.add(-row.left.no);
          if (row.right && row.right.kind !== "context") next.add(row.right.no);
        }
      } else if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setAnchor(rowIndex);
  };
  const selectedCount = selected.size;
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
          {onExternalDiff && (
            <button className="toolbar-text-btn" onClick={onExternalDiff} title={t("externalDiff")}>
              <Icon name="external" /> {t("externalDiffShort")}
            </button>
          )}
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
          {canApply && selectedCount > 0 && (
            <>
              <span className="diff-nav-count">{t("linesSelected", { n: selectedCount })}</span>
              <button
                className="toolbar-text-btn"
                onClick={() => {
                  onApplyLines([...selected], hunkAction);
                  setSelected(new Set());
                }}
                title={hunkAction === "stage" ? t("stageLines") : t("unstageLines")}
              >
                <Icon name={hunkAction === "stage" ? "stage" : "unstage"} />
                {hunkAction === "stage" ? t("stageLines") : t("unstageLines")}
              </button>
              {opts.target === "worktree" && (
                <button
                  className="toolbar-text-btn"
                  onClick={() => {
                    onApplyLines([...selected], "rollback");
                    setSelected(new Set());
                  }}
                  title={t("rollbackLines")}
                >
                  <Icon name="undo" />
                  {t("rollbackLines")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {diff.binary ? (
        isImagePath(diff.path) ? (
          <ImageDiff
            path={diff.path}
            oldPath={diff.oldPath}
            before={revisions.before}
            after={revisions.after}
          />
        ) : (
          <div className="diff-empty">
            <Icon name="file" size={24} />
            <div>{t("binaryDiff")}</div>
          </div>
        )
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
              wholeFileBlocks={wholeFileBlocks}
              canApply={canApply}
              hunkAction={hunkAction}
              onApply={onApply}
              onApplyLines={onApplyLines}
              selected={selected}
              onSelect={selectLine}
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
              wholeFileBlocks={wholeFileBlocks}
              canApply={canApply}
              hunkAction={hunkAction}
              onApply={onApply}
              onApplyLines={onApplyLines}
              selected={selected}
              onSelect={selectLine}
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
/** The two versions a diff compares, as blobs or revisions. */
export function diffRevisions(opts: DiffOptions): { before: string; after: string } {
  switch (opts.target) {
    case "commit":
      return { before: opts.revision ? `${opts.revision}^` : "", after: opts.revision };
    case "range":
      return { before: opts.from, after: opts.revision };
    case "staged":
      return { before: "HEAD", after: "INDEX" };
    case "head":
      return { before: opts.revision || "HEAD", after: "" };
    default:
      // The working tree diff is the index against the file on disk.
      return { before: "INDEX", after: "" };
  }
}

function indexBlame(lines: BlameLine[] | null): Map<number, BlameLine> {
  const index = new Map<number, BlameLine>();
  for (const line of lines ?? []) index.set(line.line, line);
  return index;
}

/** Blame loads when a gutter asks for it or the column is on, and stays for
 *  the life of this diff so a second click is instant. */
function useBlame(path: string, revision: string, enabled: boolean, ignoreWhitespace: boolean): BlameLine[] | null {
  const [lines, setLines] = useState<BlameLine[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLines(null);
    Git.blame(path, revision, { ignoreWhitespace, ignoreRevsFile: "" })
      .then((result) => {
        if (alive) setLines(result.lines);
      })
      .catch(() => {
        if (alive) setLines(null);
      });
    return () => {
      alive = false;
    };
  }, [path, revision, enabled, ignoreWhitespace]);
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
  lines,
  action,
  canApply,
  onApply,
  onApplyLines,
}: {
  hunk: number;
  lines?: number[];
  action: "stage" | "unstage";
  canApply: boolean;
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
}) {
  const t = useT(T);
  if (!canApply) return <div className="diff-action" />;
  const apply = (next: "stage" | "unstage" | "rollback") => {
    if (lines) onApplyLines(lines, next);
    else onApply(hunk, next);
  };
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
            apply("rollback");
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
  selected: Set<number>;
  onSelect: (line: number, side: "old" | "new", row: number, e: React.MouseEvent) => void;
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
  wholeFileBlocks,
  canApply,
  hunkAction,
  onApply,
  onApplyLines,
  currentRow,
  annotate,
  left,
  right,
  onGutter,
  local,
  selected,
  onSelect,
}: {
  rows: DiffRows;
  diff: FileDiff;
  tokens: { left: LineTokens | null; right: LineTokens | null };
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  firstRowOfHunk: Map<number, number>;
  wholeFileBlocks: Map<number, number[]> | null;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
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
    const block = wholeFileBlocks ? wholeFileBlocks.get(i) : undefined;
    const oldLine = aligned.left;
    const newLine = aligned.right;
    out.push(
      <div
        className={cx(
          "diff-row",
          aligned.kind,
          currentRow === i && "current",
          ((oldLine && selected.has(-oldLine.no)) || (newLine && selected.has(newLine.no))) && "selected",
        )}
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
          onClick={
            oldLine
              ? canApply && oldLine.kind !== "context"
                ? (e) => onSelect(oldLine.no, "old", i, e)
                : (e) => onGutter("before", oldLine.no, e.clientX, e.clientY)
              : undefined
          }
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
        {(wholeFileBlocks ? block !== undefined : isFirst) ? (
          <ApplyChevrons
            hunk={aligned.hunk}
            lines={block}
            action={hunkAction}
            canApply={canApply}
            onApply={onApply}
            onApplyLines={onApplyLines}
          />
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
          onClick={
            newLine
              ? canApply && newLine.kind !== "context"
                ? (e) => onSelect(newLine.no, "new", i, e)
                : (e) => onGutter("after", newLine.no, e.clientX, e.clientY)
              : undefined
          }
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
  wholeFileBlocks,
  canApply,
  hunkAction,
  onApply,
  onApplyLines,
  currentRow,
  annotate,
  left,
  right,
  onGutter,
  local,
  selected,
  onSelect,
}: {
  rows: DiffRows;
  diff: FileDiff;
  tokens: { left: LineTokens | null; right: LineTokens | null };
  expanded: Set<number>;
  setExpanded: (s: Set<number>) => void;
  firstRowOfHunk: Map<number, number>;
  wholeFileBlocks: Map<number, number[]> | null;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
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
    const block = wholeFileBlocks ? wholeFileBlocks.get(i) : undefined;
    // An unchanged line exists on both sides; a unified view shows it once,
    // with the after side's blame, and only changed rows are drawn twice.
    const firstSide: Side = aligned.kind !== "context" && aligned.left ? "before" : "after";
    const emit = (side: Side) => {
      const line = side === "before" ? aligned.left : aligned.right;
      if (!line) return;
      out.push(
        <div
          className={cx(
            "diff-row unified-row",
            line.kind,
            currentRow === i && "current",
            selected.has(line.kind === "del" ? -line.no : line.no) && "selected",
          )}
          key={`${i}-${side}`}
          data-row={side === firstSide ? i : undefined}
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
            onClick={
              canApply && line.kind !== "context"
                ? (e) => onSelect(line.no, line.kind === "del" ? "old" : "new", i, e)
                : (e) => onGutter(side, line.no, e.clientX, e.clientY)
            }
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
          {(wholeFileBlocks ? block !== undefined && side === firstSide : isFirst && side === firstSide) ? (
            <ApplyChevrons
              hunk={aligned.hunk}
              lines={block}
              action={hunkAction}
              canApply={canApply}
              onApply={onApply}
              onApplyLines={onApplyLines}
            />
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

const THREE_T = {
  en: {
    head: "HEAD",
    index: "Index",
    worktree: "Working Tree",
    stageAll: "Stage All",
    unstageAll: "Unstage All",
    rollbackAll: "Discard Working Tree",
    stageHunk: "Stage this hunk",
    unstageHunk: "Unstage this hunk",
    binary: "Binary file: the three sides cannot be shown as text.",
    noChanges: "No changes",
  },
  zh: {
    head: "HEAD",
    index: "暂存区",
    worktree: "工作区",
    stageAll: "全部 Stage",
    unstageAll: "全部 Unstage",
    rollbackAll: "丢弃工作区更改",
    stageHunk: "Stage 此代码块",
    unstageHunk: "Unstage 此代码块",
    binary: "二进制文件：无法以文本显示三侧内容。",
    noChanges: "无更改",
  },
} as const;

/** ThreeWayView shows a file at HEAD, in the index and in the working
 *  tree at once, the way IDEA's staging area does, and lets each hunk of
 *  either transition be applied. */
export function ThreeWayView({
  three,
  onApplyHunk,
  onApplyFile,
  busy,
}: {
  three: ThreeWayDiff;
  onApplyHunk: (side: "staged" | "unstaged", hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyFile: (side: "staged" | "unstaged", action: "stage" | "unstage" | "rollback") => void;
  busy?: boolean;
}) {
  const t = useT(THREE_T);
  const lines = (text: string) => {
    if (text === "") return [] as string[];
    const parts = text.split("\n");
    if (parts[parts.length - 1] === "") parts.pop();
    return parts;
  };
  const headLines = useMemo(() => lines(three.head), [three.head]);
  const indexLines = useMemo(() => lines(three.index), [three.index]);
  const worktreeLines = useMemo(() => lines(three.worktree), [three.worktree]);
  const stagedOld = useMemo(() => changedLines(three.staged, "old"), [three.staged]);
  const stagedNew = useMemo(() => changedLines(three.staged, "new"), [three.staged]);
  const unstagedOld = useMemo(() => changedLines(three.unstaged, "old"), [three.unstaged]);
  const unstagedNew = useMemo(() => changedLines(three.unstaged, "new"), [three.unstaged]);

  const pane = (title: string, text: string[], changed: Set<number>, tone: string) => (
    <div className="three-pane">
      <div className="three-pane-title">{title}</div>
      <div className="three-pane-body">
        {text.length === 0 ? (
          <div className="three-pane-empty">{t("noChanges")}</div>
        ) : (
          text.map((line, i) => (
            <div key={i} className={cx("three-line", changed.has(i + 1) && tone)}>
              <span className="three-no">{i + 1}</span>
              <span className="three-text">{line === "" ? "\u00a0" : line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="three-way">
      <div className="diff-toolbar three-toolbar">
        <span className="three-path" title={three.path}>
          <FileIcon path={three.path} size={14} /> {three.path}
        </span>
        <span className="spacer" />
        <button className="toolbar-text-btn" disabled={busy} onClick={() => onApplyFile("unstaged", "stage")}>
          <Icon name="stage" /> {t("stageAll")}
        </button>
        <button className="toolbar-text-btn" disabled={busy} onClick={() => onApplyFile("staged", "unstage")}>
          <Icon name="unstage" /> {t("unstageAll")}
        </button>
        <button className="toolbar-text-btn" disabled={busy} onClick={() => onApplyFile("unstaged", "rollback")}>
          <Icon name="undo" /> {t("rollbackAll")}
        </button>
      </div>
      <div className="three-hunks">
        {three.unstaged.hunks.map((h, i) => (
          <button
            key={"u" + i}
            className="three-hunk-chip"
            disabled={busy}
            title={t("stageHunk")}
            onClick={() => onApplyHunk("unstaged", i, "stage")}
          >
            <Icon name="chevronRight" size={11} /> {h.header}
          </button>
        ))}
        {three.staged.hunks.map((h, i) => (
          <button
            key={"s" + i}
            className="three-hunk-chip staged"
            disabled={busy}
            title={t("unstageHunk")}
            onClick={() => onApplyHunk("staged", i, "unstage")}
          >
            <Icon name="chevronLeft" size={11} /> {h.header}
          </button>
        ))}
      </div>
      {three.binary ? (
        <p className="setting-hint">{t("binary")}</p>
      ) : (
        <div className="three-panes">
          {pane(t("head"), headLines, stagedOld, "changed-staged")}
          {pane(t("index"), indexLines, union(stagedNew, unstagedOld), "changed-index")}
          {pane(t("worktree"), worktreeLines, unstagedNew, "changed-worktree")}
        </div>
      )}
    </div>
  );
}

/** changedLines collects the line numbers a diff marks as added or
 *  deleted on one side. */
function changedLines(diff: FileDiff, side: "old" | "new"): Set<number> {
  const out = new Set<number>();
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "context") continue;
      const no = side === "old" ? line.oldNo : line.newNo;
      if (no > 0) out.add(no);
    }
  }
  return out;
}

function union(a: Set<number>, b: Set<number>): Set<number> {
  const out = new Set(a);
  for (const n of b) out.add(n);
  return out;
}
