import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent, MergeDetails } from "./mygo";
import {
  buildMergeView,
  computeMerge,
  conflictLabels,
  diffHunks,
  ignoreRangeLines,
  insertConflictMarkers,
  resetRangeLines,
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
import { MergePane, type MergePaneBlock } from "./mergePane";
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
    applyAnywayOne: "1 conflict block is still open. The file is saved with Git's markers (<<<<<<<) around that block, so it stays unmerged.",
    applyAnywayMessage: "{n} conflict blocks are still open. The file is saved with Git's markers (<<<<<<<) around them, so it stays unmerged.",
    applyAnyway: "Save with Markers",
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
    applyAnywayOne: "仍有 1 个冲突块未解决。保存时会在该块两侧写入 Git 冲突标记（<<<<<<<），文件保持未合并状态。",
    applyAnywayMessage: "仍有 {n} 个冲突块未解决。保存时会在这些块两侧写入 Git 冲突标记（<<<<<<<），文件保持未合并状态。",
    applyAnyway: "写入标记并保存",
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

/** One block per model range: a conflict stays marked until it is decided,
 *  an auto-merged range is already settled. */
function resultBlocks(
  model: MergeModel,
  states: ReadonlyMap<number, RangeState>,
  view: MergeView,
  t: (key: string, vars?: Record<string, string | number>) => string,
): MergePaneBlock[] {
  return view.blocks.map((block) => {
    const range = model.ranges[block.index];
    const state = states.get(block.index);
    const resolved = state?.resolved ?? block.resolved;
    return {
      id: block.index,
      from: block.from,
      to: block.to,
      tone: resolved ? "resolved" : "conflict",
      revert: revertable(range, state),
      title: resolved ? (range ? rangeType(range, t) : t("resolvedBlock")) : t("conflictBlock"),
    } satisfies MergePaneBlock;
  });
}

interface RangeState {
  lines: string[];
  resolved: boolean;
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
  for (const state of states.values()) if (!state.resolved) count++;
  return count;
}

/** Whether "Revert change" would move the block: a resolved conflict reopens
 *  and a decided change goes back to the merge base. */
function revertable(range: MergeRange | undefined, state: RangeState | undefined): boolean {
  if (!range || !state) return false;
  return range.kind === "conflict" ? state.resolved : !sameLines(state.lines, range.base);
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
  // Every changed range is a block in the result: Git's marker sections only
  // decide which conflicts are still open, not how the result is laid out.
  // A file saved half-resolved reopens with the decided ranges settled and the
  // ranges still wrapped in markers open.
  const initial = useMemo(() => buildMergeView(model, rawWorking), [model, rawWorking]);
  const stateFromView = useMemo(
    () => new Map<number, RangeState>(initial.blocks.map((block) => [block.index, { lines: block.lines, resolved: block.resolved }])),
    [initial],
  );
  const initialText = initial.text;
  const [resultText, setResultText] = useState(initialText);
  const [unresolved, setUnresolved] = useState(initial.open.length);
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
  const [confirmClose, setConfirmClose] = useState(false);

  const oursRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
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
    setUnresolved(initial.open.length);
    setDirty(false);
  }, [initial, stateFromView]);
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  const ranges = model.ranges;
  const conflicts = ranges.filter((r) => r.kind === "conflict");
  const canApply = !busy && !conflict.binary;
  const markerLabels = useMemo<MergeLabels>(() => {
    const fromFile = conflictLabels(conflict.working) ?? {};
    return {
      ours: fromFile.ours?.trim() || labels.ours,
      theirs: fromFile.theirs?.trim() || labels.theirs,
    };
  }, [conflict.working, labels]);

  /** The file as Git must see it: open blocks keep their markers, so a partial
   *  save stays an unmerged file instead of a silently half-merged one. */
  const textForDisk = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return resultTextRef.current;
    const spans = pane
      .getBlocks()
      .map((block) => {
        const state = blocksRef.current.get(block.id);
        const range = model.ranges[block.id];
        return state && !state.resolved && range
          ? { from: block.from, to: block.to, theirs: range.theirs }
          : null;
      })
      .filter((span): span is { from: number; to: number; theirs: string[] } => span !== null);
    return spans.length === 0 ? pane.getDoc() : insertConflictMarkers(pane.getDoc(), spans, markerLabels);
  }, [markerLabels, model]);

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
      if (!state.resolved) pending.add(index);
    }
    const result = resultPane.current;
    if (result) {
      const blocks = result.getBlocks();
      const next = blocks.map((block) => {
        const state = blocksRef.current.get(block.id);
        const range = model.ranges[block.id];
        const resolved = state?.resolved ?? true;
        return {
          ...block,
          tone: resolved ? "resolved" : "conflict",
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
          if (range.kind !== "conflict") {
            return {
              ...block,
              apply: side,
              ignore: true,
              tone: side,
              title: `${t(side === "ours" ? "applyLocal" : "applyRemote")} · ${rangeType(range, tr)}`,
            };
          }
          const active = pending.has(block.id);
          // A decided block keeps only its status mark: choosing a side is the
          // decision, and Ctrl+Z is how that decision is undone.
          return {
            ...block,
            apply: active ? side : undefined,
            ignore: active,
            tone: active ? "conflict" : "resolved",
            title: active
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

  /** Settles one range on the given text. Ranges are the only block identity:
   *  the three panes and the marker writer all use the model's range index. */
  const resolveRange = useCallback(
    (index: number, lines: string[]) => {
      const pane = resultPane.current;
      const state = blocksRef.current.get(index);
      if (!pane || !state) return;
      // Accepting the side the result already shows is not a new decision;
      // an unresolved conflict still becomes decided even when its local text
      // is already what the pane holds.
      if (state.resolved && sameLines(state.lines, lines)) return;
      commitDecision([{ index, before: state, after: { lines, resolved: true } }]);
      // A one-sided change is a correction, not a decision to move on from:
      // only a conflict advances the caret to the next open block, the way
      // accepting a conflict advances the IDE.
      if (model.ranges[index]?.kind !== "conflict") return;
      // The next decision is what the reader wants next: the caret moves to the
      // following open block.
      const open = [...blocksRef.current.entries()]
        .filter(([, candidate]) => !candidate.resolved)
        .map(([id]) => id)
        .sort((a, b) => a - b);
      const after = open.find((candidate) => candidate > index) ?? open[0];
      if (after === undefined) {
        setCurrent(index);
        return;
      }
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

  /** Accept a side: the range becomes exactly that revision's text. This works
   *  for a one-sided change too, so an auto-merged change can be replaced by
   *  the other side's text, the way IDEA's gutter accept does. */
  const applyRange = useCallback(
    (index: number, side: "ours" | "theirs") => {
      const range = model.ranges[index];
      if (!range) return;
      resolveRange(index, side === "ours" ? range.ours : range.theirs);
    },
    [model, resolveRange],
  );

  /** Ignore a side: drop that side's change, keeping the other side or the
   *  base when the other side did not touch the range. */
  const ignoreRange = useCallback(
    (index: number, side: "ours" | "theirs") => {
      const range = model.ranges[index];
      if (!range) return;
      resolveRange(index, ignoreRangeLines(range, side));
    },
    [model, resolveRange],
  );

  /** IDEA's per-change Reset/Revert: a resolved conflict reopens, a decided
   *  change goes back to the merge base. */
  const resetRange = useCallback(
    (index: number) => {
      const range = model.ranges[index];
      const state = blocksRef.current.get(index);
      if (!range || !state) return;
      const reset = resetRangeLines(range);
      if (state.resolved === reset.resolved && sameLines(state.lines, reset.lines)) return;
      commitDecision([{ index, before: state, after: reset }]);
    },
    [commitDecision, model],
  );

  /** Resolve one conflict with the line attribution the wand uses. */
  const autoResolveOne = useCallback(
    (index: number) => {
      const range = model.ranges[index];
      const state = blocksRef.current.get(index);
      if (!range || !state || state.resolved) return;
      const lines = tryResolveRange(range) ?? tryResolveRange(range, true);
      if (!lines) return;
      resolveRange(index, lines);
    },
    [model, resolveRange],
  );

  const autoResolve = useCallback(() => {
    const changes: BlockChange[] = [];
    for (const [index, state] of blocksRef.current) {
      if (state.resolved) continue;
      const range = ranges[index];
      if (!range) continue;
      const resolved = tryResolveRange(range) ?? tryResolveRange(range, true);
      if (!resolved) continue;
      changes.push({ index, before: state, after: { lines: resolved, resolved: true } });
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
            { label: t("ignoreNone"), checked: whitespaceMode === "none", onClick: () => setWhitespaceMode("none") },
            { label: t("ignoreTrim"), checked: whitespaceMode === "trim", onClick: () => setWhitespaceMode("trim") },
            { label: t("ignoreSpaces"), checked: whitespaceMode === "spaces", onClick: () => setWhitespaceMode("spaces") },
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
      for (const [index, state] of blocksRef.current) afterStates.set(index, { ...state, lines: [], resolved: true });
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
    const resolvable = conflictTarget
      ? tryResolveRange(conflictTarget) ?? tryResolveRange(conflictTarget, true)
      : null;
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
        disabled: !conflictTarget || state?.resolved === true || resolvable === null,
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
          if (sideTarget) ignoreRange(sideTarget.index, side);
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
          next.set(block.id, { lines, resolved: true });
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
      onIgnoreBlock: (id) => ignoreRange(id, "ours"),
      actionLabels: { apply: t("acceptLeft"), ignore: t("ignore") },
      side: "after",
      onScroll: (line) => sync("ours", line),
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
      onScroll: (line) => sync("result", line),
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
      onIgnoreBlock: (id) => ignoreRange(id, "theirs"),
      actionLabels: { apply: t("acceptRight"), ignore: t("ignore") },
      onScroll: (line) => sync("theirs", line),
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

  if (conflict.binary) {
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
        <div className="diff-empty">
          <Icon name="warning" size={24} />
          <div>{t("binaryConflict")}</div>
        </div>
        <footer className="merge3-footer">
          <span className="spacer" />
          <Button size="small" onClick={() => onTakeSide("ours")} disabled={busy || (!conflict.hasOurs && !conflict.hasTheirs)}>
            {t("acceptLeft")}
          </Button>
          <Button size="small" onClick={() => onTakeSide("theirs")} disabled={busy || (!conflict.hasTheirs && !conflict.hasOurs)}>
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
  const conflictsText = count(unresolved, t("conflictOne", { n: unresolved }), t("conflictOther", { n: unresolved }));
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
          <IconButton
            icon="sparkle"
            title={t("resolveSimple")}
            small
            onClick={autoResolve}
            disabled={unresolved === 0}
          />
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

      <div className="merge3-panes">
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
