import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent } from "./mygo";
import {
  computeMerge,
  conflictLabels,
  countConflictMarkers,
  hasConflictMarkers,
  tryResolveRange,
  type MergeModel,
  type MergeRange,
} from "./merge";
import { wordDiff } from "./diff";
import { detectLineEnding, normalizeText, withLineEnding } from "./editorText";
import { MergePane, type MergePaneBlock } from "./mergePane";
import { Icon } from "./icons";
import { Button, IconButton, Spinner, cx } from "./ui";
import { count, useT } from "./i18n";

const T = {
  en: {
    close: "Close",
    local: "Local Changes",
    remote: "Remote Changes",
    result: "Result",
    previous: "Previous change (Shift+F7)",
    next: "Next change (F7)",
    applyAllLocal: "Apply all local changes",
    applyAllRemote: "Apply all remote changes",
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
    markersRemaining: "Resolve every conflict marker before applying",
    applyLocal: "Apply this local change",
    applyRemote: "Apply this remote change",
    conflictBlock: "Unresolved conflict",
    resolvedBlock: "Resolved conflict",
  },
  zh: {
    close: "关闭",
    local: "本地更改",
    remote: "远程更改",
    result: "结果",
    previous: "上一处变更（Shift+F7）",
    next: "下一处变更（F7）",
    applyAllLocal: "全部采用本地更改",
    applyAllRemote: "全部采用远程更改",
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
    markersRemaining: "应用前请解决所有冲突标记",
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
): { from: number; to: number }[] {
  if (range.kind !== "conflict") return [];
  const marks: { from: number; to: number }[] = [];
  const start = side === "ours" ? range.oursStart : range.theirsStart;
  for (let i = 0; i < Math.min(range.ours.length, range.theirs.length); i++) {
    const left = range.ours[i]!;
    const right = range.theirs[i]!;
    if (left === right) continue;
    const [oursSegs, theirsSegs] = wordDiff(left, right);
    let pos = offsets[start + i]!;
    for (const segment of side === "ours" ? oursSegs : theirsSegs) {
      if (segment.changed && segment.text) marks.push({ from: pos, to: pos + segment.text.length });
      pos += segment.text.length;
    }
  }
  return marks;
}

function sideBlocks(model: MergeModel, side: "ours" | "theirs", labels: { apply: string }): MergePaneBlock[] {
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
      apply: range.kind === "conflict" ? side : undefined,
      marks: conflictMarks(range, side, offsets),
      title: range.kind === "conflict" ? labels.apply : undefined,
    });
  }
  return blocks;
}

function resultBlocks(model: MergeModel, text: string, label: string): MergePaneBlock[] {
  if (text !== model.result) return [];
  const offsets = lineOffsets(text.split("\n"));
  const blocks: MergePaneBlock[] = [];
  for (const range of model.ranges) {
    if (range.kind !== "conflict") continue;
    const placement = model.placements.find((p) => p.rangeIndex === range.index);
    if (!placement) continue;
    blocks.push({
      id: range.index,
      from: offsetAt(offsets, placement.startLine),
      to: offsetAt(offsets, placement.endLine),
      tone: "conflict",
      title: label,
    });
  }
  return blocks;
}

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
}: {
  path: string;
  conflict: ConflictContent;
  busy: boolean;
  onSave: (content: string) => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT(T);
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
      }),
    [conflict.base, conflict.ours, conflict.theirs, labels, rawWorking],
  );
  const workingIsResolved = rawWorking !== "" && !hasConflictMarkers(rawWorking);
  const initialText =
    rawWorking !== "" && (workingIsResolved || model.ranges.length === 0)
      ? rawWorking
      : model.result;
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

  const oursRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const theirsRef = useRef<HTMLDivElement>(null);
  const oursPane = useRef<MergePane | null>(null);
  const resultPane = useRef<MergePane | null>(null);
  const theirsPane = useRef<MergePane | null>(null);
  const initialRef = useRef(initialText);
  const resultTextRef = useRef(initialText);
  const lock = useRef(0);

  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const endingRef = useRef(ending);
  endingRef.current = ending;
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  const ranges = model.ranges;
  const conflicts = ranges.filter((r) => r.kind === "conflict");
  const markersRemain = hasConflictMarkers(resultText);
  const canApply = !busy && !conflict.binary && !markersRemain;

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
      if (!range || !pendingConflict(id)) return;
      const lines = side === "ours" ? range.ours : range.theirs;
      resultPane.current?.replaceBlock(id, lines.join("\n"));
      setCurrent(id);
    },
    [pendingConflict, ranges],
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

  const selectedConflicts = selected && !selected.empty
    ? conflicts.filter((range) => {
        if (!pendingConflict(range.index)) return false;
        const start = (selected.side === "ours" ? range.oursStart : range.theirsStart) + 1;
        const end = Math.max(start, selected.side === "ours" ? range.oursEnd : range.theirsEnd);
        return selected.start <= end && selected.end >= start;
      })
    : [];

  const applySelected = useCallback(() => {
    if (!selected) return;
    const pane = resultPane.current;
    if (!pane) return;
    const changes = selectedConflicts.map((range) => ({
      id: range.index,
      text: (selected.side === "ours" ? range.ours : range.theirs).join("\n"),
    }));
    pane.replaceBlocks(changes);
    const first = selectedConflicts[0];
    if (first) setCurrent(first.index);
  }, [selected, selectedConflicts]);

  useEffect(() => {
    const oursEl = oursRef.current;
    const resultEl = resultRef.current;
    const theirsEl = theirsRef.current;
    if (!oursEl || !resultEl || !theirsEl) return;
    const resolvedResult = workingIsResolved || initialText !== model.result;

    const sync = (source: "ours" | "result" | "theirs", line: number) => {
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
      blocks: sideBlocks(model, "ours", { apply: t("applyLocal") }),
      onApplyBlock: (id) => applyRange(id, "ours"),
      onScroll: (line) => sync("ours", line),
      onSelection: (start, end, empty) => setSelected({ side: "ours", start, end, empty }),
    });
    const result = new MergePane(resultEl, {
      doc: initialText,
      editable: true,
      language: conflict.language,
      blocks: resolvedResult ? [] : resultBlocks(model, initialText, t("conflictBlock")),
      onScroll: (line) => sync("result", line),
      onSaveRequest: () => {
        if (!busyRef.current && !conflict.binary && !hasConflictMarkers(resultTextRef.current)) {
          saveRef.current(withLineEnding(resultTextRef.current, endingRef.current));
        }
      },
      onChange: (doc, blocks) => {
        resultTextRef.current = doc;
        setResultText(doc);
        const pending = new Set<number>();
        const next = blocks.map((block) => {
          const from = Math.max(0, Math.min(block.from, doc.length));
          const to = Math.max(from, Math.min(block.to, doc.length));
          const unresolved = doc.slice(from, to).includes("<<<<<<<");
          if (unresolved) pending.add(block.id);
          return {
            ...block,
            tone: unresolved ? "conflict" : "resolved",
            title: unresolved ? t("conflictBlock") : t("resolvedBlock"),
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
                apply: active ? side : undefined,
                tone: active ? "conflict" : "resolved",
                title: active ? t(side === "ours" ? "applyLocal" : "applyRemote") : t("resolvedBlock"),
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
      blocks: sideBlocks(model, "theirs", { apply: t("applyRemote") }),
      onApplyBlock: (id) => applyRange(id, "theirs"),
      onScroll: (line) => sync("theirs", line),
      onSelection: (start, end, empty) => setSelected({ side: "theirs", start, end, empty }),
    });
    oursPane.current = ours;
    resultPane.current = result;
    theirsPane.current = theirs;
    const first = model.ranges.find((range) => range.kind === "conflict") ?? model.ranges[0];
    if (first) requestAnimationFrame(() => scrollToRange(first));

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
  }, [conflict.path, initialText]);

  const conflictAtCaret = useCallback(() => {
    const line = resultPane.current?.caretLine() ?? 1;
    for (const range of conflicts) {
      const placement = model.placements.find((p) => p.rangeIndex === range.index);
      if (placement && line >= placement.startLine + 1 && line <= placement.endLine) return range;
    }
    return conflicts.find((range) => range.index === current) ?? conflicts[0];
  }, [conflicts, current, model.placements]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F7") {
        event.preventDefault();
        jump(event.shiftKey ? -1 : 1);
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
          <span className="toolbar-sep" />
          <button className="toolbar-text-btn" onClick={autoResolve} disabled={unresolved === 0}>
            <Icon name="sparkle" /> {t("autoResolve")}
          </button>
          <button className="toolbar-text-btn" onClick={() => applyAll("ours")} disabled={unresolved === 0}>
            <Icon name="ours" /> {t("applyAllLocal")}
          </button>
          <button className="toolbar-text-btn" onClick={() => applyAll("theirs")} disabled={unresolved === 0}>
            <Icon name="theirs" /> {t("applyAllRemote")}
          </button>
          <button className="toolbar-text-btn" onClick={applySelected} disabled={selectedConflicts.length === 0}>
            <Icon name="check" /> {t("applySelected")}
          </button>
          <span className="spacer" />
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
          onClick={() => onSave(withLineEnding(resultTextRef.current, ending))}
          disabled={!canApply}
          title={t("applyHint")}
        >
          {t("apply")}
        </Button>
      </footer>
    </div>
  );
}
