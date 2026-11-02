import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent } from "./mygo";
import {
  computeMerge,
  conflictLabels,
  chosenLines,
  countConflictMarkers,
  diffHunks,
  hasConflictMarkers,
  splitLines,
  tryResolveRange,
  type MergeLabels,
  type MergeModel,
  type MergeRange,
} from "./merge";
import { charDiff, wordDiff } from "./diff";
import { detectLineEnding, normalizeText, withLineEnding } from "./editorText";
import { MergePane, type MergePaneBlock } from "./mergePane";
import { Icon } from "./icons";
import {
  Button,
  ConfirmDialog,
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
    nonConflicts: "Apply non-conflicted changes",
    fromLocal: "From Local",
    fromRemote: "From Remote",
    fromBoth: "From Both",
    ignoreSelected: "Ignore selected side",
    copySelected: "Copy selected change",
    resetSelected: "Reset selected change",
    previousConflict: "Previous conflict",
    nextConflict: "Next conflict",
    charHighlights: "Character-level highlights",
    ignoreWhitespace: "Ignore whitespace",
    selectedActions: "Selected change actions",
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
    applyAnywayTitle: "Apply with conflicts",
    applyAnywayOne: "There is still 1 unresolved conflict.",
    applyAnywayMessage: "There are still {n} unresolved conflicts.",
    applyAnywayDetail: "The conflict markers will be saved and staged with the file. Continue?",
    applyAnyway: "Apply anyway",
    local: "Local Changes",
    remote: "Remote Changes",
    base: "Base",
    result: "Result",
    previous: "Previous change (Shift+F7)",
    next: "Next change (F7)",
    applyAllLocal: "Take local side for all conflicts",
    applyAllRemote: "Take remote side for all conflicts",
    applySelected: "Apply selected change",
    autoResolve: "Resolve simple conflicts",
    copyResult: "Copy result",
    cancel: "Cancel",
    acceptLeft: "Accept Left",
    acceptRight: "Accept Right",
    apply: "Apply",
    applyHint: "Save the result and stage the file",
    binaryConflict: "Binary conflict — choose a side",
    noChanges: "Contents are identical",
    changesOne: "{n} change",
    changesOther: "{n} changes",
    conflictOne: "{n} conflict",
    conflictOther: "{n} conflicts",
    allResolved: "All conflicts resolved",
    unresolved: "{n} unresolved",
    markersRemaining: "Unresolved markers will be saved if you apply",
    applyLocal: "Apply this local change",
    applyRemote: "Apply this remote change",
    conflictBlock: "Unresolved conflict",
    resolvedBlock: "Resolved conflict",
  },
  zh: {
    close: "关闭",
    typeInserted: "新增",
    typeDeleted: "删除",
    typeModified: "修改",
    typeConflict: "冲突",
    autoResolvable: "{n} 个可自动解决",
    nonConflicts: "应用非冲突更改",
    fromLocal: "来自本地",
    fromRemote: "来自远程",
    fromBoth: "来自两侧",
    ignoreSelected: "忽略选中侧",
    copySelected: "复制选中更改",
    resetSelected: "重置选中更改",
    previousConflict: "上一个冲突",
    nextConflict: "下一个冲突",
    charHighlights: "字符级高亮",
    ignoreWhitespace: "忽略空白差异",
    selectedActions: "选中更改操作",
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
    applyAnywayTitle: "仍有冲突",
    applyAnywayOne: "还有 1 个未解决的冲突。",
    applyAnywayMessage: "还有 {n} 个未解决的冲突。",
    applyAnywayDetail: "冲突标记会随文件一起保存并暂存。仍要继续吗？",
    applyAnyway: "仍要应用",
    local: "本地更改",
    remote: "远程更改",
    base: "Base",
    result: "结果",
    previous: "上一处变更（Shift+F7）",
    next: "下一处变更（F7）",
    applyAllLocal: "所有冲突采用本地",
    applyAllRemote: "所有冲突采用远程",
    applySelected: "应用选中更改",
    autoResolve: "自动解决简单冲突",
    copyResult: "复制结果",
    cancel: "取消",
    acceptLeft: "采用本地",
    acceptRight: "采用远程",
    apply: "应用",
    applyHint: "保存结果并将文件加入暂存区",
    binaryConflict: "二进制冲突 — 请选择一侧",
    noChanges: "内容一致",
    changesOne: "{n} 个变更",
    changesOther: "{n} 个变更",
    conflictOne: "{n} 个冲突",
    conflictOther: "{n} 个冲突",
    allResolved: "所有冲突已解决",
    unresolved: "{n} 个未解决",
    markersRemaining: "仍有冲突标记；应用时会二次确认",
    applyLocal: "应用这处本地更改",
    applyRemote: "应用这处远程更改",
    conflictBlock: "未解决的冲突",
    resolvedBlock: "已解决的冲突",
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

function conflictText(range: MergeRange, labels: MergeLabels): string {
  return [
    `<<<<<<< ${labels.ours}`,
    ...range.ours,
    "=======",
    ...range.theirs,
    `>>>>>>> ${labels.theirs}`,
  ].join("\n");
}

function sideBlocks(
  model: MergeModel,
  side: "ours" | "theirs",
  labels: { apply: string; t: (key: string) => string; chars: boolean },
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
      marks: conflictMarks(range, side, offsets, labels.chars),
      title: `${labels.apply} · ${rangeType(range, labels.t)}`,
    });
  }
  return blocks;
}

function resultBlocks(
  model: MergeModel,
  text: string,
  labels: { t: (key: string) => string },
): MergePaneBlock[] {
  if (text !== model.result) return [];
  const offsets = lineOffsets(text.split("\n"));
  const blocks: MergePaneBlock[] = [];
  for (const range of model.ranges) {
    const placement = model.placements.find((p) => p.rangeIndex === range.index);
    if (!placement) continue;
    const tone: MergePaneBlock["tone"] =
      range.kind === "conflict"
        ? "conflict"
        : range.oursChanged && range.theirsChanged
          ? "resolved"
          : range.oursChanged
            ? "ours"
            : "theirs";
    blocks.push({
      id: range.index,
      from: offsetAt(offsets, placement.startLine),
      to: offsetAt(offsets, placement.endLine),
      tone,
      title: rangeType(range, labels.t),
    });
  }
  return blocks;
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

function anchorsFor(model: MergeModel, side: "ours" | "theirs"): SyncAnchor[] {
  return model.ranges
    .map((range) => {
      const placement = model.placements.find((p) => p.rangeIndex === range.index);
      return placement
        ? {
            side: (side === "ours" ? range.oursStart : range.theirsStart) + 1,
            result: placement.startLine + 1,
          }
        : null;
    })
    .filter((a): a is SyncAnchor => a !== null)
    .sort((a, b) => a.side - b.side);
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
  busy,
  onSave,
  onTakeSide,
  onClose,
  onDirtyChange,
  visible = true,
}: {
  path: string;
  conflict: ConflictContent;
  busy: boolean;
  onSave: (content: string) => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  visible?: boolean;
}) {
  const t = useT(T);
  const tr = (key: string) => t(key as Parameters<typeof t>[0]);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const labels = useMemo(() => conflictLabels(conflict.working) ?? {}, [conflict.working]);
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
        ignoreWhitespace,
      }),
    [conflict.base, conflict.ours, conflict.theirs, labels, rawWorking, ignoreWhitespace],
  );
  const workingIsResolved = rawWorking !== "" && !hasConflictMarkers(rawWorking);
  const initialText = rawWorking !== "" && workingIsResolved ? rawWorking : model.result;
  const [resultText, setResultText] = useState(initialText);
  const [unresolved, setUnresolved] = useState(() => countConflictMarkers(initialText));
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
  const [charHighlights, setCharHighlights] = useState(false);
  const [confirmApply, setConfirmApply] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [compare, setCompare] = useState<{ left: VersionKey; right: VersionKey } | null>(null);

  const oursRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const oursPane = useRef<MergePane | null>(null);
  const resultPane = useRef<MergePane | null>(null);
  const theirsPane = useRef<MergePane | null>(null);
  const initialRef = useRef(initialText);
  const resultTextRef = useRef(initialText);
  const lock = useRef(0);
  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;
  const requestSaveRef = useRef<() => void>(() => {});
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
    initialRef.current = initialText;
    resultTextRef.current = initialText;
    setResultText(initialText);
    setUnresolved(countConflictMarkers(initialText));
    setDirty(false);
  }, [initialText]);
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  const ranges = model.ranges;
  const conflicts = ranges.filter((r) => r.kind === "conflict");
  const markersRemain = hasConflictMarkers(resultText);
  const canApply = !busy && !conflict.binary;
  const autoResolvableCount = conflicts.filter(
    (range) => tryResolveRange(range) !== null || tryResolveRange(range, true) !== null,
  ).length;

  const requestSave = useCallback(() => {
    if (busyRef.current || conflict.binary) return;
    const text = withLineEnding(resultTextRef.current, endingRef.current);
    if (hasConflictMarkers(resultTextRef.current)) setConfirmApply(text);
    else saveRef.current(text);
  }, [conflict.binary]);
  requestSaveRef.current = requestSave;

  const scrollToRange = useCallback((range: MergeRange) => {
    const placement = model.placements.find((p) => p.rangeIndex === range.index);
    oursPane.current?.scrollToLine(range.oursStart + 1);
    theirsPane.current?.scrollToLine(range.theirsStart + 1);
    if (placement) resultPane.current?.scrollToLine(placement.startLine + 1);
  }, [model]);

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

  const jumpConflict = useCallback(
    (delta: number) => {
      if (conflicts.length === 0) return;
      const at = conflicts.findIndex((range) => range.index === current);
      const next =
        at === -1
          ? delta > 0
            ? 0
            : conflicts.length - 1
          : (at + delta + conflicts.length) % conflicts.length;
      const range = conflicts[next];
      if (range) {
        setCurrent(range.index);
        scrollToRange(range);
      }
    },
    [conflicts, current, scrollToRange],
  );

  const pendingConflict = useCallback((id: number) => {
    const pane = resultPane.current;
    const block = pane?.getBlocks().find((b) => b.id === id);
    if (!pane || !block) return false;
    const doc = pane.getDoc();
    const from = Math.max(0, Math.min(block.from, doc.length));
    const to = Math.max(from, Math.min(block.to, doc.length));
    return doc.slice(from, to).includes("<<<<<<<");
  }, []);

  const applyRange = useCallback(
    (id: number, side: "ours" | "theirs") => {
      const range = ranges.find((r) => r.index === id);
      if (!range) return;
      const lines = side === "ours" ? range.ours : range.theirs;
      resultPane.current?.replaceBlock(id, lines.join("\n"));
      setCurrent(id);
    },
    [ranges],
  );

  const applyAll = useCallback(
    (side: "ours" | "theirs") => {
      const pane = resultPane.current;
      if (!pane) return;
      const changes = conflicts
        .filter((range) => pendingConflict(range.index))
        .map((range) => ({
          id: range.index,
          text: (side === "ours" ? range.ours : range.theirs).join("\n"),
        }));
      pane.replaceBlocks(changes);
    },
    [conflicts, pendingConflict],
  );

  const applyNonConflicts = useCallback(
    (mode: "ours" | "theirs" | "all") => {
      const pane = resultPane.current;
      if (!pane) return;
      const targets = ranges.filter((range) => {
        if (range.kind === "conflict") return false;
        if (mode === "ours") return range.oursChanged;
        if (mode === "theirs") return range.theirsChanged;
        return range.oursChanged || range.theirsChanged;
      });
      const changes = targets.map((range) => ({
        id: range.index,
        text:
          mode === "all"
            ? chosenLines(range).join("\n")
            : (mode === "ours" ? range.ours : range.theirs).join("\n"),
      }));
      pane.replaceBlocks(changes);
    },
    [ranges],
  );

  const autoResolve = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return;
    const changes: { id: number; text: string }[] = [];
    for (const range of conflicts) {
      if (!pendingConflict(range.index)) continue;
      const resolved = tryResolveRange(range) ?? tryResolveRange(range, true);
      if (resolved) changes.push({ id: range.index, text: resolved.join("\n") });
    }
    pane.replaceBlocks(changes);
  }, [conflicts, pendingConflict]);

  const selectedRanges = selected && !selected.empty
    ? ranges.filter((range) => {
        const start = (selected.side === "ours" ? range.oursStart : range.theirsStart) + 1;
        const end = Math.max(start, selected.side === "ours" ? range.oursEnd : range.theirsEnd);
        return selected.start <= end && selected.end >= start;
      })
    : [];

  const applySelected = useCallback(() => {
    if (!selected) return;
    const pane = resultPane.current;
    if (!pane) return;
    const changes = selectedRanges.map((range) => ({
      id: range.index,
      text: (selected.side === "ours" ? range.ours : range.theirs).join("\n"),
    }));
    pane.replaceBlocks(changes);
    const first = selectedRanges[0];
    if (first) setCurrent(first.index);
  }, [selected, selectedRanges]);

  const ignoreSelected = useCallback(() => {
    if (!selected) return;
    const pane = resultPane.current;
    if (!pane) return;
    const changes: { id: number; text: string }[] = [];
    for (const range of selectedRanges) {
      if (range.kind === "conflict") {
        const other = selected.side === "ours" ? range.theirs : range.ours;
        changes.push({ id: range.index, text: other.join("\n") });
      } else {
        const changed = selected.side === "ours" ? range.oursChanged : range.theirsChanged;
        if (changed) changes.push({ id: range.index, text: range.base.join("\n") });
      }
    }
    pane.replaceBlocks(changes);
    const first = selectedRanges[0];
    if (first) setCurrent(first.index);
  }, [selected, selectedRanges]);

  const copySelected = useCallback(() => {
    if (!selected) return;
    const text = selectedRanges
      .map((range) => (selected.side === "ours" ? range.ours : range.theirs).join("\n"))
      .join("\n");
    void navigator.clipboard.writeText(text);
  }, [selected, selectedRanges]);

  const resetSelected = useCallback(() => {
    const pane = resultPane.current;
    if (!pane) return;
    const changes = selectedRanges.map((range) => ({
      id: range.index,
      text:
        range.kind === "conflict"
          ? conflictText(range, model.labels)
          : chosenLines(range).join("\n"),
    }));
    pane.replaceBlocks(changes);
    const first = selectedRanges[0];
    if (first) setCurrent(first.index);
  }, [model.labels, selectedRanges]);

  const openNonConflictMenu = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: t("fromLocal"), icon: "ours", onClick: () => applyNonConflicts("ours") },
        { label: t("fromRemote"), icon: "theirs", onClick: () => applyNonConflicts("theirs") },
        { label: t("fromBoth"), icon: "merge", onClick: () => applyNonConflicts("all") },
      ],
    });
  };

  const openViewMenu = (event: React.MouseEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      x: rect.left,
      y: rect.bottom,
      items: [
        { label: t("syncScroll"), icon: "refresh", checked: autoScroll, onClick: () => setAutoScroll((v) => !v) },
        { label: t("collapseUnchanged"), icon: "collapse", checked: collapsed, onClick: () => setCollapsed((v) => !v) },
        { label: t("softWrap"), icon: "wrap", checked: wrap, onClick: () => setWrap((v) => !v) },
        { label: t("showWhitespace"), icon: "whitespace", checked: showWhitespace, onClick: () => setShowWhitespace((v) => !v) },
        { label: t("charHighlights"), icon: "diff", checked: charHighlights, onClick: () => setCharHighlights((v) => !v) },
        { label: t("ignoreWhitespace"), icon: "eye", checked: ignoreWhitespace, disabled: dirty, onClick: () => setIgnoreWhitespace((v) => !v) },
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

  useEffect(() => {
    const oursEl = oursRef.current;
    const resultEl = resultRef.current;
    const theirsEl = theirsRef.current;
    if (!oursEl || !resultEl || !theirsEl) return;
    const resolvedResult = workingIsResolved || initialText !== model.result;

    const sync = (source: "ours" | "result" | "theirs", line: number) => {
      if (!autoScrollRef.current) return;
      const now = performance.now();
      if (now < lock.current) return;
      lock.current = now + 120;
      const oursAnchors = anchorsFor(model, "ours");
      const theirsAnchors = anchorsFor(model, "theirs");
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
      blocks: sideBlocks(model, "ours", { apply: t("applyLocal"), t: tr, chars: charHighlights }),
      wrap,
      whitespace: showWhitespace,
      onApplyBlock: (id) => applyRange(id, "ours"),
      onScroll: (line) => sync("ours", line),
      onSelection: (start, end, empty) => setSelected({ side: "ours", start, end, empty }),
    });
    const result = new MergePane(resultEl, {
      doc: initialText,
      editable: true,
      language: conflict.language,
      blocks: resolvedResult ? [] : resultBlocks(model, initialText, { t: tr }),
      wrap,
      whitespace: showWhitespace,
      onScroll: (line) => sync("result", line),
      onSaveRequest: () => requestSaveRef.current(),
      onChange: (doc, blocks) => {
        resultTextRef.current = doc;
        setResultText(doc);
        const pending = new Set<number>();
        const next = blocks.map((block) => {
          const from = Math.max(0, Math.min(block.from, doc.length));
          const to = Math.max(from, Math.min(block.to, doc.length));
          const unresolved = doc.slice(from, to).includes("<<<<<<<");
          if (unresolved) pending.add(block.id);
          const range = model.ranges.find((r) => r.index === block.id);
          if (!range) return block;
          let tone: MergePaneBlock["tone"] = unresolved ? "conflict" : "resolved";
          if (!unresolved && range.kind !== "conflict") {
            const lines = blockLines(doc, block);
            if ((range.oursChanged || range.theirsChanged) && sameLines(lines, range.base)) tone = "ignored";
            else if (range.oursChanged && range.theirsChanged) tone = "resolved";
            else tone = range.oursChanged ? "ours" : "theirs";
          }
          return {
            ...block,
            tone,
            title: unresolved ? t("conflictBlock") : rangeType(range, tr),
          } as MergePaneBlock;
        });
        if (next.some((block, i) => block.tone !== blocks[i]?.tone)) result.setBlocks(next);
        for (const [pane, side] of [
          [ours, "ours"],
          [theirs, "theirs"],
        ] as const) {
          pane.setBlocks(
            pane.getBlocks().map((block) => {
              const range = model.ranges.find((r) => r.index === block.id);
              if (range?.kind !== "conflict") return block;
              const active = pending.has(block.id);
              return {
                ...block,
                apply: range.kind === "conflict" ? (active ? side : undefined) : side,
                tone: range.kind === "conflict" ? (active ? "conflict" : "resolved") : block.tone,
                title: range.kind === "conflict"
                  ? (active ? `${t(side === "ours" ? "applyLocal" : "applyRemote")} · ${rangeType(range, tr)}` : rangeType(range, tr))
                  : block.title,
              };
            }),
          );
        }
        setUnresolved(pending.size);
        setDirty(doc !== initialRef.current);
      },
    });
    const theirs = new MergePane(theirsEl, {
      doc: conflict.theirs,
      editable: false,
      language: conflict.language,
      blocks: sideBlocks(model, "theirs", { apply: t("applyRemote"), t: tr, chars: charHighlights }),
      wrap,
      whitespace: showWhitespace,
      onApplyBlock: (id) => applyRange(id, "theirs"),
      onScroll: (line) => sync("theirs", line),
      onSelection: (start, end, empty) => setSelected({ side: "theirs", start, end, empty }),
    });
    oursPane.current = ours;
    resultPane.current = result;
    theirsPane.current = theirs;
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
            ? { ...block, marks: conflictMarks(range, side, offsets, charHighlights) }
            : block;
        }),
      );
    };
    refresh(oursPane.current, "ours");
    refresh(theirsPane.current, "theirs");
    // The panes are rebuilt separately when the model changes; this only
    // refreshes the marks and must preserve their resolved/apply state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charHighlights]);

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
      const range = conflicts.find((r) => r.index === block.id);
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
      } else if (event.altKey && !event.ctrlKey && event.key === "ArrowLeft") {
        event.preventDefault();
        const range = conflictAtCaret();
        if (range) applyRange(range.index, "ours");
      } else if (event.altKey && !event.ctrlKey && event.key === "ArrowRight") {
        event.preventDefault();
        const range = conflictAtCaret();
        if (range) applyRange(range.index, "theirs");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyRange, conflictAtCaret, jump]);

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

  return (
    <div className="conflict-view merge3-view">
      <header className="diff-header">
        <div className="diff-title-row">
          <span className="diff-status st-conflict">!</span>
          <span className="diff-path">{path}</span>
          <span className={cx("merge3-progress", unresolved === 0 && "done")}>
            <Icon name={unresolved === 0 ? "check" : "warning"} size={12} />
            {unresolved === 0
              ? t("allResolved")
              : t("unresolved", { n: unresolved })}
          </span>
          <span className="spacer" />
          {busy && <Spinner />}
          <IconButton icon="close" title={t("close")} small onClick={onClose} />
        </div>
        <div className="diff-toolbar merge3-toolbar">
          <IconButton icon="chevronUp" title={t("previous")} small onClick={() => jump(-1)} />
          <IconButton icon="chevronDown" title={t("next")} small onClick={() => jump(1)} />
          <span className="diff-nav-count">
            {ranges.length === 0 ? "0 / 0" : `${Math.min(current + 1, ranges.length)} / ${ranges.length}`}
          </span>
          <IconButton icon="chevronUp" title={t("previousConflict")} small onClick={() => jumpConflict(-1)} />
          <IconButton icon="chevronDown" title={t("nextConflict")} small onClick={() => jumpConflict(1)} />
          <span className="toolbar-sep" />
          <button className="toolbar-text-btn" onClick={autoResolve} disabled={unresolved === 0}>
            <Icon name="sparkle" /> {t("autoResolve")}
          </button>
          <button className="toolbar-text-btn" onClick={openNonConflictMenu}>
            <Icon name="stage" /> {t("nonConflicts")}
          </button>
          <button className="toolbar-text-btn" onClick={() => applyAll("ours")} disabled={unresolved === 0}>
            <Icon name="ours" /> {t("applyAllLocal")}
          </button>
          <button className="toolbar-text-btn" onClick={() => applyAll("theirs")} disabled={unresolved === 0}>
            <Icon name="theirs" /> {t("applyAllRemote")}
          </button>
          <button className="toolbar-text-btn" onClick={applySelected} disabled={selectedRanges.length === 0}>
            <Icon name="check" /> {t("applySelected")}
          </button>
          <IconButton
            icon="more"
            title={t("selectedActions")}
            small
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({
                x: rect.left,
                y: rect.bottom,
                items: [
                  { label: t("ignoreSelected"), icon: "eye", disabled: selectedRanges.length === 0, onClick: ignoreSelected },
                  { label: t("resetSelected"), icon: "reset", disabled: selectedRanges.length === 0, onClick: resetSelected },
                  { label: t("copySelected"), icon: "copy", disabled: selectedRanges.length === 0, onClick: copySelected },
                ],
              });
            }}
          />
          <span className="spacer" />
          <button className="toolbar-text-btn" onClick={openCompareMenu}>
            <Icon name="diff" /> {t("compare")}
          </button>
          <IconButton icon="settings" title={t("viewOptions")} small onClick={openViewMenu} />
          <button
            className="toolbar-text-btn"
            onClick={() => void navigator.clipboard.writeText(resultText)}
          >
            <Icon name="copy" /> {t("copyResult")}
          </button>
        </div>
      </header>

      <div className="merge3-panes">
        <section className="merge3-pane">
          <div className="merge3-pane-head">
            <span>{t("local")}</span>
            {model.labels.ours && <span className="merge3-version">{model.labels.ours}</span>}
          </div>
          <div className="merge3-editor" ref={oursRef} />
        </section>
        <section className="merge3-pane result">
          <div className="merge3-pane-head">
            <span>{t("result")}</span>
            {unresolved > 0 && <span className="merge3-version pending">{t("unresolved", { n: unresolved })}</span>}
          </div>
          <div className="merge3-editor" ref={resultRef} />
        </section>
        <section className="merge3-pane">
          <div className="merge3-pane-head">
            <span>{t("remote")}</span>
            {model.labels.theirs && <span className="merge3-version">{model.labels.theirs}</span>}
          </div>
          <div className="merge3-editor" ref={theirsRef} />
        </section>
      </div>

      <footer className="merge3-footer">
        <span className={cx("merge3-status", unresolved === 0 && "done")}>
          {ranges.length === 0 ? (
            t("noChanges")
          ) : (
            <>
              <span>{count(ranges.length, t("changesOne", { n: ranges.length }), t("changesOther", { n: ranges.length }))}</span>
              <span className="muted"> · </span>
              <span>{count(unresolved, t("conflictOne", { n: unresolved }), t("conflictOther", { n: unresolved }))}</span>
              {autoResolvableCount > 0 && (
                <>
                  <span className="muted"> · </span>
                  <span>{t("autoResolvable", { n: autoResolvableCount })}</span>
                </>
              )}
            </>
          )}
        </span>
        {markersRemain && <span className="conflict-warning">{t("markersRemaining")}</span>}
        <span className="spacer" />
        <Button size="small" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button size="small" onClick={() => onTakeSide("ours")} disabled={busy || !conflict.hasOurs && !conflict.hasTheirs}>
          {t("acceptLeft")}
        </Button>
        <Button size="small" onClick={() => onTakeSide("theirs")} disabled={busy || !conflict.hasTheirs && !conflict.hasOurs}>
          {t("acceptRight")}
        </Button>
        <Button
          size="small"
          variant="primary"
          onClick={requestSave}
          disabled={!canApply}
          title={t("applyHint")}
        >
          {t("apply")}
        </Button>
      </footer>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {confirmApply !== null && (
        <ConfirmDialog
          title={t("applyAnywayTitle")}
          message={count(unresolved, t("applyAnywayOne"), t("applyAnywayMessage", { n: unresolved }))}
          detail={t("applyAnywayDetail")}
          confirmLabel={t("applyAnyway")}
          danger
          onConfirm={() => {
            saveRef.current(confirmApply);
            setConfirmApply(null);
          }}
          onCancel={() => setConfirmApply(null)}
        />
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
    </div>
  );
}
