import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent, MergeDetails } from "./mygo";
import {
  buildMergeView,
  computeMerge,
  conflictLabels,
  diffHunks,
  needsSideChoice,
  splitLines,
  tryResolveRange,
  type MergeLabels,
  type MergeModel,
  type MergeRange,
  type MergeView,
  type WhitespaceMode,
} from "./merge";
import { charDiff, wordDiff } from "./diff";
import { detectLineEnding, normalizeText, withLineEnding } from "./editorText";
import { MergePane, type MergePaneBlock, type MergePaneTone } from "./mergePane";
import { Icon } from "./icons";
import {
  Button,
  ContextMenu,
  type ContextItem,
  IconButton,
  Modal,
  Spinner,
  cx,
} from "./ui";
import { count, useT } from "./i18n";

const T = {
  en: {
    close: "Close",
    typeInserted: "Added",
    typeDeleted: "Deleted",
    typeModified: "Changed",
    typeConflict: "Conflict",
    viewOptions: "View options",
    syncScroll: "Synchronize scrolling",
    collapseUnchanged: "Collapse unchanged lines",
    softWrap: "Soft wrap",
    showWhitespace: "Show whitespace",
    compare: "Compare…",
    compareLocalBase: "Local vs Base",
    compareRemoteBase: "Remote vs Base",
    compareLocalRemote: "Local vs Remote",
    compareResultBase: "Result vs Base",
    applyAnywayTitle: "Unresolved Conflicts",
    applyAnywayOne: "1 block is still undecided. Saving leaves the file exactly as the merge found it, with Git's markers, and the conflict stays open.",
    applyAnywayMessage: "{n} blocks are still undecided. Saving leaves the file exactly as the merge found it, with Git's markers, and the conflict stays open.",
    applyAnyway: "Save As Is",
    backToResolve: "Back to Resolving",
    local: "Local Changes",
    remote: "Remote Changes",
    base: "Base",
    result: "Result",
    previous: "Previous change (Shift+F7)",
    next: "Next change (F7)",
    cancel: "Cancel",
    acceptLeft: "Accept Left",
    acceptRight: "Accept Right",
    applyLocalTitle: "Accept this left change",
    applyRemoteTitle: "Accept this right change",
    apply: "Apply",
    applyHint: "Save the result and stage the file",
    binaryConflict: "Binary conflict — choose a side",
    linkConflict: "Symbolic link conflict — choose a side",
    submoduleConflict: "Submodule conflict — choose a side",
    deleteConflict: "One side deleted this file — choose a side",
    bothDeletedConflict: "Both sides deleted this file — resolve it by confirming",
    oursDeleted: "The local side deleted this file; the other side still has it.",
    theirsDeleted: "The other side deleted this file; the local side still has it.",
    bothDeleted: "Neither side kept this file.",
    noEditableText: "This path is not merged as text, so only a side can be chosen.",
    noChanges: "Contents are identical",
    noChangesMade: "No changes",
    changesOne: "{n} change",
    changesOther: "{n} changes",
    conflictOne: "{n} conflict",
    conflictOther: "{n} conflicts",
    allResolved: "All conflicts resolved",
    unresolved: "{n} unresolved",
    applyLocal: "Apply this local change",
    applyRemote: "Apply this remote change",
    conflictBlock: "Unresolved conflict",
    resolvedBlock: "Resolved conflict",
    fromChanges: "Changes from {name}",
    showDetails: "Show details",
    resolveSimple: "Resolve simple conflicts",
    applyNonConflicts: "Apply non-conflicting changes",
    left: "Left",
    all: "All",
    right: "Right",
    autoMerge: "Three-way merge",
    autoMergeHint: "Merge the three stages with git's algorithm, in memory: the result is staged when nothing conflicts",
    compareContents: "Compare contents",
    accept: "Accept",
    resolveUsingLocal: "Resolve Using Left",
    resolveUsingRemote: "Resolve Using Right",
    ignore: "Ignore",
    compareClipboard: "Compare with Clipboard",
    annotateBlame: "Annotate with Git Blame",
    saveAndClose: "Save and Close",
    applyChanges: "Apply Changes",
    ignoreDiff: "Ignore differences",
    ignoreNone: "None",
    ignoreTrim: "Trim whitespace",
    ignoreSpaces: "Ignore spaces",
    highlightDiff: "Highlight differences",
    highlightNone: "None",
    highlightLines: "Lines",
    highlightWords: "Words",
    highlightChars: "Characters",
    resolveAutomatically: "Resolve Automatically",
    revertChange: "Revert Change",
    discardTitle: "Unsaved Resolution",
    discardMessage: "This file's resolution has not been saved. Closing now discards it.",
    keepEditing: "Keep Editing",
    discardClose: "Discard and Close",
    restartTitle: "Compare Differently",
    restartMessage: "Comparing with different whitespace rules rebuilds the merge, so the decisions and edits made so far are discarded.",
    restartMerge: "Discard and Rebuild",
    appearance: "Appearance",
    commit: "Commit",
    author: "Author",
    date: "Date",
    branch: "Branch",
    detailsUnavailable: "No revision information",
    undo: "Undo",
    redo: "Redo",
  },
  zh: {
    close: "关闭",
    typeInserted: "新增",
    typeDeleted: "删除",
    typeModified: "修改",
    typeConflict: "冲突",
    viewOptions: "视图选项",
    syncScroll: "同步滚动",
    collapseUnchanged: "折叠未修改行",
    softWrap: "自动换行",
    showWhitespace: "显示空白",
    compare: "对比…",
    compareLocalBase: "本地 vs Base",
    compareRemoteBase: "远程 vs Base",
    compareLocalRemote: "本地 vs 远程",
    compareResultBase: "结果 vs Base",
    applyAnywayTitle: "仍有未解决的冲突",
    applyAnywayOne: "还有 1 处未决定。保存时文件保持合并前的原样（仍带 Git 冲突标记），冲突继续保留。",
    applyAnywayMessage: "还有 {n} 处未决定。保存时文件保持合并前的原样（仍带 Git 冲突标记），冲突继续保留。",
    applyAnyway: "按原样保存",
    backToResolve: "返回解析",
    local: "本地更改",
    remote: "远程更改",
    base: "Base",
    result: "结果",
    previous: "上一处变更（Shift+F7）",
    next: "下一处变更（F7）",
    cancel: "取消",
    acceptLeft: "接受左侧",
    acceptRight: "接受右侧",
    applyLocalTitle: "接受这处左侧更改",
    applyRemoteTitle: "接受这处右侧更改",
    apply: "应用",
    applyHint: "保存结果并将文件加入暂存区",
    binaryConflict: "二进制冲突 — 请选择一侧",
    linkConflict: "符号链接冲突 — 请选择一侧",
    submoduleConflict: "子模块冲突 — 请选择一侧",
    deleteConflict: "有一侧删除了该文件 — 请选择一侧",
    bothDeletedConflict: "两侧都删除了该文件 — 确认后完成解决",
    oursDeleted: "本地一侧删除了该文件，另一侧仍保留。",
    theirsDeleted: "另一侧删除了该文件，本地一侧仍保留。",
    bothDeleted: "两侧都没有保留该文件。",
    noEditableText: "该路径不按文本合并，只能选择一侧。",
    noChanges: "内容一致",
    noChangesMade: "没有更改",
    changesOne: "{n} 个变更",
    changesOther: "{n} 个变更",
    conflictOne: "{n} 个冲突",
    conflictOther: "{n} 个冲突",
    allResolved: "所有冲突已解决",
    unresolved: "{n} 个未解决",
    applyLocal: "应用这处本地更改",
    applyRemote: "应用这处远程更改",
    conflictBlock: "未解决的冲突",
    resolvedBlock: "已解决的冲突",
    fromChanges: "来自 {name} 的更改",
    showDetails: "显示详细信息",
    resolveSimple: "解决简单冲突",
    applyNonConflicts: "应用不冲突的更改",
    left: "左侧",
    all: "所有",
    right: "右侧",
    autoMerge: "三方合并",
    autoMergeHint: "按 git 的算法在内存中合并三个阶段：没有冲突时直接暂存，有冲突时写入标记继续处理",
    compareContents: "比较内容",
    accept: "接受",
    resolveUsingLocal: "使用左侧解决",
    resolveUsingRemote: "使用右侧解决",
    ignore: "忽略",
    compareClipboard: "与剪贴板比较",
    annotateBlame: "使用 Git 追溯注解",
    saveAndClose: "保存并关闭",
    applyChanges: "应用更改",
    ignoreDiff: "忽略差异",
    ignoreNone: "无",
    ignoreTrim: "修整空白",
    ignoreSpaces: "忽略空格",
    highlightDiff: "高亮显示差异",
    highlightNone: "无",
    highlightLines: "行数",
    highlightWords: "单词",
    highlightChars: "字符",
    resolveAutomatically: "自动解决",
    revertChange: "还原更改",
    discardTitle: "未保存的解决结果",
    discardMessage: "该文件的解决结果尚未保存，关闭将丢弃这些更改。",
    keepEditing: "继续编辑",
    discardClose: "丢弃并关闭",
    restartTitle: "更换比较方式",
    restartMessage: "按不同的空白规则比较会重建合并结果，此前做出的决定和编辑都会被丢弃。",
    restartMerge: "丢弃并重建",
    appearance: "外观",
    commit: "提交",
    author: "作者",
    date: "日期",
    branch: "分支",
    detailsUnavailable: "没有修订信息",
    undo: "撤销",
    redo: "重做",
  },
} as const;

function lineOffsets(lines: string[]): number[] {
  const offsets = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1]! + line.length + 1);
  return offsets;
}

function offsetAt(offsets: number[], line: number): number {
  return offsets[Math.max(0, Math.min(line, offsets.length - 1))]!;
}

function conflictMarks(
  range: MergeRange,
  side: "ours" | "theirs",
  offsets: number[],
  chars: boolean,
): { from: number; to: number }[] {
  if (range.kind !== "conflict") return [];
  const marks: { from: number; to: number }[] = [];
  const start = side === "ours" ? range.oursStart : range.theirsStart;
  for (let i = 0; i < Math.min(range.ours.length, range.theirs.length); i++) {
    const left = range.ours[i]!;
    const right = range.theirs[i]!;
    if (left === right) continue;
    const [oursSegs, theirsSegs] = chars ? charDiff(left, right) : wordDiff(left, right);
    let pos = offsets[start + i]!;
    for (const segment of side === "ours" ? oursSegs : theirsSegs) {
      if (segment.changed && segment.text) marks.push({ from: pos, to: pos + segment.text.length });
      pos += segment.text.length;
    }
  }
  return marks;
}

function rangeType(range: MergeRange, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (range.kind === "conflict") return t("typeConflict");
  if (range.kind === "inserted") return t("typeInserted");
  if (range.kind === "deleted") return t("typeDeleted");
  return t("typeModified");
}

function blockLines(doc: string, block: MergePaneBlock): string[] {
  const from = Math.max(0, Math.min(block.from, doc.length));
  const to = Math.max(from, Math.min(block.to, doc.length));
  return splitLines(doc.slice(from, to)).lines;
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function sideBlocks(
  model: MergeModel,
  side: "ours" | "theirs",
  labels: { apply: string; t: (key: string) => string; chars: boolean; marks: boolean },
): MergePaneBlock[] {
  const lines = side === "ours" ? model.oursLines : model.theirsLines;
  const offsets = lineOffsets(lines);
  const blocks: MergePaneBlock[] = [];
  for (const range of model.ranges) {
    // Every change a side made is actionable, not only the conflicts: IDEA
    // lets the reader accept or ignore a one-sided change too, which is how an
    // auto-merged change is taken back.
    if (side === "ours" ? !range.oursChanged : !range.theirsChanged) continue;
    const start = side === "ours" ? range.oursStart : range.theirsStart;
    const end = side === "ours" ? range.oursEnd : range.theirsEnd;
    const conflict = range.kind === "conflict";
    blocks.push({
      id: range.index,
      from: offsetAt(offsets, start),
      to: offsetAt(offsets, end),
      tone: conflict ? "conflict" : side,
      apply: side,
      ignore: true,
      marks: conflict && labels.marks ? conflictMarks(range, side, offsets, labels.chars) : [],
      title: `${labels.apply} · ${rangeType(range, labels.t)}`,
    });
  }
  return blocks;
}

/** One block per model range: undecided until both sides are settled, and
 *  tinted by what the range is while it waits. */
function resultBlocks(
  model: MergeModel,
  states: ReadonlyMap<number, RangeState>,
  view: MergeView,
  t: (key: string, vars?: Record<string, string | number>) => string,
): MergePaneBlock[] {
  return view.blocks.map((block) => {
    const range = model.ranges[block.index];
    const state = states.get(block.index);
    const resolved = state ? state.left && state.right : block.resolved;
    const conflict = range?.kind === "conflict";
    return {
      id: block.index,
      from: block.from,
      to: block.to,
      tone: resolved ? "resolved" : conflict ? "conflict" : range?.oursChanged ? "ours" : "theirs",
      revert: revertable(range, state),
      title: resolved
        ? range
          ? rangeType(range, t)
          : t("resolvedBlock")
        : conflict
          ? t("conflictBlock")
          : range
            ? rangeType(range, t)
            : t("conflictBlock"),
    } satisfies MergePaneBlock;
  });
}

/** A range's decision, kept the way the IDE keeps it: each side is applied or
 *  ignored on its own, and a conflict is decided only when both are. Applying
 *  one side of a conflict leaves the other pending, so accepting both appends
 *  the second one. */
interface RangeState {
  lines: string[];
  left: boolean;
  right: boolean;
  /** The left side of a conflict is in the text and the right still is not. */
  oneside: boolean;
}

function decided(state: RangeState | undefined): boolean {
  return state !== undefined && state.left && state.right;
}

/** One block's state before and after a decision. The decision journal is the
 *  undo history for blocks: a decision that changes no text still has an entry,
 *  so Ctrl+Z can take it back and reopen the conflict. */
interface BlockChange {
  index: number;
  before: RangeState;
  after: RangeState;
}

interface Decision {
  changes: BlockChange[];
}

/** "Resolve using left/right" replaces the whole file, so its undo restores
 *  the text and block spans it replaced instead of per-block lines. */
interface WholeDecision {
  whole: {
    beforeText: string;
    beforeBlocks: MergePaneBlock[];
    beforeStates: Map<number, RangeState>;
    afterText: string;
    afterStates: Map<number, RangeState>;
  };
}

type JournalEntry = Decision | WholeDecision;

function countUnresolved(states: ReadonlyMap<number, RangeState>): number {
  let count = 0;
  for (const state of states.values()) if (!decided(state)) count++;
  return count;
}

/** "Revert change" puts a decided range back to the merge base, undecided. */
function revertable(range: MergeRange | undefined, state: RangeState | undefined): boolean {
  return range !== undefined && decided(state);
}

function CompareVersions({
  left,
  right,
  leftLabel,
  rightLabel,
  onClose,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
  onClose: () => void;
}) {
  const t = useT(T);
  const leftLines = splitLines(left).lines;
  const rightLines = splitLines(right).lines;
  const hunks = diffHunks(leftLines, rightLines);
  const changedLeft = new Set<number>();
  const changedRight = new Set<number>();
  for (const hunk of hunks) {
    for (let i = hunk.baseStart; i < hunk.baseEnd; i++) changedLeft.add(i);
    for (let i = hunk.sideStart; i < hunk.sideEnd; i++) changedRight.add(i);
  }
  const column = (lines: string[], changed: Set<number>, label: string) => (
    <div className="compare-column">
      <div className="compare-column-title">{label}</div>
      <div className="compare-scroll">
        {lines.map((line, i) => (
          <div key={i} className={cx("compare-line", changed.has(i) && "changed")}>
            <span className="compare-number">{i + 1}</span>
            <span className="compare-text">{line || "\u00a0"}</span>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <Modal title={`${t("compare")} — ${leftLabel} / ${rightLabel}`} icon="diff" width={980} onClose={onClose}>
      <div className="compare-grid">
        {column(leftLines, changedLeft, leftLabel)}
        {column(rightLines, changedRight, rightLabel)}
      </div>
    </Modal>
  );
}

type VersionKey = "base" | "ours" | "theirs" | "result";

/** How much of a conflicting line is marked: whole lines, words, characters,
 *  or nothing beyond the block tint. */
type HighlightMode = "none" | "lines" | "words" | "chars";

interface SyncAnchor {
  side: number;
  result: number;
}

/** One connector between the result's block and the same range in a version
 *  pane. The panes scroll independently and keep their own line numbering, so
 *  blocks of one change sit at different heights; the connector is what says
 *  they belong together, the way the IDE draws it. */
interface RibbonLink {
  id: number;
  side: "ours" | "theirs";
  tone: MergePaneTone;
  points: string;
}

/** Anchors from the side's lines to the result's: every unchanged stretch starts
 *  one, so sync scrolling follows the text rather than a stored placement. */
function anchorsFor(sideLines: string[], resultLines: string[]): SyncAnchor[] {
  const anchors: SyncAnchor[] = [];
  let side = 0;
  let result = 0;
  for (const hunk of diffHunks(sideLines, resultLines)) {
    if (hunk.baseStart > side) anchors.push({ side: side + 1, result: result + 1 });
    side = hunk.baseEnd;
    result = hunk.sideEnd;
  }
  if (side < sideLines.length && result < resultLines.length) {
    anchors.push({ side: side + 1, result: result + 1 });
  }
  return anchors;
}

function mapLine(line: number, anchors: SyncAnchor[], from: "side" | "result"): number {
  let pick: SyncAnchor = { side: 1, result: 1 };
  for (const anchor of anchors) {
    if (anchor[from] <= line) pick = anchor;
    else break;
  }
  const to = from === "side" ? "result" : "side";
  return Math.max(1, pick[to] + (line - pick[from]));
}

export function ConflictView({
  path,
  conflict,
  details,
  oursLabel,
  theirsLabel,
  busy,
  onSave,
  onTakeSide,
  onClose,
  onShowHistory,
  onDirtyChange,
  onAutoMerge,
  visible = true,
}: {
  path: string;
  conflict: ConflictContent;
  details: MergeDetails | null;
  oursLabel: string;
  theirsLabel: string;
  busy: boolean;
  onSave: (content: string, stage: boolean, advance: boolean) => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onClose: () => void;
  onShowHistory?: (line: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Merge the three stages in memory and write the result; the host owns
   *  the repository call and the reload that follows it. */
  onAutoMerge?: () => void;
  visible?: boolean;
}) {
  const t = useT(T);
  const tr = (key: string) => t(key as Parameters<typeof t>[0]);
  const [whitespaceMode, setWhitespaceMode] = useState<WhitespaceMode>("none");
  const [highlightMode, setHighlightMode] = useState<HighlightMode>("words");
  const labels = useMemo<MergeLabels>(() => {
    const fromFile = conflictLabels(conflict.working) ?? {};
    return {
      ours: oursLabel.trim() || fromFile.ours?.trim() || "LOCAL",
      theirs: theirsLabel.trim() || fromFile.theirs?.trim() || "REMOTE",
    };
  }, [conflict.working, oursLabel, theirsLabel]);
  const rawWorking = useMemo(() => normalizeText(conflict.working), [conflict.working]);
  const ending = useMemo(
    () => detectLineEnding(conflict.working || conflict.ours || conflict.base),
    [conflict.base, conflict.ours, conflict.working],
  );
  const model = useMemo(
    () =>
      computeMerge(normalizeText(conflict.base), normalizeText(conflict.ours), normalizeText(conflict.theirs), {
        labels,
        trailingNewline: rawWorking.endsWith("\n") || normalizeText(conflict.ours).endsWith("\n"),
        whitespaceMode,
      }),
    [conflict.base, conflict.ours, conflict.theirs, labels, rawWorking, whitespaceMode],
  );
  // The result starts as the merge base, the way the IDE opens a merge: every
  // range is a block that still waits for a decision.
  const initial = useMemo(() => buildMergeView(model), [model]);
  const stateFromView = useMemo(
    () =>
      new Map<number, RangeState>(
        initial.blocks.map((block) => [block.index, { lines: block.lines, left: false, right: false, oneside: false }]),
      ),
    [initial],
  );
  const initialText = initial.text;
  const [resultText, setResultText] = useState(initialText);
  const [unresolved, setUnresolved] = useState(initial.blocks.length);
  const [dirty, setDirty] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<{
    side: "ours" | "theirs";
    start: number;
    end: number;
    empty: boolean;
  } | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [compare, setCompare] = useState<{ left: VersionKey; right: VersionKey } | null>(null);
  const [compareText, setCompareText] = useState<
    { leftText: string; rightText: string; leftLabel: string; rightLabel: string } | null
  >(null);
  const [detailsSide, setDetailsSide] = useState<"ours" | "theirs" | null>(null);
  const [pendingSave, setPendingSave] = useState<{ stage: boolean; advance: boolean } | null>(null);
  const [pendingWhitespace, setPendingWhitespace] = useState<WhitespaceMode | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [links, setLinks] = useState<RibbonLink[]>([]);

  const oursRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const leftRibbonRef = useRef<HTMLDivElement>(null);
  const rightRibbonRef = useRef<HTMLDivElement>(null);
  const linksKey = useRef("");
  const measureFrame = useRef(0);
  const oursPane = useRef<MergePane | null>(null);
  const resultPane = useRef<MergePane | null>(null);
  const theirsPane = useRef<MergePane | null>(null);
  const initialRef = useRef(initialText);
  const resultTextRef = useRef(initialText);
  const blocksRef = useRef<Map<number, RangeState>>(new Map(stateFromView));
  const anchorCache = useRef<{ text: string; ours: SyncAnchor[]; theirs: SyncAnchor[] } | null>(null);
  const lock = useRef(0);
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  /** Reads both panes' block positions and rebuilds the connectors. It runs on
   *  scroll, resize and every block change, and stops at the first frame whose
   *  geometry did not move. */
  const measureLinks = useCallback(() => {
    const result = resultPane.current;
    const ours = oursPane.current;
    const theirs = theirsPane.current;
    const leftTrack = leftRibbonRef.current;
    const rightTrack = rightRibbonRef.current;
    if (!result || !ours || !theirs || !leftTrack || !rightTrack) return;
    const next: RibbonLink[] = [];
    const collect = (side: "ours" | "theirs", track: HTMLDivElement) => {
      const pane = side === "ours" ? ours : theirs;
      const height = track.clientHeight;
      if (height <= 1) return;
      const y = (value: number) => ((value / height) * 1000).toFixed(1);
      for (const block of result.getBlocks()) {
        const range = model.ranges[block.id];
        if (!range) continue;
        if (side === "ours" ? !range.oursChanged : !range.theirsChanged) continue;
        const start = (side === "ours" ? range.oursStart : range.theirsStart) + 1;
        const end = Math.max(start, side === "ours" ? range.oursEnd : range.theirsEnd);
        const head = result.spanFor(block.from, block.to);
        const tail = pane.lineSpan(start, end);
        next.push({
          id: block.id,
          side,
          tone: range.kind === "conflict" ? (block.tone === "resolved" ? "resolved" : "conflict") : side,
          points: `0,${y(head.top)} 100,${y(tail.top)} 100,${y(tail.bottom)} 0,${y(head.bottom)}`,
        });
      }
    };
    collect("ours", leftTrack);
    collect("theirs", rightTrack);
    const key = JSON.stringify(next);
    if (key === linksKey.current) return;
    linksKey.current = key;
    setLinks(next);
  }, [model]);

  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current) return;
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = 0;
      measureLinks();
    });
  }, [measureLinks]);

  // Block text changes (a decision, a typed edit) move the spans without a
  // scroll event; the frame after any render is enough to follow them.
  useEffect(() => {
    scheduleMeasure();
  });

  useEffect(() => {
    const panes = panesRef.current;
    if (!panes) return;
    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(panes);
    return () => observer.disconnect();
  }, [scheduleMeasure]);

  useEffect(
    () => () => {
      if (measureFrame.current) cancelAnimationFrame(measureFrame.current);
    },
    [],
  );
  const requestSaveRef = useRef<(stage: boolean, advance: boolean) => void>(() => {});
  const scrolledToFirst = useRef(false);
  const journal = useRef<{ entries: JournalEntry[]; at: number }>({ entries: [], at: 0 });
  const lastAction = useRef<"decision" | "edit" | null>(null);
  const programmatic = useRef(false);
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  /** A decided conflict changes the saved file even when its text did not
   *  move: saving drops the markers. */
  const isDirty = useCallback(
    () => resultTextRef.current !== initialRef.current || journal.current.at > 0,
    [],
  );

  /** Closing an unsaved result discards work, so ask first, as the IDE does. */
  const requestClose = useCallback(() => {
    if (isDirty()) setConfirmClose(true);
    else onClose();
  }, [isDirty, onClose]);

  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const endingRef = useRef(ending);
  endingRef.current = ending;
  useEffect(() => {
    initialRef.current = initial.text;
    resultTextRef.current = initial.text;
    blocksRef.current = new Map(stateFromView);
    anchorCache.current = null;
    journal.current = { entries: [], at: 0 };
    lastAction.current = null;
    setResultText(initial.text);
    setUnresolved(initial.blocks.length);
    setDirty(false);
  }, [initial, stateFromView]);
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  const ranges = model.ranges;
  const conflicts = ranges.filter((r) => r.kind === "conflict");
  // The IDE keeps "Apply changes" for a fully decided merge; a save with
  // anything left writes the file back as the merge found it.
  const canApply = !busy && !conflict.binary && unresolved === 0;
  /** Which of the IDE's three "apply non-conflicting changes" arrows has work
   *  left: a one-sided range that is still undecided. */
  const applyable = {
    ours: ranges.some(
      (range) => range.kind !== "conflict" && range.oursChanged && !decided(blocksRef.current.get(range.index)),
    ),
    theirs: ranges.some(
      (range) => range.kind !== "conflict" && range.theirsChanged && !decided(blocksRef.current.get(range.index)),
    ),
    base: ranges.some(
      (range) =>
        range.kind !== "conflict" &&
        (range.oursChanged || range.theirsChanged) &&
        !decided(blocksRef.current.get(range.index)),
    ),
  };

  /** Conflicts the IDE's word-level text merge can settle, worked out once per
   *  model the way the IDE decides a conflict's resolution strategy when it
   *  builds the ranges. */
  const resolvableConflicts = useMemo(() => {
    const out = new Set<number>();
    for (const range of ranges) {
      if (range.kind === "conflict" && tryResolveRange(range) !== null) out.add(range.index);
    }
    return out;
  }, [ranges]);
  /** The wand needs an untouched conflict it can merge; with nothing left it
   *  is disabled, as in the IDE. */
  const wandable = ranges.some((range) => {
    if (!resolvableConflicts.has(range.index)) return false;
    const state = blocksRef.current.get(range.index);
    return !!state && !state.left && !state.right;
  });

  /** The file as Git must see it. Only a completely decided result is written;
   *  with anything still undecided the file goes back exactly as the merge
   *  found it (Git's own markers), which is what the IDE's save does. */
  const textForDisk = useCallback(() => {
    const pane = resultPane.current;
    const decidedResult = pane ? pane.getDoc() : resultTextRef.current;
    if (countUnresolved(blocksRef.current) > 0) return rawWorking;
    return decidedResult;
  }, [rawWorking]);

  const requestSave = useCallback(
    (stage: boolean, advance: boolean) => {
      if (busyRef.current || conflict.binary) return;
      // A file saved with markers cannot be staged; the prompt offers to write
      // it as-is and the operation stays unmerged.
      if (countUnresolved(blocksRef.current) > 0) setPendingSave({ stage: false, advance });
      else saveRef.current(withLineEnding(resultTextRef.current, endingRef.current), stage, advance);
    },
    [conflict.binary],
  );
  requestSaveRef.current = requestSave;

  /** "Ignore differences" rebuilds the three-way model, so the decisions and
   *  edits made against the old comparison cannot survive it. Ask first, the
   *  way the IDE does when a merge restarts. */
  const chooseWhitespace = (mode: WhitespaceMode) => {
    if (mode === whitespaceMode) return;
    if (isDirty()) {
      setPendingWhitespace(mode);
      return;
    }
    setWhitespaceMode(mode);
  };

  const scrollToRange = useCallback((range: MergeRange) => {
    oursPane.current?.scrollToLine(range.oursStart + 1);
    theirsPane.current?.scrollToLine(range.theirsStart + 1);
    const pane = resultPane.current;
    if (!pane) return;
    const block = pane.getBlocks().find((candidate) => candidate.id === range.index);
    if (!block) return;
    const doc = pane.view.state.doc;
    pane.scrollToLine(doc.lineAt(Math.max(0, Math.min(block.from, doc.length))).number);
  }, []);

  /** The changed range whose block holds a line of the result. A caret outside
   *  every block has no range: acting on a conflict the reader is not looking
   *  at is how a click in the wrong place used to resolve the wrong block. */
  const rangeAtResultLine = useCallback(
    (line: number): MergeRange | null => {
      const pane = resultPane.current;
      if (!pane) return null;
      const doc = pane.view.state.doc;
      for (const block of pane.getBlocks()) {
        const range = ranges[block.id];
        if (!range) continue;
        const first = doc.lineAt(Math.max(0, Math.min(block.from, doc.length))).number;
        const last = doc.lineAt(Math.max(0, Math.min(block.to > block.from ? block.to - 1 : block.from, doc.length))).number;
        if (line >= first && line <= last) return range;
      }
      return null;
    },
    [ranges],
  );
  const rangeAtCaret = useCallback((): MergeRange | null => {
    const pane = resultPane.current;
    return pane ? rangeAtResultLine(pane.caretLine()) : null;
  }, [rangeAtResultLine]);
  const rangeAtSideLine = useCallback(
    (side: "ours" | "theirs", line: number): MergeRange | null =>
      ranges.find((range) => {
        const first = (side === "ours" ? range.oursStart : range.theirsStart) + 1;
        const last = Math.max(first, side === "ours" ? range.oursEnd : range.theirsEnd);
        return line >= first && line <= last;
      }) ?? null,
    [ranges],
  );
  /** The range under the caret in one of the side panes. */
  const rangeAtSide = useCallback(
    (side: "ours" | "theirs"): MergeRange | null =>
      selected ? rangeAtSideLine(side, Math.min(selected.start, selected.end)) : null,
    [rangeAtSideLine, selected],
  );
  /** The toolbar counter follows the caret, the way the IDE's does. */
  const syncCurrentRef = useRef<(line: number) => void>(() => {});
  syncCurrentRef.current = (line) => {
    const range = rangeAtResultLine(line);
    if (range) setCurrent(range.index);
  };

  const jump = useCallback(
    (delta: number) => {
      if (ranges.length === 0) return;
      const at = rangeAtCaret();
      const base = at ? at.index : Math.max(0, Math.min(current, ranges.length - 1));
      const next = Math.max(0, Math.min(ranges.length - 1, base + delta));
      setCurrent(next);
      const range = ranges[next];
      if (!range) return;
      scrollToRange(range);
      // The caret travels with the navigation: without it the next press would
      // start again from the block the reader left behind.
      const pane = resultPane.current;
      const block = pane?.getBlocks().find((candidate) => candidate.id === range.index);
      if (!pane || !block) return;
      const anchor = Math.min(block.from, pane.view.state.doc.length);
      pane.view.dispatch({ selection: { anchor } });
    },
    [current, ranges, rangeAtCaret, scrollToRange],
  );

  /** The decorations and counts are derived from `blocksRef`, not from the
   *  document, so a decision that leaves the text unchanged (accepting the
   *  side the result already shows) still updates every pane. */
  const refreshDecorations = useCallback(() => {
    const pending = new Set<number>();
    for (const [index, state] of blocksRef.current) {
      if (!decided(state)) pending.add(index);
    }
    const result = resultPane.current;
    if (result) {
      const blocks = result.getBlocks();
      const next = blocks.map((block) => {
        const state = blocksRef.current.get(block.id);
        const range = model.ranges[block.id];
        const resolved = decided(state);
        return {
          ...block,
          tone: resolved ? "resolved" : range?.kind === "conflict" ? "conflict" : range?.oursChanged ? "ours" : "theirs",
          revert: revertable(range, state),
          title: resolved ? (range ? rangeType(range, tr) : t("resolvedBlock")) : t("conflictBlock"),
        } satisfies MergePaneBlock;
      });
      if (
        next.some(
          (block, i) =>
            block.tone !== blocks[i]?.tone ||
            block.title !== blocks[i]?.title ||
            block.revert !== blocks[i]?.revert,
        )
      ) {
        result.setBlocks(next);
      }
    }
    for (const [pane, side] of [
      [oursPane.current, "ours"],
      [theirsPane.current, "theirs"],
    ] as const) {
      if (!pane) continue;
      pane.setBlocks(
        pane.getBlocks().map((block) => {
          const range = model.ranges[block.id];
          if (!range) return block;
          // A one-sided change stays actionable even though the result already
          // carries it: accepting it replaces the other side's text, ignoring
          // it takes the auto-merged change back.
          const state = blocksRef.current.get(block.id);
          // A side that has been taken (applied or ignored) leaves only its
          // status mark; Ctrl+Z is how that decision is undone.
          const open = state ? !(side === "ours" ? state.left : state.right) : true;
          const resolved = decided(state);
          return {
            ...block,
            apply: open ? side : undefined,
            ignore: open,
            tone: resolved ? "resolved" : range.kind === "conflict" ? "conflict" : side,
            title: open
              ? `${t(side === "ours" ? "applyLocal" : "applyRemote")} · ${rangeType(range, tr)}`
              : rangeType(range, tr),
          };
        }),
      );
    }
    setUnresolved(pending.size);
  }, [model, t, tr]);

  /** Pushes a decision and applies it: the block states change here, the text
   *  changes atomically, and the entry becomes the undo target. */
  const commitDecision = useCallback(
    (changes: BlockChange[]) => {
      const pane = resultPane.current;
      if (!pane || changes.length === 0) return;
      const next = new Map(blocksRef.current);
      for (const change of changes) next.set(change.index, change.after);
      blocksRef.current = next;
      const history = journal.current;
      history.entries.length = history.at;
      history.entries.push({ changes });
      history.at = history.entries.length;
      lastAction.current = "decision";
      programmatic.current = true;
      try {
        pane.replaceBlocks(
          changes.map((change) => ({ id: change.index, lines: change.after.lines })),
          { history: false },
        );
      } finally {
        programmatic.current = false;
      }
      refreshDecorations();
      setDirty(isDirty());
    },
    [isDirty, refreshDecorations],
  );

  /** Applies one side of the journal. The restore is not recorded in the
   *  editor's own history: decisions live here, typing lives there. */
  const restoreDecision = useCallback(
    (entry: Decision, side: "before" | "after") => {
      const pane = resultPane.current;
      if (!pane) return;
      const next = new Map(blocksRef.current);
      for (const change of entry.changes) next.set(change.index, change[side]);
      blocksRef.current = next;
      programmatic.current = true;
      try {
        pane.replaceBlocks(
          entry.changes.map((change) => ({ id: change.index, lines: change[side].lines })),
          { history: false },
        );
      } finally {
        programmatic.current = false;
      }
      resultTextRef.current = pane.getDoc();
      setResultText(resultTextRef.current);
      anchorCache.current = null;
      refreshDecorations();
      setDirty(isDirty());
    },
    [isDirty, refreshDecorations],
  );

  /** Puts the result pane into a stored state whole: the text and the block
   *  spans travel together, so undoing a whole-side resolution cannot leave
   *  blocks pointing at text that is gone. */
  const resetPane = useCallback(
    (text: string, blocks: MergePaneBlock[], states: Map<number, RangeState>) => {
      const pane = resultPane.current;
      if (!pane) return;
      programmatic.current = true;
      try {
        pane.replaceAll(text, { history: false });
      } finally {
        programmatic.current = false;
      }
      pane.setBlocks(blocks);
      blocksRef.current = new Map(states);
      anchorCache.current = null;
      resultTextRef.current = pane.getDoc();
      setResultText(resultTextRef.current);
      refreshDecorations();
      setDirty(isDirty());
    },
    [isDirty, refreshDecorations],
  );

  const stepDecision = useCallback(
    (direction: -1 | 1) => {
      const history = journal.current;
      if (direction < 0) {
        if (history.at === 0) return false;
        history.at--;
        const entry = history.entries[history.at]!;
        if ("whole" in entry) resetPane(entry.whole.beforeText, entry.whole.beforeBlocks, entry.whole.beforeStates);
        else restoreDecision(entry, "before");
      } else {
        if (history.at >= history.entries.length) return false;
        history.at++;
        const entry = history.entries[history.at - 1]!;
        if ("whole" in entry) resetPane(entry.whole.afterText, [], entry.whole.afterStates);
        else restoreDecision(entry, "after");
      }
      lastAction.current = "decision";
      return true;
    },
    [resetPane, restoreDecision],
  );

  /** Ctrl+Z: undo the last decision when it is the newest action; otherwise let
   *  the editor undo typing. Decisions are never in the editor's history, so
   *  the two stacks cannot undo each other's work. */
  const undo = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return;
    if (lastAction.current === "decision" && stepDecision(-1)) return;
    if (pane.undo()) {
      lastAction.current = "edit";
      return;
    }
    stepDecision(-1);
  }, [stepDecision]);

  const redo = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return;
    if (lastAction.current === "decision" && stepDecision(1)) return;
    if (pane.redo()) {
      lastAction.current = "edit";
      return;
    }
    stepDecision(1);
  }, [stepDecision]);

  undoRef.current = undo;
  redoRef.current = redo;

  /** Applies one side of one range, the way the IDE's gutter arrows do. A
   *  conflict stays open when only one side has been taken: the other side is
   *  still there to accept, and accepting it afterwards appends its lines. */
  const applyChange = useCallback(
    (index: number, side: "ours" | "theirs", resolveChange = false) => {
      const pane = resultPane.current;
      const range = model.ranges[index];
      const state = blocksRef.current.get(index);
      if (!pane || !range || !state) return;
      const applied = side === "ours" ? state.left : state.right;
      if (applied) return;
      const changed = side === "ours" ? range.oursChanged : range.theirsChanged;
      if (!changed) {
        // The side did not touch the range, so taking it decides the change
        // without moving any text.
        commitDecision([{ index, before: state, after: { ...state, left: true, right: true } }]);
        return;
      }
      const lines = side === "ours" ? range.ours : range.theirs;
      const otherHasText = (side === "ours" ? range.theirs : range.ours).length > 0;
      if (range.kind === "conflict" && !resolveChange && otherHasText) {
        // Half a conflict: the chosen side goes into the result, the other one
        // stays pending, and a later accept of it appends instead of replacing.
        const next = state.oneside ? [...state.lines, ...lines] : lines;
        commitDecision([
          {
            index,
            before: state,
            after: {
              lines: next,
              left: side === "ours" || state.left,
              right: side === "theirs" || state.right,
              oneside: true,
            },
          },
        ]);
        return;
      }
      commitDecision([{ index, before: state, after: { lines, left: true, right: true, oneside: false } }]);
      // Accepting a conflict advances the caret to the next open block, the way
      // the IDE moves on after a decision.
      const open = [...blocksRef.current.entries()]
        .filter(([, candidate]) => !decided(candidate))
        .map(([id]) => id)
        .sort((a, b) => a - b);
      const after = open.find((candidate) => candidate > index) ?? open[0];
      if (after === undefined) return;
      setCurrent(after);
      const block = pane.getBlocks().find((candidate) => candidate.id === after);
      if (!block) return;
      const doc = pane.view.state.doc;
      const at = Math.min(block.from, doc.length);
      pane.view.dispatch({ selection: { anchor: at } });
      pane.scrollToLine(doc.lineAt(at).number);
    },
    [commitDecision, model],
  );

  /** Accepts one side of a range; the other side of a conflict stays open. */
  const applyRange = useCallback(
    (index: number, side: "ours" | "theirs") => applyChange(index, side, false),
    [applyChange],
  );

  /** Ignore a side: record the decision without moving the text, so the range
   *  keeps whatever the result already holds. */
  const ignoreChange = useCallback(
    (index: number, side: "ours" | "theirs") => {
      const range = model.ranges[index];
      const state = blocksRef.current.get(index);
      if (!range || !state) return;
      if (side === "ours" ? state.left : state.right) return;
      commitDecision([
        {
          index,
          before: state,
          after:
            range.kind === "conflict"
              ? { ...state, left: side === "ours" || state.left, right: side === "theirs" || state.right }
              : { ...state, left: true, right: true },
        },
      ]);
    },
    [commitDecision, model],
  );

  /** The IDE's Revert: the range goes back to the merge base, undecided. */
  const resetRange = useCallback(
    (index: number) => {
      const range = model.ranges[index];
      const state = blocksRef.current.get(index);
      if (!range || !state || !decided(state)) return;
      commitDecision([
        { index, before: state, after: { lines: range.base, left: false, right: false, oneside: false } },
      ]);
    },
    [commitDecision, model],
  );

  /** "Apply non-conflicting changes": the IDE's three toolbar arrows. `base`
   *  takes the side that changed each range, the other two only that side. */
  const applyNonConflicted = useCallback(
    (side: "ours" | "theirs" | "base") => {
      const changes: BlockChange[] = [];
      for (const [index, state] of blocksRef.current) {
        if (decided(state)) continue;
        const range = ranges[index];
        if (!range || range.kind === "conflict") continue;
        const pick =
          side === "ours"
            ? range.oursChanged
              ? "ours"
              : null
            : side === "theirs"
              ? range.theirsChanged
                ? "theirs"
                : null
              : range.oursChanged
                ? "ours"
                : range.theirsChanged
                  ? "theirs"
                  : null;
        if (!pick) continue;
        changes.push({
          index,
          before: state,
          after: { lines: pick === "ours" ? range.ours : range.theirs, left: true, right: true, oneside: false },
        });
      }
      commitDecision(changes);
    },
    [commitDecision, ranges],
  );

  /** Resolve one conflict with the word-level text merge the wand uses. */
  const autoResolveOne = useCallback(
    (index: number) => {
      const range = model.ranges[index];
      const state = blocksRef.current.get(index);
      if (!range || !state || decided(state) || state.left || state.right) return;
      const lines = tryResolveRange(range);
      if (!lines) return;
      commitDecision([{ index, before: state, after: { lines, left: true, right: true, oneside: false } }]);
    },
    [commitDecision, model],
  );

  const autoResolve = useCallback(() => {
    const changes: BlockChange[] = [];
    for (const [index, state] of blocksRef.current) {
      if (decided(state) || state.left || state.right) continue;
      const range = ranges[index];
      if (!range || range.kind !== "conflict") continue;
      const resolved = tryResolveRange(range);
      if (!resolved) continue;
      changes.push({ index, before: state, after: { lines: resolved, left: true, right: true, oneside: false } });
    }
    commitDecision(changes);
  }, [commitDecision, ranges]);

  const openViewMenu = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: t("syncScroll"), icon: "refresh", checked: autoScroll, onClick: () => setAutoScroll((v) => !v) },
        {
          label: t("ignoreDiff"),
          icon: "eye",
          children: [
            { label: t("ignoreNone"), checked: whitespaceMode === "none", onClick: () => chooseWhitespace("none") },
            { label: t("ignoreTrim"), checked: whitespaceMode === "trim", onClick: () => chooseWhitespace("trim") },
            { label: t("ignoreSpaces"), checked: whitespaceMode === "spaces", onClick: () => chooseWhitespace("spaces") },
          ],
        },
        {
          label: t("highlightDiff"),
          icon: "diff",
          children: [
            { label: t("highlightNone"), checked: highlightMode === "none", onClick: () => setHighlightMode("none") },
            { label: t("highlightLines"), checked: highlightMode === "lines", onClick: () => setHighlightMode("lines") },
            { label: t("highlightWords"), checked: highlightMode === "words", onClick: () => setHighlightMode("words") },
            { label: t("highlightChars"), checked: highlightMode === "chars", onClick: () => setHighlightMode("chars") },
          ],
        },
        {
          label: t("appearance"),
          icon: "settings",
          children: [
            { label: t("softWrap"), checked: wrap, onClick: () => setWrap((v) => !v) },
            { label: t("showWhitespace"), checked: showWhitespace, onClick: () => setShowWhitespace((v) => !v) },
            { label: t("collapseUnchanged"), checked: collapsed, onClick: () => setCollapsed((v) => !v) },
          ],
        },
      ],
    });
  };

  const openCompareMenu = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: t("compareLocalBase"), icon: "diff", onClick: () => setCompare({ left: "base", right: "ours" }) },
        { label: t("compareRemoteBase"), icon: "diff", onClick: () => setCompare({ left: "base", right: "theirs" }) },
        { label: t("compareLocalRemote"), icon: "diff", onClick: () => setCompare({ left: "ours", right: "theirs" }) },
        { label: t("compareResultBase"), icon: "diff", onClick: () => setCompare({ left: "base", right: "result" }) },
      ],
    });
  };

  /** "Resolve Using Left/Right": the whole result becomes that revision. */
  const applyWholeSide = useCallback(
    (side: "ours" | "theirs") => {
      const pane = resultPane.current;
      if (!pane) return;
      const text = normalizeText(side === "ours" ? conflict.ours : conflict.theirs);
      const afterStates = new Map<number, RangeState>();
      for (const [index, state] of blocksRef.current) {
        afterStates.set(index, { ...state, lines: [], left: true, right: true, oneside: false });
      }
      const history = journal.current;
      history.entries.length = history.at;
      history.entries.push({
        whole: {
          beforeText: pane.getDoc(),
          beforeBlocks: pane.getBlocks(),
          beforeStates: new Map(blocksRef.current),
          afterText: text,
          afterStates,
        },
      });
      history.at = history.entries.length;
      lastAction.current = "decision";
      resetPane(text, [], afterStates);
    },
    [conflict.ours, conflict.theirs, resetPane],
  );

  const compareClipboard = useCallback(
    async (side: "ours" | "theirs" | "result") => {
      try {
        const text = await navigator.clipboard.readText();
        const source = side === "ours" ? conflict.ours : side === "theirs" ? conflict.theirs : resultText;
        setCompareText({
          leftText: source,
          rightText: text,
          leftLabel: side === "ours" ? t("local") : side === "theirs" ? t("remote") : t("result"),
          rightLabel: t("compareClipboard"),
        });
      } catch {
        // Clipboard read can be denied; the menu item then does nothing.
      }
    },
    [conflict.ours, conflict.theirs, resultText, t],
  );

  const openPaneMenu = (event: React.MouseEvent, side: "ours" | "theirs" | "result") => {
    event.preventDefault();
    const pane =
      side === "ours" ? oursPane.current : side === "theirs" ? theirsPane.current : resultPane.current;
    const pointerLine = pane?.lineAtCoords(event.clientX, event.clientY) ?? null;
    const target =
      pointerLine == null
        ? side === "result"
          ? rangeAtCaret()
          : rangeAtSide(side)
        : side === "result"
          ? rangeAtResultLine(pointerLine)
          : rangeAtSideLine(side, pointerLine);
    const conflictTarget = target?.kind === "conflict" ? target : null;
    const state = target ? blocksRef.current.get(target.index) : undefined;
    const sideTarget =
      target && (side === "ours" ? target.oursChanged : side === "theirs" ? target.theirsChanged : false)
        ? target
        : null;
    const resolvable = conflictTarget !== null && resolvableConflicts.has(conflictTarget.index);
    const items: ContextItem[] = [];
    if (side === "result") {
      items.push({
        label: t("acceptLeft"),
        shortcut: "⌘⌃→",
        icon: "ours",
        disabled: conflictTarget === null,
        onClick: () => conflictTarget && applyRange(conflictTarget.index, "ours"),
      });
      items.push({
        label: t("acceptRight"),
        shortcut: "⌘⌃←",
        icon: "theirs",
        disabled: conflictTarget === null,
        onClick: () => conflictTarget && applyRange(conflictTarget.index, "theirs"),
      });
      items.push({
        label: t("resolveAutomatically"),
        icon: "sparkle",
        disabled: !conflictTarget || decided(state) || state?.left === true || state?.right === true || !resolvable,
        onClick: () => conflictTarget && autoResolveOne(conflictTarget.index),
      });
      items.push({
        label: t("revertChange"),
        icon: "undo",
        disabled: !revertable(target ?? undefined, state),
        onClick: () => target && resetRange(target.index),
      });
      items.push({ separator: true });
      items.push({ label: t("resolveUsingLocal"), icon: "ours", onClick: () => applyWholeSide("ours") });
      items.push({ label: t("resolveUsingRemote"), icon: "theirs", onClick: () => applyWholeSide("theirs") });
    } else {
      items.push({
        label: t("accept"),
        shortcut: side === "ours" ? "⌘⌃→" : "⌘⌃←",
        icon: side,
        // Every change the side made can be accepted, not only a conflict:
        // this is how one side of an auto-merged change replaces the other.
        disabled: sideTarget === null,
        onClick: () => {
          if (sideTarget) applyRange(sideTarget.index, side);
        },
      });
      items.push({
        label: side === "ours" ? t("resolveUsingLocal") : t("resolveUsingRemote"),
        icon: side,
        onClick: () => applyWholeSide(side),
      });
      items.push({
        label: t("ignore"),
        icon: "eye",
        disabled: sideTarget === null,
        onClick: () => {
          if (sideTarget) ignoreChange(sideTarget.index, side);
        },
      });
    }
    items.push({ separator: true });
    items.push({
      label: t("compareClipboard"),
      icon: "diff",
      onClick: () => void compareClipboard(side),
    });
    if (side !== "result" && onShowHistory) {
      const line = side === "ours" ? target?.oursStart : target?.theirsStart;
      items.push({
        label: t("annotateBlame"),
        icon: "clock",
        onClick: () => onShowHistory((line ?? 0) + 1),
      });
    }
    items.push({ separator: true });
    items.push({
      label: t("collapseUnchanged"),
      icon: "collapse",
      checked: collapsed,
      onClick: () => setCollapsed((v) => !v),
    });
    items.push({
      label: t("syncScroll"),
      icon: "refresh",
      checked: autoScroll,
      onClick: () => setAutoScroll((v) => !v),
    });
    setMenu({ x: event.clientX, y: event.clientY, items });
  };

  /** A change in the result is the state change: a conflict block whose text
   *  moved is settled, and every pane's decorations follow the block, never the
   *  marker text. */
  const onResultChange = useCallback(
    (doc: string, blocks: MergePaneBlock[]) => {
      resultTextRef.current = doc;
      anchorCache.current = null;
      setResultText(doc);
      // The journal owns decisions: a restore it dispatched must not be read
      // back as a fresh manual edit of the same blocks.
      if (!programmatic.current) {
        lastAction.current = "edit";
        const history = journal.current;
        if (history.at < history.entries.length) history.entries.length = history.at;
        const next = new Map(blocksRef.current);
        let changed = false;
        for (const block of blocks) {
          const state = next.get(block.id);
          if (!state) continue;
          const lines = blockLines(doc, block);
          if (sameLines(state.lines, lines)) continue;
          // A manual edit decides the block: it no longer waits for a side.
          next.set(block.id, { lines, left: true, right: true, oneside: false });
          changed = true;
        }
        if (changed) {
          blocksRef.current = next;
          refreshDecorations();
        }
      }
      setDirty(isDirty());
    },
    [isDirty, refreshDecorations],
  );
  const changeRef = useRef(onResultChange);
  changeRef.current = onResultChange;

  useEffect(() => {
    const oursEl = oursRef.current;
    const resultEl = resultRef.current;
    const theirsEl = theirsRef.current;
    if (!oursEl || !resultEl || !theirsEl) return;

    const anchorsForSide = (side: "ours" | "theirs"): SyncAnchor[] => {
      const text = resultTextRef.current;
      if (!anchorCache.current || anchorCache.current.text !== text) {
        const resultLines = splitLines(text).lines;
        anchorCache.current = {
          text,
          ours: anchorsFor(splitLines(normalizeText(conflict.ours)).lines, resultLines),
          theirs: anchorsFor(splitLines(normalizeText(conflict.theirs)).lines, resultLines),
        };
      }
      return side === "ours" ? anchorCache.current.ours : anchorCache.current.theirs;
    };

    const sync = (source: "ours" | "result" | "theirs", line: number) => {
      if (!autoScrollRef.current) return;
      const now = performance.now();
      if (now < lock.current) return;
      lock.current = now + 120;
      const oursAnchors = anchorsForSide("ours");
      const theirsAnchors = anchorsForSide("theirs");
      if (source === "ours") {
        const resultLine = mapLine(line, oursAnchors, "side");
        resultPane.current?.scrollToLine(resultLine);
        theirsPane.current?.scrollToLine(mapLine(resultLine, theirsAnchors, "result"));
      } else if (source === "theirs") {
        const resultLine = mapLine(line, theirsAnchors, "side");
        resultPane.current?.scrollToLine(resultLine);
        oursPane.current?.scrollToLine(mapLine(resultLine, oursAnchors, "result"));
      } else {
        oursPane.current?.scrollToLine(mapLine(line, oursAnchors, "result"));
        theirsPane.current?.scrollToLine(mapLine(line, theirsAnchors, "result"));
      }
    };

    const ours = new MergePane(oursEl, {
      doc: conflict.ours,
      editable: false,
      language: conflict.language,
      blocks: sideBlocks(model, "ours", {
        apply: t("applyLocal"),
        t: tr,
        chars: highlightMode === "chars",
        marks: highlightMode === "words" || highlightMode === "chars",
      }),
      wrap,
      whitespace: showWhitespace,
      onApplyBlock: (id) => applyRange(id, "ours"),
      onIgnoreBlock: (id) => ignoreChange(id, "ours"),
      actionLabels: { apply: t("acceptLeft"), ignore: t("ignore") },
      side: "after",
      numbers: "after",
      onScroll: (line) => {
        sync("ours", line);
        scheduleMeasure();
      },
      onSelection: (start, end, empty) => setSelected({ side: "ours", start, end, empty }),
    });
    const result = new MergePane(resultEl, {
      doc: initialText,
      editable: true,
      language: conflict.language,
      blocks: resultBlocks(model, blocksRef.current, initial, tr),
      wrap,
      whitespace: showWhitespace,
      onRevertBlock: (id) => resetRange(id),
      actionLabels: { apply: t("apply"), ignore: t("ignore"), revert: t("revertChange") },
      numbers: "both",
      onScroll: (line) => {
        sync("result", line);
        scheduleMeasure();
      },
      onSelection: (start) => syncCurrentRef.current(start),
      onSaveRequest: () => requestSaveRef.current(true, true),
      onUndoRequest: () => undoRef.current(),
      onRedoRequest: () => redoRef.current(),
      onChange: (doc, blocks) => changeRef.current(doc, blocks),
    });
    const theirs = new MergePane(theirsEl, {
      doc: conflict.theirs,
      editable: false,
      language: conflict.language,
      blocks: sideBlocks(model, "theirs", {
        apply: t("applyRemote"),
        t: tr,
        chars: highlightMode === "chars",
        marks: highlightMode === "words" || highlightMode === "chars",
      }),
      wrap,
      whitespace: showWhitespace,
      onApplyBlock: (id) => applyRange(id, "theirs"),
      onIgnoreBlock: (id) => ignoreChange(id, "theirs"),
      actionLabels: { apply: t("acceptRight"), ignore: t("ignore") },
      onScroll: (line) => {
        sync("theirs", line);
        scheduleMeasure();
      },
      onSelection: (start, end, empty) => setSelected({ side: "theirs", start, end, empty }),
    });
    oursPane.current = ours;
    resultPane.current = result;
    theirsPane.current = theirs;
    // A file that was saved with some blocks still open starts with those
    // blocks' arrows; the closed ones keep their status dot.
    refreshDecorations();
    return () => {
      ours.destroy();
      result.destroy();
      theirs.destroy();
      oursPane.current = null;
      resultPane.current = null;
      theirsPane.current = null;
    };
    // The view is keyed by document id, so the panes are built once per file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict.path, initialText, model]);

  useEffect(() => {
    for (const pane of [oursPane.current, resultPane.current, theirsPane.current]) {
      pane?.setViewOptions({ wrap, whitespace: showWhitespace });
    }
  }, [wrap, showWhitespace]);

  useEffect(() => {
    const refresh = (pane: MergePane | null, side: "ours" | "theirs") => {
      if (!pane) return;
      const lines = side === "ours" ? model.oursLines : model.theirsLines;
      const offsets = lineOffsets(lines);
      pane.setBlocks(
        pane.getBlocks().map((block) => {
          const range = model.ranges.find((r) => r.index === block.id);
          const marked = highlightMode === "words" || highlightMode === "chars";
          return range
            ? {
                ...block,
                marks:
                  marked && range.kind === "conflict"
                    ? conflictMarks(range, side, offsets, highlightMode === "chars")
                    : [],
              }
            : block;
        }),
      );
    };
    refresh(oursPane.current, "ours");
    refresh(theirsPane.current, "theirs");
    // The panes are rebuilt separately when the model changes; this only
    // refreshes the marks and must preserve their resolved/apply state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMode]);

  useEffect(() => {
    for (const pane of [oursPane.current, resultPane.current, theirsPane.current]) {
      pane?.setCollapsed(collapsed);
    }
  }, [collapsed, model]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      for (const pane of [oursPane.current, resultPane.current, theirsPane.current]) {
        pane?.requestMeasure();
      }
      const first = model.ranges.find((range) => range.kind === "conflict") ?? model.ranges[0];
      if (first && !scrolledToFirst.current) {
        scrolledToFirst.current = true;
        scrollToRange(first);
      }
    });
    return () => cancelAnimationFrame(frame);
    // The panes are created once; remeasure when the tab appears or the
    // three-way model is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, model]);


  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F7") {
        event.preventDefault();
        jump(event.shiftKey ? -1 : 1);
      } else if (event.altKey && event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();
        jump(-1);
      } else if (event.altKey && event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();
        jump(1);
      } else if ((event.metaKey && event.ctrlKey) || (event.ctrlKey && event.altKey)) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const range = rangeAtCaret();
        if (range?.kind === "conflict") applyRange(range.index, event.key === "ArrowRight" ? "ours" : "theirs");
      } else if (event.altKey && !event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        const range = rangeAtCaret();
        if (range?.kind === "conflict") applyRange(range.index, "ours");
      } else if (event.altKey && !event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        const range = rangeAtCaret();
        if (range?.kind === "conflict") applyRange(range.index, "theirs");
      } else if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.defaultPrevented) {
        // The editor owns the keys while it has focus; everywhere else in the
        // window (a gutter arrow, a toolbar button) Undo must still mean the
        // decision journal.
        const key = event.key.toLowerCase();
        if (key !== "z" && key !== "y") return;
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyRange, jump, rangeAtCaret, redo, undo]);

  const versionText = (key: VersionKey) => {
    if (key === "base") return conflict.base;
    if (key === "ours") return conflict.ours;
    if (key === "theirs") return conflict.theirs;
    return resultText;
  };
  const versionLabel = (key: VersionKey) =>
    key === "base" ? t("base") : key === "ours" ? t("local") : key === "theirs" ? t("remote") : t("result");

  // A binary file, a link, a submodule, or a path one side deleted has no
  // three-way text to merge: whatever the editor wrote would be a new file
  // git never recorded (and writing through a link changes its target). The
  // only honest resolutions are the two sides.
  if (needsSideChoice(conflict)) {
    const note = conflict.binary
      ? t("binaryConflict")
      : conflict.kind === "symlink"
        ? t("linkConflict")
        : conflict.kind === "submodule"
          ? t("submoduleConflict")
          : !conflict.hasOurs && !conflict.hasTheirs
            ? t("bothDeletedConflict")
            : t("deleteConflict");
    const explain = conflict.binary
      ? t("noEditableText")
      : conflict.kind !== "file"
        ? t("noEditableText")
        : !conflict.hasOurs && !conflict.hasTheirs
          ? t("bothDeleted")
          : !conflict.hasOurs
            ? t("oursDeleted")
            : t("theirsDeleted");
    const preview = (text: string, label: string) => (
      <div className="merge3-choice-side">
        <div className="merge3-choice-head">{label}</div>
        <pre className="merge3-choice-text">{text}</pre>
      </div>
    );
    return (
      <div className="conflict-view merge3-view">
        <header className="diff-header">
          <div className="diff-title-row">
            <span className="diff-status st-conflict">!</span>
            <span className="diff-path">{path}</span>
            <span className="spacer" />
            <IconButton icon="close" title={t("close")} small onClick={requestClose} />
          </div>
        </header>
        <div className="merge3-choice">
          <div className="merge3-choice-note">
            <Icon name="warning" size={16} />
            <span>{note}</span>
          </div>
          <div className="merge3-choice-explain">{explain}</div>
          <div className="merge3-choice-sides">
            {conflict.hasOurs &&
              !conflict.binary &&
              preview(conflict.ours, t("fromChanges", { name: labels.ours || t("local") }))}
            {conflict.hasTheirs &&
              !conflict.binary &&
              preview(conflict.theirs, t("fromChanges", { name: labels.theirs || t("remote") }))}
          </div>
        </div>
        <footer className="merge3-footer">
          <span className="spacer" />
          <Button size="small" onClick={() => onTakeSide("ours")} disabled={busy}>
            {t("acceptLeft")}
          </Button>
          <Button size="small" onClick={() => onTakeSide("theirs")} disabled={busy}>
            {t("acceptRight")}
          </Button>
          <Button size="small" onClick={requestClose}>
            {t("cancel")}
          </Button>
        </footer>
      </div>
    );
  }

  const nonConflict = ranges.length - conflicts.length;
  const changesText =
    nonConflict === 0
      ? t("noChangesMade")
      : count(nonConflict, t("changesOne", { n: nonConflict }), t("changesOther", { n: nonConflict }));
  // The counter reports what the file holds, the way the IDE's does: a
  // conflict is a range both sides changed, decided or not.
  const conflictsText = count(conflicts.length, t("conflictOne", { n: conflicts.length }), t("conflictOther", { n: conflicts.length }));
  const when = (time: number) =>
    time > 0 ? new Date(time * 1000).toLocaleString() : "";

  const detailsCard = (side: "ours" | "theirs", name: string) => {
    const info = details ? (side === "ours" ? details.ours : details.theirs) : null;
    return (
      <div className="merge3-details-pop">
        <div className="merge3-details-head">
          <span>{t("fromChanges", { name })}</span>
          <IconButton icon="close" title={t("close")} small onClick={() => setDetailsSide(null)} />
        </div>
        {info && info.hash ? (
          <div className="merge3-details-body">
            <div className="merge3-details-subject">{info.subject || info.short}</div>
            <div className="merge3-details-meta">
              <Icon name="user" size={12} /> {info.author}
            </div>
            <div className="merge3-details-meta">
              <Icon name="clock" size={12} /> {when(info.time)}
            </div>
            <div className="merge3-details-meta">
              <Icon name="hash" size={12} /> {info.short}
              {info.branch ? ` · ${info.branch}` : ""}
            </div>
          </div>
        ) : (
          <div className="merge3-details-empty">{t("detailsUnavailable")}</div>
        )}
      </div>
    );
  };

  return (
    <div className="conflict-view merge3-view">
      <header className="diff-header merge3-header">
        <div className="diff-toolbar merge3-toolbar">
          <IconButton icon="chevronUp" title={t("previous")} small onClick={() => jump(-1)} />
          <IconButton icon="chevronDown" title={t("next")} small onClick={() => jump(1)} />
          <span className="diff-nav-count">
            {ranges.length === 0 ? "0 / 0" : `${Math.min(current + 1, ranges.length)} / ${ranges.length}`}
          </span>
          <IconButton icon="diff" title={t("compareContents")} small onClick={openCompareMenu} />
          <IconButton
            icon="collapse"
            title={t("collapseUnchanged")}
            small
            onClick={() => setCollapsed((v) => !v)}
          />
          <span className="toolbar-sep" />
          <span className="merge3-apply-label">{t("applyNonConflicts")}</span>
          <button
            type="button"
            className="merge3-apply-btn"
            disabled={!applyable.ours}
            title={t("applyNonConflicts")}
            onClick={() => applyNonConflicted("ours")}
          >
            » {t("left")}
          </button>
          <button
            type="button"
            className="merge3-apply-btn"
            disabled={!applyable.base}
            title={t("applyNonConflicts")}
            onClick={() => applyNonConflicted("base")}
          >
            »« {t("all")}
          </button>
          <button
            type="button"
            className="merge3-apply-btn"
            disabled={!applyable.theirs}
            title={t("applyNonConflicts")}
            onClick={() => applyNonConflicted("theirs")}
          >
            « {t("right")}
          </button>
          <span className="toolbar-sep" />
          <IconButton
            icon="sparkle"
            title={t("resolveSimple")}
            small
            onClick={autoResolve}
            disabled={!wandable}
          />
          {onAutoMerge && (
            <IconButton
              icon="merge"
              title={t("autoMergeHint")}
              small
              onClick={onAutoMerge}
              disabled={busy}
            />
          )}
          <IconButton icon="undo" title={t("undo")} small onClick={undo} />
          <IconButton icon="redo" title={t("redo")} small onClick={redo} />
          <span className="spacer" />
          {busy && <Spinner />}
          <span className={cx("merge3-status", unresolved === 0 && "done")}>
            {changesText}, {conflictsText}
          </span>
          <IconButton icon="settings" title={t("viewOptions")} small onClick={openViewMenu} />
          <IconButton icon="close" title={t("close")} small onClick={requestClose} />
        </div>
      </header>

      <div className="merge3-panes" ref={panesRef}>
        <section className="merge3-pane">
          <div className="merge3-pane-head">
            <Icon name="ours" size={12} />
            <span className="merge3-pane-title">{t("fromChanges", { name: labels.ours || t("local") })}</span>
            <button type="button" className="merge3-details-link" onClick={() => setDetailsSide("ours")}>
              {t("showDetails")}
            </button>
          </div>
          {detailsSide === "ours" && detailsCard("ours", labels.ours || t("local"))}
          <div
            className="merge3-editor"
            ref={oursRef}
            onContextMenu={(event) => openPaneMenu(event, "ours")}
          />
        </section>
        <div className="merge3-ribbon" aria-hidden="true">
          <div className="merge3-ribbon-track" ref={leftRibbonRef}>
            <svg viewBox="0 0 100 1000" preserveAspectRatio="none">
              {links
                .filter((link) => link.side === "ours")
                .map((link) => (
                  <polygon
                    key={link.id}
                    className={cx("merge3-link", link.tone, link.id === current && "current")}
                    points={link.points}
                  />
                ))}
            </svg>
          </div>
        </div>
        <section className="merge3-pane result">
          <div className="merge3-pane-head">
            <span className="merge3-pane-title">{t("result")}</span>
            <span className="merge3-version" title={path}>
              {path}
            </span>
          </div>
          <div
            className="merge3-editor"
            ref={resultRef}
            onContextMenu={(event) => openPaneMenu(event, "result")}
          />
        </section>
        <div className="merge3-ribbon" aria-hidden="true">
          <div className="merge3-ribbon-track" ref={rightRibbonRef}>
            <svg viewBox="0 0 100 1000" preserveAspectRatio="none">
              {links
                .filter((link) => link.side === "theirs")
                .map((link) => (
                  <polygon
                    key={link.id}
                    className={cx("merge3-link", link.tone, link.id === current && "current")}
                    points={link.points}
                  />
                ))}
            </svg>
          </div>
        </div>
        <section className="merge3-pane">
          <div className="merge3-pane-head">
            <Icon name="theirs" size={12} />
            <span className="merge3-pane-title">{t("fromChanges", { name: labels.theirs || t("remote") })}</span>
            <button type="button" className="merge3-details-link" onClick={() => setDetailsSide("theirs")}>
              {t("showDetails")}
            </button>
          </div>
          {detailsSide === "theirs" && detailsCard("theirs", labels.theirs || t("remote"))}
          <div
            className="merge3-editor"
            ref={theirsRef}
            onContextMenu={(event) => openPaneMenu(event, "theirs")}
          />
        </section>
      </div>

      <footer className="merge3-footer">
        <span className={cx("merge3-status", unresolved === 0 && "done")}>
          {unresolved === 0 ? (
            <>
              <Icon name="check" size={12} /> {t("allResolved")}
            </>
          ) : (
            <>
              <Icon name="warning" size={12} /> {t("unresolved", { n: unresolved })}
            </>
          )}
        </span>
        <span className="spacer" />
        <Button size="small" onClick={() => applyWholeSide("ours")} disabled={busy || (!conflict.hasOurs && conflict.hasTheirs)}>
          {t("acceptLeft")}
        </Button>
        <Button size="small" onClick={() => applyWholeSide("theirs")} disabled={busy || (!conflict.hasTheirs && conflict.hasOurs)}>
          {t("acceptRight")}
        </Button>
        <Button size="small" onClick={() => requestSave(false, false)} disabled={busy}>
          {t("saveAndClose")}
        </Button>
        <Button
          size="small"
          variant="primary"
          onClick={() => requestSave(true, true)}
          disabled={!canApply}
          title={t("applyHint")}
        >
          {t("applyChanges")}
        </Button>
      </footer>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {pendingSave !== null && (
        <Modal
          title={t("applyAnywayTitle")}
          icon="warning"
          width={430}
          onClose={() => setPendingSave(null)}
          footer={
            <>
              <Button onClick={() => setPendingSave(null)} autoFocus>
                {t("backToResolve")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  saveRef.current(
                    withLineEnding(textForDisk(), endingRef.current),
                    pendingSave.stage,
                    pendingSave.advance,
                  );
                  setPendingSave(null);
                }}
              >
                {t("applyAnyway")}
              </Button>
            </>
          }
        >
          <div className="confirm-message">
            {count(unresolved, t("applyAnywayOne"), t("applyAnywayMessage", { n: unresolved }))}
          </div>
        </Modal>
      )}
      {pendingWhitespace !== null && (
        <Modal
          title={t("restartTitle")}
          icon="warning"
          width={430}
          onClose={() => setPendingWhitespace(null)}
          footer={
            <>
              <Button onClick={() => setPendingWhitespace(null)} autoFocus>
                {t("keepEditing")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setWhitespaceMode(pendingWhitespace);
                  setPendingWhitespace(null);
                }}
              >
                {t("restartMerge")}
              </Button>
            </>
          }
        >
          <div className="confirm-message">{t("restartMessage")}</div>
        </Modal>
      )}
      {confirmClose && (
        <Modal
          title={t("discardTitle")}
          icon="warning"
          width={430}
          onClose={() => setConfirmClose(false)}
          footer={
            <>
              <Button onClick={() => setConfirmClose(false)} autoFocus>
                {t("keepEditing")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmClose(false);
                  onClose();
                }}
              >
                {t("discardClose")}
              </Button>
            </>
          }
        >
          <div className="confirm-message">{t("discardMessage")}</div>
        </Modal>
      )}
      {compare && (
        <CompareVersions
          left={versionText(compare.left)}
          right={versionText(compare.right)}
          leftLabel={versionLabel(compare.left)}
          rightLabel={versionLabel(compare.right)}
          onClose={() => setCompare(null)}
        />
      )}
      {compareText && (
        <CompareVersions
          left={compareText.leftText}
          right={compareText.rightText}
          leftLabel={compareText.leftLabel}
          rightLabel={compareText.rightLabel}
          onClose={() => setCompareText(null)}
        />
      )}
    </div>
  );
}
