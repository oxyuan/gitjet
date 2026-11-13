import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { annotateDate, blameDepth } from "./annotate";
import { blameMenuItems } from "./blameMenu";
import { Git, type BlameLine, type DiffOptions, type FileDiff, type ThreeWayDiff } from "./mygo";
import { buildDiffRows, changeBlockRows, changeBlockSelections, foldRanges, lineWidth, revealWhitespace, visibleRows, type FoldRange, type HighlightMode, type VisibleRow, type WhitespaceMode, type WordSegment } from "./diff";
import { ImageDiff } from "./ImageDiff";
import { isImagePath } from "./images";
import { FileIcon, Icon } from "./icons";
import { useT } from "./i18n";
import { paintLine, tokenize, type LineTokens } from "./syntax";
import { markSearch, searchRows, type SearchHit, type SearchSpan } from "./search";
import { ContextMenu, cx, formatWhen, IconButton, Spinner, useStoredState, type ContextItem } from "./ui";
import { PathCopyButton } from "./PathCopy";
import { ribbonPath, ribbonTone, type RibbonSpan, type RibbonTone } from "./ribbons";

type Mode = "split" | "unified";

/** The search spans one row needs, per pane, plus the active hit's span. */
interface RowSearchMarks {
  left: SearchSpan[];
  right: SearchSpan[];
  leftActive?: SearchSpan;
  rightActive?: SearchSpan;
}
type SearchMarkMap = Map<number, RowSearchMarks>;

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
    whitespace: "Whitespace",
    previousChange: "Previous change (Shift+F7)",
    nextChange: "Next change (F7)",
    goToChange: "Go to change",
    findInDiff: "Find in the diff (⌘/Ctrl+F)",
    findPlaceholder: "Find in the diff",
    matchCase: "Match case",
    closeFind: "Close find",
    noResults: "No results",
    openAtLine: "Open in the editor at this line (⌘/Ctrl+click)",
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
    foldUnchanged: "Collapse unchanged fragments",
    unfoldUnchanged: "Expand all unchanged fragments",
    ignoreDifferences: "Ignore Differences",
    highlightDifferences: "Highlighting Differences",
    hlLines: "Lines",
    hlWords: "Words",
    hlChars: "Characters",
    hlNone: "None",
    showWhitespace: "Show whitespace",
    hideWhitespace: "Hide whitespace",
    wsNone: "None",
    wsTrim: "Trim whitespaces",
    wsAll: "Ignore whitespaces",
    wsBlank: "Ignore whitespaces and empty lines",
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
    whitespace: "忽略空白",
    previousChange: "上一处更改（Shift+F7）",
    nextChange: "下一处更改（F7）",
    goToChange: "跳转到更改",
    findInDiff: "在差异中查找（⌘/Ctrl+F）",
    findPlaceholder: "在差异中查找",
    matchCase: "区分大小写",
    closeFind: "关闭查找",
    noResults: "无结果",
    openAtLine: "在编辑器中打开此行（⌘/Ctrl+点击）",
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
    foldUnchanged: "折叠未更改片段",
    unfoldUnchanged: "展开全部未更改片段",
    ignoreDifferences: "忽略差异",
    highlightDifferences: "高亮差异",
    hlLines: "整行",
    hlWords: "单词",
    hlChars: "字符",
    hlNone: "无",
    showWhitespace: "显示空白",
    hideWhitespace: "隐藏空白",
    wsNone: "不忽略",
    wsTrim: "忽略空白数量",
    wsAll: "忽略空白字符",
    wsBlank: "忽略空白和空行",
    local: "本地",
  },
} as const;

export function DiffView({
  diff,
  opts,
  mode,
  setMode,
  whitespace,
  onWhitespace,
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
  onNextFile,
}: {
  diff: FileDiff;
  opts: DiffOptions;
  mode: Mode;
  setMode: (m: Mode) => void;
  whitespace: WhitespaceMode;
  onWhitespace: (mode: WhitespaceMode) => void;
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyFile: (action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
  onOpenFile: (side: "before" | "after", line?: number, path?: string) => void;
  onExternalDiff?: () => void;
  /** Line history of one side of the diff, at that side's revision. */
  onShowFileHistory?: (path: string, line: number, revision: string) => void;
  root: string;
  onCopyPath: (text: string) => void;
  busy?: boolean;
  reloadKey: number;
  wrap: boolean;
  onToggleWrap: () => void;
  /** IDEA's "go to the next file after reaching last change": F7 past the
   *  last block opens the next changed file instead of wrapping. */
  onNextFile?: (delta: 1 | -1) => void;
}) {
  const t = useT(T);
  // git names these sides; translate the two the app itself introduces.
  const sideLabel = (raw: string) =>
    raw === "Working Tree" ? t("workingTree") : raw === "Index" ? t("index") : raw;
  // IDEA's diff toolbar keeps these two as view settings: what the inner
  // marks compare (the line bands stay either way) and whether whitespace is
  // drawn. Both live under `gitjet.*`, like every other view preference.
  const [storedHighlight, setHighlight] = useStoredState<HighlightMode>("gitjet.diffHighlight", "words");
  const [showWhitespace, setShowWhitespace] = useStoredState<boolean>("gitjet.diffShowWhitespace", false);
  // A value from an older or broken store must not leave the viewer without
  // marks: only the four policies exist, anything else reads as words.
  const highlight: HighlightMode =
    storedHighlight === "lines" || storedHighlight === "chars" || storedHighlight === "none"
      ? storedHighlight
      : "words";
  const rows = useMemo(() => buildDiffRows(diff, highlight), [diff, highlight]);
  const tokens = useDiffTokens(diff);
  // Folding is a view decision, so the rows above never lose a line: a fold
  // hides a range of them and reopening it needs no new model.
  const [folded, setFolded] = useStoredState<boolean>("gitjet.diffFoldUnchanged", true);
  const folds = useMemo(() => (folded ? foldRanges(rows) : []), [rows, folded]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const visible = useMemo(() => visibleRows(rows, folds, open), [rows, folds, open]);
  const [current, setCurrent] = useState(-1);
  // Find is IDEA's editor search inside the diff: one match list over both
  // versions, navigated with Enter/F3. A context row counts once even though
  // the split viewer draws it twice. `pendingRow` is the row a hit asked to
  // see, so a match inside a closed fold opens that fold before scrolling.
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const hits = useMemo(() => searchRows(rows, query, matchCase), [rows, query, matchCase]);
  const [hitIndex, setHitIndex] = useState(-1);
  const [pendingRow, setPendingRow] = useState<number | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const activeHit: SearchHit | undefined = hitIndex >= 0 ? hits[hitIndex] : undefined;
  // Marks are grouped by row and side so a pane can ask for its own spans
  // without walking the whole match list on every rendered line.
  const searchMarks = useMemo<SearchMarkMap>(() => {
    const map: SearchMarkMap = new Map();
    if (!findOpen) return map;
    for (const hit of hits) {
      const entry = map.get(hit.row) ?? { left: [], right: [] };
      if (hit.both) {
        entry.left.push(hit);
        entry.right.push(hit);
      } else if (hit.side === "left") {
        entry.left.push(hit);
      } else {
        entry.right.push(hit);
      }
      map.set(hit.row, entry);
    }
    if (activeHit) {
      const entry = map.get(activeHit.row);
      if (entry) {
        if (activeHit.both || activeHit.side === "left") entry.leftActive = activeHit;
        if (activeHit.both || activeHit.side === "right") entry.rightActive = activeHit;
      }
    }
    return map;
  }, [hits, activeHit, findOpen]);
  const [wsMenu, setWsMenu] = useState<{ x: number; y: number } | null>(null);
  const [hlMenu, setHlMenu] = useState<{ x: number; y: number } | null>(null);
  const [changeMenu, setChangeMenu] = useState<{ x: number; y: number } | null>(null);
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

  const openGutter = (side: Side, line: number, x: number, y: number) => {
    setWsMenu(null);
    setMenu({ x, y, side, line });
  };
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
    // A refetch can change which rows exist, so a fold opened against the old
    // numbering is not carried into the new one. The current change is kept:
    // staging one hunk should not move the reader to another.
    setOpen(new Set());
  }, [reloadKey, diff.path, diff]);

  const changeRows = useMemo(() => changeBlockRows(rows), [rows]);
  // The IDE opens a diff at the first change rather than at line 1. Jump once
  // per mounted viewer: a refresh after staging must not steal the scroll.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || changeRows.length === 0) return;
    jumped.current = true;
    setCurrent(0);
    const frame = requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector<HTMLElement>(`[data-row="${changeRows[0]}"]`)
        ?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [changeRows]);
  // A refetch can remove the change the reader was on; the counter follows
  // the blocks that still exist instead of pointing past the last one.
  useEffect(() => {
    setCurrent((value) => (value >= changeRows.length ? changeRows.length - 1 : value));
  }, [changeRows.length]);
  // A hunk's chevron belongs to its first *visible* row: folding can hide the
  // hunk's opening context, and an apply button nobody can see is no button.
  const firstRowOfHunk = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of visible) {
      if (item.kind !== "row" || map.has(item.row.hunk)) continue;
      map.set(item.row.hunk, item.index);
    }
    return map;
  }, [visible]);
  // A whole-file diff is one hunk, so its chevrons have to follow the
  // change blocks instead: one button per run of changed rows, applying
  // exactly those lines.
  const wholeFileBlocks = useMemo(
    () => (diff.wholeFile ? changeBlockSelections(rows) : null),
    [rows, diff.wholeFile],
  );

  const revealChange = (idx: number) => {
    if (idx < 0 || idx >= changeRows.length) return;
    setCurrent(idx);
    const rowIndex = changeRows[idx]!;
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`);
    el?.scrollIntoView({ block: "center" });
  };
  const goto = (delta: number) => {
    if (changeRows.length === 0) {
      onNextFile?.(delta > 0 ? 1 : -1);
      return;
    }
    let idx = current;
    if (idx === -1) idx = delta > 0 ? 0 : changeRows.length - 1;
    else {
      const next = idx + delta;
      if (next < 0 || next >= changeRows.length) {
        // IDEA leaves the file rather than wrapping when there is another
        // changed file to look at.
        if (onNextFile) {
          onNextFile(delta > 0 ? 1 : -1);
          return;
        }
        idx = (next + changeRows.length) % changeRows.length;
      } else {
        idx = next;
      }
    }
    revealChange(idx);
  };
  // A click inside a change makes that block current, the way the IDE's
  // counter follows the caret instead of waiting for F7.
  const blockOfRow = useMemo(() => {
    const map = new Map<number, number>();
    changeRows.forEach((row, index) => map.set(row, index));
    return map;
  }, [changeRows]);
  const focusRow = (row: number) => {
    const block = blockOfRow.get(row);
    if (block !== undefined) setCurrent(block);
  };
  // The changes list IDEA opens from its "N of M" counter: every block with
  // the header git printed for it, so a reader can jump anywhere.
  const changeItems: ContextItem[] = changeRows.map((rowIndex, index) => {
    const hunk = diff.hunks[rows[rowIndex]?.hunk ?? -1];
    return {
      label: hunk ? `${index + 1}  ${hunk.header}` : `${index + 1}`,
      checked: index === current,
      onClick: () => {
        setChangeMenu(null);
        revealChange(index);
      },
    };
  });
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

  // Find, as IDEA's diff editors have it: Ctrl/Cmd+F opens the bar, Enter or
  // F3 steps forward, Shift reverses, Escape closes. A hit hidden inside a
  // closed fold opens that fold first, so every jump lands on visible text.
  const openFind = () => {
    if (diff.binary) return;
    setFindOpen(true);
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  };
  const closeFind = () => {
    setFindOpen(false);
    setQuery("");
    setHitIndex(-1);
    setPendingRow(null);
  };
  const stepHit = (delta: number) => {
    if (hits.length === 0) return;
    const next =
      hitIndex < 0
        ? delta > 0
          ? 0
          : hits.length - 1
        : (hitIndex + delta + hits.length) % hits.length;
    setHitIndex(next);
    setPendingRow(hits[next]!.row);
  };
  useEffect(() => {
    if (pendingRow === null) return;
    const fold = folds.find((range) => pendingRow >= range.start && pendingRow < range.end);
    if (fold && !open.has(fold.start)) {
      setOpen((prev) => new Set(prev).add(fold.start));
      return;
    }
    const frame = requestAnimationFrame(() => {
      bodyRef.current?.querySelector<HTMLElement>(`[data-row="${pendingRow}"]`)?.scrollIntoView({ block: "center" });
      setPendingRow(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingRow, folds, open, visible]);
  useEffect(() => {
    if (!findOpen) return;
    if (hits.length === 0) {
      setHitIndex(-1);
      return;
    }
    setHitIndex(0);
    setPendingRow(hits[0]!.row);
  }, [hits, findOpen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || !!target.isContentEditable);
      // A text field owns its keys; Ctrl+F belongs to whichever editor the
      // reader is actually typing in.
      if (typing) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind();
      } else if (event.key === "F3" && findOpen) {
        event.preventDefault();
        stepHit(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape" && findOpen) {
        event.preventDefault();
        closeFind();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen, hits, hitIndex]);

  const canApply = opts.target === "worktree" || opts.target === "staged";
  const fileAction = opts.target === "staged" ? "unstage" : "stage";
  const hunkAction = opts.target === "staged" ? "unstage" : "stage";
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState(-1);
  useEffect(() => {
    setSelected(new Set());
    setAnchor(-1);
  }, [reloadKey, diff.path, diff]);
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
          if (!row) continue;
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
  // Columns are sized from the longest line, so a line wider than its half
  // scrolls instead of being clipped; below that the two halves stay even.
  const widths = useMemo(() => {
    let left = 0;
    let right = 0;
    for (const row of rows) {
      if (row.left) left = Math.max(left, lineWidth(row.left.text));
      if (row.right) right = Math.max(right, lineWidth(row.right.text));
    }
    return { left, right };
  }, [rows]);
  const layout = {
    "--diff-left-w": `max(calc(50% - 65px), calc(${widths.left + 2}ch + 10px))`,
    "--diff-right-w": `max(calc(50% - 65px), calc(${widths.right + 2}ch + 10px))`,
    "--diff-uni-w": `max(calc(100% - 100px), calc(${Math.max(widths.left, widths.right) + 2}ch + 10px))`,
  } as React.CSSProperties;
  const whitespaceItems: ContextItem[] = [
    { header: true, label: t("ignoreDifferences") },
    ...(
      [
        ["none", t("wsNone")],
        ["trim", t("wsTrim")],
        ["whitespace", t("wsAll")],
        ["whitespace-blank", t("wsBlank")],
      ] as const
    ).map(([mode, label]) => ({
      label,
      checked: whitespace === mode,
      onClick: () => {
        setWsMenu(null);
        onWhitespace(mode);
      },
    })),
  ];
  const highlightItems: ContextItem[] = [
    { header: true, label: t("highlightDifferences") },
    ...(
      [
        ["lines", t("hlLines")],
        ["words", t("hlWords")],
        ["chars", t("hlChars")],
        ["none", t("hlNone")],
      ] as const
    ).map(([mode, label]) => ({
      label,
      checked: highlight === mode,
      onClick: () => {
        setHlMenu(null);
        setHighlight(mode);
      },
    })),
  ];
  const highlightLabel =
    highlight === "lines"
      ? t("hlLines")
      : highlight === "chars"
        ? t("hlChars")
        : highlight === "none"
          ? t("hlNone")
          : t("hlWords");
  const stats = `${diff.additions > 0 ? "+" + diff.additions : ""}${diff.additions > 0 && diff.deletions > 0 ? " " : ""}${diff.deletions > 0 ? "−" + diff.deletions : ""}`;
  // IDEA's "Open in editor" follows the caret; without one, the change the
  // reader is on is the position that means something.
  const currentRow = current >= 0 ? rows[changeRows[current]!] : undefined;
  const currentLine = currentRow?.right?.no ?? currentRow?.left?.no;
  const openAt = (side: Side, line: number) =>
    onOpenFile(side, line, side === "before" ? beforePath : diff.path);

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
          <button
            className="toolbar-text-btn"
            onClick={() =>
              onOpenFile(
                diff.status === "deleted" ? "before" : "after",
                currentLine,
                diff.status === "deleted" ? beforePath : diff.path,
              )
            }
            title={t("openSourceFile")}
          >
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
          <IconButton
            icon="pilcrow"
            title={showWhitespace ? t("hideWhitespace") : t("showWhitespace")}
            small
            active={showWhitespace}
            onClick={() => setShowWhitespace(!showWhitespace)}
          />
          <button
            className={cx("toolbar-text-btn", whitespace !== "none" && "active")}
            onClick={(e) => {
              setMenu(null);
              setHlMenu(null);
              setWsMenu({ x: e.clientX, y: e.clientY });
            }}
            title={t("ignoreDifferences")}
          >
            <Icon name="eye" /> {t("whitespace")}
          </button>
          <button
            className={cx("toolbar-text-btn", highlight !== "words" && "active")}
            onClick={(e) => {
              setMenu(null);
              setWsMenu(null);
              setHlMenu({ x: e.clientX, y: e.clientY });
            }}
            title={t("highlightDifferences")}
          >
            <Icon name="diff" /> {highlightLabel}
          </button>
          <IconButton
            icon={folded ? "collapse" : "expand"}
            title={folded ? t("unfoldUnchanged") : t("foldUnchanged")}
            small
            active={folded}
            onClick={() => {
              setFolded(!folded);
              setOpen(new Set());
            }}
          />
          {!diff.binary && (
            <IconButton
              icon="search"
              title={t("findInDiff")}
              small
              active={findOpen}
              onClick={() => (findOpen ? closeFind() : openFind())}
            />
          )}
          <span className="toolbar-sep" />
          <IconButton icon="prevDiff" title={t("previousChange")} small onClick={() => goto(-1)} />
          <IconButton icon="nextDiff" title={t("nextChange")} small onClick={() => goto(1)} />
          <button
            className="diff-nav-count"
            disabled={changeRows.length === 0}
            title={t("goToChange")}
            onClick={(e) => {
              setMenu(null);
              setWsMenu(null);
              setHlMenu(null);
              setChangeMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            {changeRows.length === 0
              ? t("noChanges")
              : t("position", { current: current + 1 || "–", total: changeRows.length })}
          </button>
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
        {findOpen && !diff.binary && (
          <div className="diff-find">
            <Icon name="search" size={12} />
            <input
              ref={findInput}
              className="diff-find-input"
              value={query}
              placeholder={t("findPlaceholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  stepHit(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeFind();
                }
              }}
            />
            <button
              className={cx("toolbar-text-btn diff-find-case", matchCase && "active")}
              onClick={() => setMatchCase(!matchCase)}
              title={t("matchCase")}
            >
              Aa
            </button>
            <span className="diff-find-count">
              {query === ""
                ? ""
                : hits.length === 0
                  ? t("noResults")
                  : t("position", { current: hitIndex + 1, total: hits.length })}
            </span>
            <IconButton
              icon="chevronUp"
              title={t("previousChange")}
              small
              disabled={hits.length === 0}
              onClick={() => stepHit(-1)}
            />
            <IconButton
              icon="chevronDown"
              title={t("nextChange")}
              small
              disabled={hits.length === 0}
              onClick={() => stepHit(1)}
            />
            <IconButton icon="close" title={t("closeFind")} small onClick={closeFind} />
          </div>
        )}
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
        <div
          className={cx("diff-body", mode, wrap && "wrap", highlight === "none" && "hl-none")}
          style={layout}
          ref={bodyRef}
        >
          {mode === "split" && (
            <div className="diff-columns">
              <div className="diff-col-label left">{sideLabel(diff.oldLabel) || t("before")}</div>
              <div className="diff-col-label right">{sideLabel(diff.newLabel) || t("after")}</div>
            </div>
          )}
          {mode === "split" ? (
            <SplitRows
              visible={visible}
              onToggleFold={(start) => setOpen((prev) => new Set(prev).add(start))}
              tokens={tokens}
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
              showWhitespace={showWhitespace}
              highlight={highlight}
              onOpenAt={openAt}
              searchMarks={searchMarks}
              onFocusRow={focusRow}
            />
          ) : (
            <UnifiedRows
              visible={visible}
              onToggleFold={(start) => setOpen((prev) => new Set(prev).add(start))}
              tokens={tokens}
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
              showWhitespace={showWhitespace}
              onOpenAt={openAt}
              searchMarks={searchMarks}
              onFocusRow={focusRow}
            />
          )}
          {diff.truncated && <div className="diff-truncated">{t("truncated")}</div>}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {changeMenu && (
        <ContextMenu
          x={changeMenu.x}
          y={changeMenu.y}
          items={[{ header: true, label: t("goToChange") }, ...changeItems]}
          onClose={() => setChangeMenu(null)}
        />
      )}
      {wsMenu && (
        <ContextMenu x={wsMenu.x} y={wsMenu.y} items={whitespaceItems} onClose={() => setWsMenu(null)} />
      )}
      {hlMenu && (
        <ContextMenu x={hlMenu.x} y={hlMenu.y} items={highlightItems} onClose={() => setHlMenu(null)} />
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
  showWhitespace,
  searchSpans,
  activeSpan,
}: {
  text: string;
  /** Line number in the side's own text, which is how tokens are keyed. */
  no?: number;
  segs?: WordSegment[];
  tokens?: LineTokens | null;
  showWhitespace?: boolean;
  /** Occurrences of the find query on this side, with the active one. */
  searchSpans?: readonly SearchSpan[];
  activeSpan?: SearchSpan;
}) {
  const spans = no === undefined ? undefined : tokens?.get(no);
  const pieces = useMemo(() => paintLine(text, spans, segs), [text, spans, segs]);
  const marked = useMemo(
    () => (searchSpans && searchSpans.length > 0 ? markSearch(pieces, searchSpans, activeSpan) : pieces),
    [pieces, searchSpans, activeSpan],
  );
  const shown = useMemo(() => (showWhitespace ? revealWhitespace(marked) : marked), [marked, showWhitespace]);
  if (text === "") return <>{"\u00a0"}</>;
  return (
    <>
      {shown.map((piece, i) =>
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

/** The separator standing in for a run of unchanged rows. Clicking it
 *  reopens exactly that run; the toolbar toggle hides them all again. */
function FoldMarker({ fold, onToggle }: { fold: FoldRange; onToggle: () => void }) {
  const t = useT(T);
  return (
    <div className="diff-row collapsed">
      <button className="expand-btn" onClick={onToggle}>
        <Icon name="chevronDown" size={12} />
        {t("unchangedLines", { n: fold.count })}
      </button>
    </div>
  );
}

function SplitRows({
  visible,
  onToggleFold,
  tokens,
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
  showWhitespace,
  highlight,
  onOpenAt,
  searchMarks,
  onFocusRow,
}: {
  visible: VisibleRow[];
  onToggleFold: (start: number) => void;
  tokens: { left: LineTokens | null; right: LineTokens | null };
  firstRowOfHunk: Map<number, number>;
  wholeFileBlocks: Map<number, number[]> | null;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
  currentRow: number;
  showWhitespace: boolean;
  highlight: HighlightMode;
  onOpenAt: (side: Side, line: number) => void;
  searchMarks: SearchMarkMap;
  onFocusRow: (row: number) => void;
} & GutterProps) {
  const t = useT(T);
  // The divider between the panes carries one ribbon per change block, the
  // way the IDE connects the two sides. Its geometry is read from the laid
  // out rows, because wrapping and folded markers make heights uneven; the
  // SVG is positioned in the rows' own coordinates, so scrolling costs
  // nothing.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [ribbons, setRibbons] = useState<{ tone: RibbonTone; d: string }[]>([]);
  const [ribbonSize, setRibbonSize] = useState({ width: 0, height: 0 });
  const ribbonKey = useRef("");
  const measureRibbons = useCallback(() => {
    const root = rowsRef.current;
    if (!root) return;
    const clear = () => {
      if (ribbonKey.current === "") return;
      ribbonKey.current = "";
      setRibbons([]);
    };
    if (highlight === "none") {
      clear();
      return;
    }
    const nodes = new Map<number, HTMLElement>();
    for (const node of root.querySelectorAll<HTMLElement>("[data-row]")) {
      const index = Number(node.dataset.row);
      if (!Number.isNaN(index)) nodes.set(index, node);
    }
    const first = nodes.values().next().value as HTMLElement | undefined;
    const lane = first?.querySelector<HTMLElement>(":scope > .diff-action");
    if (!first || !lane) {
      clear();
      return;
    }
    const x1 = lane.offsetLeft;
    const x2 = x1 + lane.offsetWidth;
    const span = (index: number): RibbonSpan | undefined => {
      const node = nodes.get(index);
      return node ? { top: node.offsetTop, bottom: node.offsetTop + node.offsetHeight } : undefined;
    };
    const next: { tone: RibbonTone; d: string }[] = [];
    let piece: {
      first: number;
      leftFirst?: number;
      leftLast?: number;
      rightFirst?: number;
      rightLast?: number;
    } | null = null;
    // Rows of one block pair from the top, so a side that runs out first
    // leaves its remainingrows one-sided; the ribbon then tapers to the
    // line where the other side stops.
    const flush = () => {
      if (!piece) return;
      const left = piece.leftFirst === undefined ? undefined : span(piece.leftFirst);
      const leftEnd = piece.leftLast === undefined ? undefined : span(piece.leftLast);
      const right = piece.rightFirst === undefined ? undefined : span(piece.rightFirst);
      const rightEnd = piece.rightLast === undefined ? undefined : span(piece.rightLast);
      if ((left && leftEnd) || (right && rightEnd)) {
        const point = span(piece.first)?.top ?? 0;
        const leftSpan = left && leftEnd ? { top: left.top, bottom: leftEnd.bottom } : { top: point, bottom: point };
        const rightSpan =
          right && rightEnd ? { top: right.top, bottom: rightEnd.bottom } : { top: point, bottom: point };
        next.push({
          tone: ribbonTone(left !== undefined, right !== undefined),
          d: ribbonPath(x1, x2, leftSpan, rightSpan),
        });
      }
      piece = null;
    };
    for (const item of visible) {
      if (item.kind === "fold") {
        flush();
        continue;
      }
      if (item.row.kind === "context") {
        flush();
        continue;
      }
      if (!piece) piece = { first: item.index };
      if (item.row.left) {
        if (piece.leftFirst === undefined) piece.leftFirst = item.index;
        piece.leftLast = item.index;
      }
      if (item.row.right) {
        if (piece.rightFirst === undefined) piece.rightFirst = item.index;
        piece.rightLast = item.index;
      }
    }
    flush();
    const width = root.scrollWidth;
    const height = root.scrollHeight;
    const key = `${width}x${height}|${next.map((ribbon) => ribbon.tone + ribbon.d).join(";")}`;
    if (key === ribbonKey.current) return;
    ribbonKey.current = key;
    setRibbons(next);
    setRibbonSize({ width, height });
  }, [visible, highlight]);
  useLayoutEffect(() => {
    measureRibbons();
  }, [measureRibbons, annotate, wholeFileBlocks]);
  const measureRef = useRef(measureRibbons);
  measureRef.current = measureRibbons;
  useEffect(() => {
    const root = rowsRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measureRef.current());
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const out: React.ReactNode[] = [];
  visible.forEach((item) => {
    if (item.kind === "fold") {
      out.push(
        <FoldMarker
          key={`fold-${item.fold.start}`}
          fold={item.fold}
          onToggle={() => onToggleFold(item.fold.start)}
        />,
      );
      return;
    }
    const aligned = item.row;
    const i = item.index;
    const isFirst = firstRowOfHunk.get(aligned.hunk) === i;
    const block = wholeFileBlocks ? wholeFileBlocks.get(i) : undefined;
    const marks = searchMarks.get(i);
    const oldLine = aligned.left;
    const newLine = aligned.right;
    // Both sides of a modification share one tone, as the IDE bands them: a
    // changed pair is a modification, not an unrelated delete and insert.
    const leftTone = aligned.kind === "change" ? "mod" : oldLine?.kind;
    const rightTone = aligned.kind === "change" ? "mod" : newLine?.kind;
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
        onClick={() => onFocusRow(i)}
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
          className={cx("line-no", leftTone === "del" && "del", leftTone === "mod" && "mod")}
          title={oldLine ? t("openAtLine") : undefined}
          onClick={
            oldLine
              ? (e) => {
                  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                    e.preventDefault();
                    onOpenAt("before", oldLine.no);
                  } else if (canApply && oldLine.kind !== "context") {
                    onSelect(oldLine.no, "old", i, e);
                  } else {
                    onGutter("before", oldLine.no, e.clientX, e.clientY);
                  }
                }
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
        <div className={cx("line-text", leftTone)}>
          {oldLine ? (
            <LineText
              text={oldLine.text}
              no={oldLine.no}
              segs={oldLine.segments}
              tokens={tokens.left}
              showWhitespace={showWhitespace}
              searchSpans={marks?.left}
              activeSpan={marks?.leftActive}
            />
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
          className={cx("line-no", rightTone === "add" && "add", rightTone === "mod" && "mod")}
          title={newLine ? t("openAtLine") : undefined}
          onClick={
            newLine
              ? (e) => {
                  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                    e.preventDefault();
                    onOpenAt("after", newLine.no);
                  } else if (canApply && newLine.kind !== "context") {
                    onSelect(newLine.no, "new", i, e);
                  } else {
                    onGutter("after", newLine.no, e.clientX, e.clientY);
                  }
                }
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
        <div className={cx("line-text", rightTone)}>
          {newLine ? (
            <LineText
              text={newLine.text}
              no={newLine.no}
              segs={newLine.segments}
              tokens={tokens.right}
              showWhitespace={showWhitespace}
              searchSpans={marks?.right}
              activeSpan={marks?.rightActive}
            />
          ) : (
            "\u00a0"
          )}
        </div>
      </div>,
    );
  });
  return (
    <div className={cx("diff-rows split", annotate && "annotate")} ref={rowsRef}>
      {out}
      {ribbons.length > 0 && (
        <svg className="diff-ribbons" width={ribbonSize.width} height={ribbonSize.height} aria-hidden="true">
          {ribbons.map((ribbon, index) => (
            <path key={index} className={`diff-ribbon ${ribbon.tone}`} d={ribbon.d} />
          ))}
        </svg>
      )}
    </div>
  );
}

function UnifiedRows({
  visible,
  onToggleFold,
  tokens,
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
  showWhitespace,
  onOpenAt,
  searchMarks,
  onFocusRow,
}: {
  visible: VisibleRow[];
  onToggleFold: (start: number) => void;
  tokens: { left: LineTokens | null; right: LineTokens | null };
  firstRowOfHunk: Map<number, number>;
  wholeFileBlocks: Map<number, number[]> | null;
  canApply: boolean;
  hunkAction: "stage" | "unstage";
  onApply: (hunk: number, action: "stage" | "unstage" | "rollback") => void;
  onApplyLines: (lines: number[], action: "stage" | "unstage" | "rollback") => void;
  currentRow: number;
  showWhitespace: boolean;
  onOpenAt: (side: Side, line: number) => void;
  searchMarks: SearchMarkMap;
  onFocusRow: (row: number) => void;
} & GutterProps) {
  const t = useT(T);
  const out: React.ReactNode[] = [];
  visible.forEach((item) => {
    if (item.kind === "fold") {
      out.push(
        <FoldMarker
          key={`fold-${item.fold.start}`}
          fold={item.fold}
          onToggle={() => onToggleFold(item.fold.start)}
        />,
      );
      return;
    }
    const aligned = item.row;
    const i = item.index;
    const isFirst = firstRowOfHunk.get(aligned.hunk) === i;
    const block = wholeFileBlocks ? wholeFileBlocks.get(i) : undefined;
    const marks = searchMarks.get(i);
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
          onClick={() => onFocusRow(i)}
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
            title={t("openAtLine")}
            onClick={(e) => {
              if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                e.preventDefault();
                onOpenAt(side, line.no);
              } else if (canApply && line.kind !== "context") {
                onSelect(line.no, line.kind === "del" ? "old" : "new", i, e);
              } else {
                onGutter(side, line.no, e.clientX, e.clientY);
              }
            }}
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
              showWhitespace={showWhitespace}
              searchSpans={side === "before" ? marks?.left : marks?.right}
              activeSpan={side === "before" ? marks?.leftActive : marks?.rightActive}
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
