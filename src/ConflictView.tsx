import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent, MergeDetails } from "./mygo";
import {
  composeSegments,
  computeMerge,
  conflictLabels,
  conflictSegments,
  diffHunks,
  ignoreSide,
  initialConflictBlocks,
  insertConflictMarkers,
  modelSegments,
  splitLines,
  tryResolveRange,
  type ConflictBlockState,
  type ConflictSegment,
  type MergeLabels,
  type MergeModel,
  type MergeRange,
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
    autoResolvable: "{n} auto-resolvable",
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
    highlightLines: "Lines",
    highlightWords: "Words",
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
    autoResolvable: "{n} 个可自动解决",
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
    highlightLines: "行数",
    highlightWords: "单词",
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
    const changed = side === "ours" ? range.oursChanged : range.theirsChanged;
    if (!changed && range.kind !== "conflict") continue;
    const start = side === "ours" ? range.oursStart : range.theirsStart;
    const end = side === "ours" ? range.oursEnd : range.theirsEnd;
    blocks.push({
      id: range.index,
      from: offsetAt(offsets, start),
      to: offsetAt(offsets, end),
      tone: range.kind === "conflict" ? "conflict" : side,
      apply: side,
      ignore: true,
      marks: labels.marks ? conflictMarks(range, side, offsets, labels.chars) : [],
      title: `${labels.apply} · ${rangeType(range, labels.t)}`,
    });
  }
  return blocks;
}

/** One block per conflict section, at its offsets in the composed result. */
function resultBlocks(
  model: MergeModel,
  blocks: ReadonlyMap<number, ConflictBlockState>,
  spans: { id: number; from: number; to: number }[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): MergePaneBlock[] {
  return spans.map((span) => {
    const state = blocks.get(span.id);
    const range =
      state?.rangeIndex != null ? model.ranges.find((r) => r.index === state.rangeIndex) : undefined;
    const resolved = state?.resolved === true;
    return {
      id: span.id,
      from: span.from,
      to: span.to,
      tone: resolved ? "resolved" : "conflict",
      title: resolved ? (range ? rangeType(range, t) : t("resolvedBlock")) : t("conflictBlock"),
    } satisfies MergePaneBlock;
  });
}

function countUnresolved(blocks: ReadonlyMap<number, ConflictBlockState>): number {
  let count = 0;
  for (const state of blocks.values()) if (!state.resolved) count++;
  return count;
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
  onSave: (content: string, stage: boolean) => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onClose: () => void;
  onShowHistory?: (line: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
  visible?: boolean;
}) {
  const t = useT(T);
  const tr = (key: string) => t(key as Parameters<typeof t>[0]);
  const [whitespaceMode, setWhitespaceMode] = useState<WhitespaceMode>("none");
  const [highlightLines, setHighlightLines] = useState(false);
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
  // The result is the working file itself, minus Git's marker lines: plain text
  // stays exactly as it is, and each section becomes a block that carries the
  // decision. That is why a partially saved file reopens with the blocks that
  // are still open and nothing else.
  const initial = useMemo(() => {
    const parsed = conflictSegments(rawWorking);
    const segments =
      parsed && parsed.some((segment) => segment.kind === "conflict") ? parsed : modelSegments(model);
    const blocks = initialConflictBlocks(segments, model);
    const composed = composeSegments(segments, blocks);
    return { segments, blocks, text: composed.text, spans: composed.spans };
  }, [model, rawWorking]);
  const initialText = initial.text;
  const [resultText, setResultText] = useState(initialText);
  const [unresolved, setUnresolved] = useState(() => countUnresolved(initial.blocks));
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
  const [pendingSave, setPendingSave] = useState<{ stage: boolean } | null>(null);

  const oursRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const oursPane = useRef<MergePane | null>(null);
  const resultPane = useRef<MergePane | null>(null);
  const theirsPane = useRef<MergePane | null>(null);
  const initialRef = useRef(initialText);
  const resultTextRef = useRef(initialText);
  const blocksRef = useRef(initial.blocks);
  const anchorCache = useRef<{ text: string; ours: SyncAnchor[]; theirs: SyncAnchor[] } | null>(null);
  const lock = useRef(0);
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;
  const requestSaveRef = useRef<(stage: boolean) => void>(() => {});
  const scrolledToFirst = useRef(false);

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
    blocksRef.current = initial.blocks;
    anchorCache.current = null;
    setResultText(initial.text);
    setUnresolved(countUnresolved(initial.blocks));
    setDirty(false);
  }, [initial]);
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
        return state && !state.resolved
          ? { from: block.from, to: block.to, theirs: state.theirs }
          : null;
      })
      .filter((span): span is { from: number; to: number; theirs: string[] } => span !== null);
    return spans.length === 0 ? pane.getDoc() : insertConflictMarkers(pane.getDoc(), spans, markerLabels);
  }, [markerLabels]);

  const requestSave = useCallback(
    (stage: boolean) => {
      if (busyRef.current || conflict.binary) return;
      if (countUnresolved(blocksRef.current) > 0) setPendingSave({ stage: false });
      else saveRef.current(withLineEnding(resultTextRef.current, endingRef.current), stage);
    },
    [conflict.binary],
  );
  requestSaveRef.current = requestSave;

  const scrollToRange = useCallback((range: MergeRange) => {
    oursPane.current?.scrollToLine(range.oursStart + 1);
    theirsPane.current?.scrollToLine(range.theirsStart + 1);
    const pane = resultPane.current;
    if (!pane) return;
    const block = pane
      .getBlocks()
      .find((candidate) => blocksRef.current.get(candidate.id)?.rangeIndex === range.index);
    if (!block) return;
    const doc = pane.view.state.doc;
    pane.scrollToLine(doc.lineAt(Math.max(0, Math.min(block.from, doc.length))).number);
  }, []);

  const jump = useCallback(
    (delta: number) => {
      if (ranges.length === 0) return;
      const next = Math.max(0, Math.min(ranges.length - 1, current + delta));
      setCurrent(next);
      const range = ranges[next];
      if (range) scrollToRange(range);
    },
    [current, ranges, scrollToRange],
  );

  /** Settles one block on a side's text; the block, not the marker text, is
   *  what "resolved" means. */
  const resolveBlock = useCallback((id: number, lines: string[]) => {
    const pane = resultPane.current;
    const state = blocksRef.current.get(id);
    if (!pane || !state) return;
    blocksRef.current = new Map(blocksRef.current).set(id, { ...state, lines, resolved: true });
    pane.replaceBlock(id, lines.join("\n"));
    // The next decision is what the reader wants next: the caret moves to the
    // following open block, the way accepting a conflict advances the IDE.
    const open = [...blocksRef.current.values()]
      .filter((candidate) => !candidate.resolved)
      .sort((a, b) => a.id - b.id);
    const after = open.find((candidate) => candidate.id > id) ?? open[0];
    if (!after) {
      if (state.rangeIndex != null) setCurrent(state.rangeIndex);
      return;
    }
    if (after.rangeIndex != null) setCurrent(after.rangeIndex);
    const block = pane.getBlocks().find((candidate) => candidate.id === after.id);
    if (!block) return;
    const doc = pane.view.state.doc;
    const at = Math.min(block.from, doc.length);
    pane.view.dispatch({ selection: { anchor: at } });
    pane.scrollToLine(doc.lineAt(at).number);
  }, []);

  /** A block's side text and its link to the model come from the section, not
   *  from a range index that a partial save may have shifted. */
  const applyRange = useCallback(
    (id: number, side: "ours" | "theirs") => {
      const state = blocksRef.current.get(id);
      if (!state) return;
      resolveBlock(id, side === "ours" ? state.ours : state.theirs);
    },
    [resolveBlock],
  );

  const autoResolve = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return;
    const next = new Map(blocksRef.current);
    const changes: { id: number; text: string }[] = [];
    for (const state of next.values()) {
      if (state.resolved || state.rangeIndex == null) continue;
      const range = ranges.find((candidate) => candidate.index === state.rangeIndex);
      if (!range) continue;
      const resolved = tryResolveRange(range) ?? tryResolveRange(range, true);
      if (!resolved) continue;
      next.set(state.id, { ...state, lines: resolved, resolved: true });
      changes.push({ id: state.id, text: resolved.join("\n") });
    }
    if (changes.length === 0) return;
    blocksRef.current = next;
    pane.replaceBlocks(changes);
  }, [ranges]);

  const selectedRanges = selected && !selected.empty
    ? ranges.filter((range) => {
        const start = (selected.side === "ours" ? range.oursStart : range.theirsStart) + 1;
        const end = Math.max(start, selected.side === "ours" ? range.oursEnd : range.theirsEnd);
        return selected.start <= end && selected.end >= start;
      })
    : [];

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
            { label: t("highlightLines"), checked: highlightLines, onClick: () => setHighlightLines(true) },
            { label: t("highlightWords"), checked: !highlightLines, onClick: () => setHighlightLines(false) },
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

  /** "Ignore" on a side keeps the other side; a block that is already
   *  settled differently keeps its decision. */
  const ignoreBlock = useCallback(
    (id: number, side: "ours" | "theirs") => {
      const state = blocksRef.current.get(id);
      if (!state) return;
      resolveBlock(id, ignoreSide(state, side));
    },
    [resolveBlock],
  );

  /** "Resolve Using Left/Right": the whole result becomes that revision. */
  const applyWholeSide = useCallback(
    (side: "ours" | "theirs") => {
      const pane = resultPane.current;
      if (!pane) return;
      const text = normalizeText(side === "ours" ? conflict.ours : conflict.theirs);
      pane.replaceAll(text);
      pane.setBlocks([]);
      const next = new Map(blocksRef.current);
      for (const state of next.values()) next.set(state.id, { ...state, lines: [], resolved: true });
      blocksRef.current = next;
      anchorCache.current = null;
      resultTextRef.current = text;
      setResultText(text);
      setUnresolved(0);
      setDirty(true);
    },
    [conflict.ours, conflict.theirs],
  );

  /** The side panes and menus speak range indexes; the result speaks block ids. */
  const applyConflict = useCallback(
    (rangeIndex: number, side: "ours" | "theirs") => {
      for (const state of blocksRef.current.values()) {
        if (state.rangeIndex === rangeIndex) {
          applyRange(state.id, side);
          return;
        }
      }
    },
    [applyRange],
  );

  const ignoreConflict = useCallback(
    (rangeIndex: number, side: "ours" | "theirs") => {
      for (const state of blocksRef.current.values()) {
        if (state.rangeIndex === rangeIndex) {
          ignoreBlock(state.id, side);
          return;
        }
      }
    },
    [ignoreBlock],
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
    const target = conflictAtCaret();
    const items: ContextItem[] = [];
    if (side === "result") {
      items.push({
        label: t("acceptLeft"),
        shortcut: "⌘⌃→",
        icon: "ours",
        onClick: () => target && applyConflict(target.index, "ours"),
      });
      items.push({
        label: t("acceptRight"),
        shortcut: "⌘⌃←",
        icon: "theirs",
        onClick: () => target && applyConflict(target.index, "theirs"),
      });
      items.push({ separator: true });
      items.push({ label: t("resolveUsingLocal"), icon: "ours", onClick: () => applyWholeSide("ours") });
      items.push({ label: t("resolveUsingRemote"), icon: "theirs", onClick: () => applyWholeSide("theirs") });
    } else {
      items.push({
        label: t("accept"),
        shortcut: side === "ours" ? "⌘⌃→" : "⌘⌃←",
        icon: side,
        onClick: () => {
          const range = selectedRanges[0] ?? ranges[current];
          if (range) applyConflict(range.index, side);
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
        disabled: selectedRanges.length === 0,
        onClick: () => {
          const first = selectedRanges[0];
          if (first) ignoreConflict(first.index, side);
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
      const line = conflictAtCaret()?.oursStart ?? 0;
      items.push({
        label: t("annotateBlame"),
        icon: "clock",
        onClick: () => onShowHistory(side === "ours" ? (conflictAtCaret()?.oursStart ?? 0) + 1 : line + 1),
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
      const next = new Map(blocksRef.current);
      const tones: MergePaneBlock[] = [];
      let changed = false;
      for (const block of blocks) {
        const state = next.get(block.id);
        if (!state) {
          tones.push(block);
          continue;
        }
        const lines = blockLines(doc, block);
        if (!sameLines(state.lines, lines)) {
          next.set(block.id, { ...state, lines, resolved: true });
          changed = true;
        }
        const settled = next.get(block.id)!;
        const range =
          settled.rangeIndex != null
            ? model.ranges.find((candidate) => candidate.index === settled.rangeIndex)
            : undefined;
        tones.push({
          ...block,
          tone: settled.resolved ? "resolved" : "conflict",
          title: settled.resolved ? (range ? rangeType(range, tr) : t("resolvedBlock")) : t("conflictBlock"),
        });
      }
      if (changed) blocksRef.current = next;
      if (tones.some((block, i) => block.tone !== blocks[i]?.tone || block.title !== blocks[i]?.title)) {
        resultPane.current?.setBlocks(tones);
      }
      const pending = new Set<number>();
      for (const state of next.values()) {
        if (!state.resolved && state.rangeIndex != null) pending.add(state.rangeIndex);
      }
      for (const [pane, side] of [
        [oursPane.current, "ours"],
        [theirsPane.current, "theirs"],
      ] as const) {
        if (!pane) continue;
        pane.setBlocks(
          pane.getBlocks().map((block) => {
            const range = model.ranges.find((candidate) => candidate.index === block.id);
            if (range?.kind !== "conflict") return block;
            const active = pending.has(range.index);
            return {
              ...block,
              apply: active ? side : undefined,
              tone: active ? "conflict" : "resolved",
              title: active
                ? `${t(side === "ours" ? "applyLocal" : "applyRemote")} · ${rangeType(range, tr)}`
                : rangeType(range, tr),
            };
          }),
        );
      }
      setUnresolved(countUnresolved(next));
      setDirty(doc !== initialRef.current);
    },
    [model, t, tr],
  );
  const changeRef = useRef(onResultChange);
  changeRef.current = onResultChange;

  const syncSidePanes = useCallback(() => {
    const pending = new Set<number>();
    for (const state of blocksRef.current.values()) {
      if (!state.resolved && state.rangeIndex != null) pending.add(state.rangeIndex);
    }
    for (const [pane, side] of [
      [oursPane.current, "ours"],
      [theirsPane.current, "theirs"],
    ] as const) {
      if (!pane) continue;
      pane.setBlocks(
        pane.getBlocks().map((block) => {
          const range = model.ranges.find((candidate) => candidate.index === block.id);
          if (range?.kind !== "conflict") return block;
          const active = pending.has(range.index);
          return {
            ...block,
            apply: active ? side : undefined,
            tone: active ? "conflict" : "resolved",
            title: active
              ? `${t(side === "ours" ? "applyLocal" : "applyRemote")} · ${rangeType(range, tr)}`
              : rangeType(range, tr),
          };
        }),
      );
    }
  }, [model, t, tr]);

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
      blocks: sideBlocks(model, "ours", { apply: t("applyLocal"), t: tr, chars: false, marks: !highlightLines }),
      wrap,
      whitespace: showWhitespace,
      onApplyBlock: (id) => applyConflict(id, "ours"),
      onIgnoreBlock: (id) => ignoreConflict(id, "ours"),
      actionLabels: { apply: t("acceptLeft"), ignore: t("ignore") },
      side: "after",
      onScroll: (line) => sync("ours", line),
      onSelection: (start, end, empty) => setSelected({ side: "ours", start, end, empty }),
    });
    const result = new MergePane(resultEl, {
      doc: initialText,
      editable: true,
      language: conflict.language,
      blocks: resultBlocks(model, blocksRef.current, initial.spans, tr),
      wrap,
      whitespace: showWhitespace,
      onScroll: (line) => sync("result", line),
      onSaveRequest: () => requestSaveRef.current(true),
      onChange: (doc, blocks) => changeRef.current(doc, blocks),
    });
    const theirs = new MergePane(theirsEl, {
      doc: conflict.theirs,
      editable: false,
      language: conflict.language,
      blocks: sideBlocks(model, "theirs", { apply: t("applyRemote"), t: tr, chars: false, marks: !highlightLines }),
      wrap,
      whitespace: showWhitespace,
      onApplyBlock: (id) => applyConflict(id, "theirs"),
      onIgnoreBlock: (id) => ignoreConflict(id, "theirs"),
      actionLabels: { apply: t("acceptRight"), ignore: t("ignore") },
      onScroll: (line) => sync("theirs", line),
      onSelection: (start, end, empty) => setSelected({ side: "theirs", start, end, empty }),
    });
    oursPane.current = ours;
    resultPane.current = result;
    theirsPane.current = theirs;
    // A file that was saved with some blocks still open starts with those
    // blocks' arrows; the closed ones keep their status dot.
    syncSidePanes();
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
          return range
            ? { ...block, marks: highlightLines ? [] : conflictMarks(range, side, offsets, false) }
            : block;
        }),
      );
    };
    refresh(oursPane.current, "ours");
    refresh(theirsPane.current, "theirs");
    // The panes are rebuilt separately when the model changes; this only
    // refreshes the marks and must preserve their resolved/apply state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightLines]);

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

  const conflictAtCaret = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return conflicts.find((range) => range.index === current) ?? conflicts[0];
    const line = pane.caretLine();
    const doc = pane.view.state.doc;
    for (const block of pane.getBlocks()) {
      const blockState = blocksRef.current.get(block.id);
      const range =
        blockState?.rangeIndex != null
          ? conflicts.find((r) => r.index === blockState.rangeIndex)
          : undefined;
      if (!range) continue;
      const first = doc.lineAt(Math.max(0, Math.min(block.from, doc.length))).number;
      const last = doc.lineAt(Math.max(0, Math.min(block.to > block.from ? block.to - 1 : block.from, doc.length))).number;
      if (line >= first && line <= last) return range;
    }
    return conflicts.find((range) => range.index === current) ?? conflicts[0];
  }, [conflicts, current]);

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
        const range = conflictAtCaret();
        if (range) applyConflict(range.index, event.key === "ArrowRight" ? "ours" : "theirs");
      } else if (event.altKey && !event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        const range = conflictAtCaret();
        if (range) applyConflict(range.index, "ours");
      } else if (event.altKey && !event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        const range = conflictAtCaret();
        if (range) applyConflict(range.index, "theirs");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyConflict, conflictAtCaret, jump]);

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
            <IconButton icon="close" title={t("close")} small onClick={onClose} />
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
          <Button size="small" onClick={onClose}>
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
          <IconButton icon="undo" title={t("undo")} small onClick={() => resultPane.current?.undo()} />
          <IconButton icon="redo" title={t("redo")} small onClick={() => resultPane.current?.redo()} />
          <span className="spacer" />
          {busy && <Spinner />}
          <span className={cx("merge3-status", unresolved === 0 && "done")}>
            {changesText}, {conflictsText}
          </span>
          <IconButton icon="settings" title={t("viewOptions")} small onClick={openViewMenu} />
          <IconButton icon="close" title={t("close")} small onClick={onClose} />
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
        <Button size="small" onClick={() => requestSave(false)} disabled={busy}>
          {t("saveAndClose")}
        </Button>
        <Button
          size="small"
          variant="primary"
          onClick={() => requestSave(true)}
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
                  saveRef.current(withLineEnding(textForDisk(), endingRef.current), pendingSave.stage);
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
