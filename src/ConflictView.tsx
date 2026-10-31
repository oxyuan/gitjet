import { useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent } from "./mygo";
import type { WordSegment } from "./diff";
import { Icon } from "./icons";
import {
  alignLines,
  assembleForFree as assembleFreeText,
  assembleMerge,
  parseConflicts,
  type ConflictSegment,
} from "./merge";
import { Button, cx, IconButton, Spinner } from "./ui";
import { count, useT } from "./i18n";

type Choice = "ours" | "theirs" | "both" | "custom" | "none";

const T = {
  en: {
    empty: "(empty)",
    noMarkers: "No conflict markers remain — choose a side or mark it resolved",
    close: "Close",
    takeOurs: "Take Ours",
    takeTheirs: "Take Theirs",
    markResolved: "Mark Resolved",
    oursHead: "Ours (HEAD)",
    theirs: "Theirs",
    allResolved: "All conflicts resolved",
    unresolved: "{n} unresolved",
    block: "block",
    blocks: "blocks",
    blocksMode: "Blocks",
    wholeFile: "Whole file",
    wholeFileHint: "Edit the complete result as one file",
    previousConflict: "Previous conflict",
    nextConflict: "Next conflict",
    allOurs: "All Ours",
    allTheirs: "All Theirs",
    copyResult: "Copy result",
    saveResolution: "Save Resolution",
    binaryConflict: "Binary conflict — choose a side",
    completeResult: "Complete result",
    markersRemaining: " — resolve every “<<<<<<<” marker before saving",
    mergeHint:
      "Click any line beside a conflict to add it to the result, or choose Ours / Theirs / Both. The result is editable, so you can adjust it line by line.",
    unchangedLine: "{n} unchanged line",
    unchangedLines: "{n} unchanged lines",
    conflictNumber: "Conflict {n}",
    ours: "Ours",
    both: "Both",
    resetConflict: "Reset this conflict",
    insertOurs: "Insert this line from Ours",
    insertTheirs: "Insert this line from Theirs",
    useAllOurs: "Use all Ours",
    useAllTheirs: "Use all Theirs",
    hideBase: "Hide base",
    showBase: "Show base",
    resolved: "resolved",
    pending: "pending",
    commonAncestor: "Common ancestor",
    result: "Result",
    resultPlaceholder:
      "Choose Ours, Theirs or Both, click lines above to insert them, or type the merged code here.",
    nothingToResolve: "Nothing to resolve",
    finalResult: "Final result",
    lines: "{n} lines",
  },
  zh: {
    empty: "（空）",
    noMarkers: "已无冲突标记 — 请选择一侧或标记为已解决",
    close: "关闭",
    takeOurs: "采用我方",
    takeTheirs: "采用对方",
    markResolved: "标记为已解决",
    oursHead: "我方（HEAD）",
    theirs: "对方",
    allResolved: "所有冲突已解决",
    unresolved: "{n} 处未解决",
    block: "个冲突块",
    blocks: "个冲突块",
    blocksMode: "冲突块",
    wholeFile: "整个文件",
    wholeFileHint: "将完整结果作为单个文件编辑",
    previousConflict: "上一处冲突",
    nextConflict: "下一处冲突",
    allOurs: "全部采用我方",
    allTheirs: "全部采用对方",
    copyResult: "复制结果",
    saveResolution: "保存解决方案",
    binaryConflict: "二进制文件冲突 — 请选择一侧",
    completeResult: "完整结果",
    markersRemaining: " — 保存前请解决所有“<<<<<<<”标记",
    mergeHint:
      "点击冲突旁边的任意行即可将其加入结果，或选择我方 / 对方 / 两者。结果可直接编辑，可逐行调整。",
    unchangedLine: "{n} 行未更改",
    unchangedLines: "{n} 行未更改",
    conflictNumber: "冲突 {n}",
    ours: "我方",
    both: "两者",
    resetConflict: "重置此冲突",
    insertOurs: "插入我方此行",
    insertTheirs: "插入对方此行",
    useAllOurs: "全部使用我方",
    useAllTheirs: "全部使用对方",
    hideBase: "隐藏基线",
    showBase: "显示基线",
    resolved: "已解决",
    pending: "待解决",
    commonAncestor: "共同祖先",
    result: "结果",
    resultPlaceholder: "选择我方、对方或两者，点击上方各行插入，或在此直接输入合并后的代码。",
    nothingToResolve: "没有需要解决的冲突",
    finalResult: "最终结果",
    lines: "{n} 行",
  },
} as const;

function Lines({ text }: { text: string }) {
  const t = useT(T);
  if (text === "") return <span className="muted">{t("empty")}</span>;
  return (
    <>
      {text.split("\n").map((line, i) => (
        <div className="merge-line-text" key={i}>
          {line || "\u00a0"}
        </div>
      ))}
    </>
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

export function ConflictView({
  path,
  conflict,
  busy,
  onSave,
  onMarkResolved,
  onTakeSide,
  onClose,
  onDirtyChange,
}: {
  path: string;
  conflict: ConflictContent;
  busy: boolean;
  onSave: (content: string) => void;
  onMarkResolved: () => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onClose: () => void;
  /** Reports whether the resolution has edits that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { segments, trailingNewline } = useMemo(() => parseConflicts(conflict.working), [conflict.working]);
  const t = useT(T);
  const conflicts = useMemo(
    () => segments.filter((s): s is ConflictSegment => s.kind === "conflict"),
    [segments],
  );
  const [contents, setContents] = useState<string[]>(() => conflicts.map(() => ""));
  const [resolved, setResolved] = useState<boolean[]>(() => conflicts.map(() => false));
  const [choices, setChoices] = useState<Choice[]>(() => conflicts.map(() => "none"));
  const [free, setFree] = useState(false);
  const [freeText, setFreeText] = useState(conflict.working);
  const dirty = free
    ? freeText !== conflict.working
    : contents.some((text, i) => text !== "" || resolved[i]);
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);
  const editors = useRef<(HTMLTextAreaElement | null)[]>([]);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [baseOpen, setBaseOpen] = useState<number | null>(null);

  useEffect(() => {
    setContents(conflicts.map(() => ""));
    setResolved(conflicts.map(() => false));
    setChoices(conflicts.map(() => "none"));
    setFreeText(conflict.working);
    setFree(false);
  }, [conflict.working, conflicts]);

  const setConflictText = (i: number, text: string, choice: Choice) => {
    setContents((prev) => prev.map((v, k) => (k === i ? text : v)));
    setResolved((prev) => prev.map((v, k) => (k === i ? true : v)));
    setChoices((prev) => prev.map((v, k) => (k === i ? choice : v)));
  };

  const useSide = (i: number, side: "ours" | "theirs" | "both") => {
    const c = conflicts[i]!;
    const text =
      side === "ours" ? c.ours.join("\n") : side === "theirs" ? c.theirs.join("\n") : [...c.ours, ...c.theirs].join("\n");
    setConflictText(i, text, side);
  };

  const insertLine = (i: number, line: string) => {
    const currentText = contents[i] ?? "";
    const el = editors.current[i];
    const pos = el && document.activeElement === el ? el.selectionStart : currentText.length;
    const before = currentText.slice(0, pos);
    const after = currentText.slice(pos);
    const sep = before === "" || before.endsWith("\n") ? "" : "\n";
    const next = before + sep + line + after;
    setConflictText(i, next, "custom");
    requestAnimationFrame(() => {
      const editor = editors.current[i];
      if (editor) {
        editor.focus();
        const caret = pos + sep.length + line.length;
        editor.setSelectionRange(caret, caret);
      }
    });
  };

  const insertAll = (i: number, side: "ours" | "theirs") => {
    const c = conflicts[i]!;
    const text = (side === "ours" ? c.ours : c.theirs).join("\n");
    setConflictText(i, text, side);
  };

  const jump = (delta: number) => {
    if (conflicts.length === 0) return;
    const next = Math.max(0, Math.min(conflicts.length - 1, current + delta));
    setCurrent(next);
    cards.current[next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const unresolved = resolved.filter((r) => !r).length;
  const result = free ? freeText : assembleMerge(segments, contents, trailingNewline);
  const resultLines = result.endsWith("\n") ? result.split("\n").length - 1 : result.split("\n").length;
  const hasMarkers = result.includes("<<<<<<<") || result.includes("=======") || result.includes(">>>>>>>");
  const canSave = !busy && !conflict.binary && (free ? !hasMarkers : unresolved === 0 && !hasMarkers);

  if (!conflict.working.includes("<<<<<<<")) {
    return (
      <div className="conflict-view">
        <div className="diff-header">
          <div className="diff-title-row">
            <span className="diff-status st-conflict">!</span>
            <span className="diff-path">{path}</span>
            <span className="muted">{t("noMarkers")}</span>
            <span className="spacer" />
            {busy && <Spinner />}
            <IconButton icon="close" title={t("close")} small onClick={onClose} />
          </div>
          <div className="diff-toolbar conflict-toolbar">
            <Button size="small" onClick={() => onTakeSide("ours")} disabled={!conflict.hasOurs || busy}>
              <Icon name="ours" /> {t("takeOurs")}
            </Button>
            <Button size="small" onClick={() => onTakeSide("theirs")} disabled={!conflict.hasTheirs || busy}>
              <Icon name="theirs" /> {t("takeTheirs")}
            </Button>
            <span className="toolbar-sep" />
            <Button size="small" onClick={onMarkResolved} disabled={busy}>
              <Icon name="check" /> {t("markResolved")}
            </Button>
          </div>
        </div>
        <div className="conflict-body">
          <div className="conflict-sides">
            <div className="conflict-side ours">
              <div className="side-label">{t("oursHead")}</div>
              <pre>
                <Lines text={conflict.ours} />
              </pre>
            </div>
            <div className="conflict-side theirs">
              <div className="side-label">{t("theirs")}</div>
              <pre>
                <Lines text={conflict.theirs} />
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="conflict-view merge-view">
      <div className="diff-header">
        <div className="diff-title-row">
          <span className="diff-status st-conflict">!</span>
          <span className="diff-path">{path}</span>
          <span className={cx("merge-progress", unresolved === 0 ? "done" : "")}>
            {unresolved === 0 ? t("allResolved") : t("unresolved", { n: unresolved })} ·{" "}
            {conflicts.length} {count(conflicts.length, t("block"), t("blocks"))}
          </span>
          <span className="spacer" />
          {busy && <Spinner />}
          <IconButton icon="close" title={t("close")} small onClick={onClose} />
        </div>
        <div className="diff-toolbar merge-toolbar">
          <div className="segmented">
            <button className={cx("segmented-btn text", !free && "active")} onClick={() => setFree(false)}>
              {t("blocksMode")}
            </button>
            <button
              className={cx("segmented-btn text", free && "active")}
              onClick={() => {
                setFreeText(assembleFreeText(segments, contents, resolved, trailingNewline));
                setFree(true);
              }}
              title={t("wholeFileHint")}
            >
              {t("wholeFile")}
            </button>
          </div>
          {!free && conflicts.length > 0 && (
            <>
              <span className="toolbar-sep" />
              <IconButton icon="chevronUp" title={t("previousConflict")} small onClick={() => jump(-1)} />
              <IconButton icon="chevronDown" title={t("nextConflict")} small onClick={() => jump(1)} />
              <span className="muted">
                {Math.min(current + 1, conflicts.length)} / {conflicts.length}
              </span>
            </>
          )}
          <span className="spacer" />
          {!free && conflicts.length > 0 && (
            <>
              <button className="toolbar-text-btn" onClick={() => conflicts.forEach((_, i) => useSide(i, "ours"))}>
                <Icon name="ours" /> {t("allOurs")}
              </button>
              <button className="toolbar-text-btn" onClick={() => conflicts.forEach((_, i) => useSide(i, "theirs"))}>
                <Icon name="theirs" /> {t("allTheirs")}
              </button>
              <span className="toolbar-sep" />
            </>
          )}
          <button
            className="toolbar-text-btn"
            onClick={() => {
              void navigator.clipboard.writeText(result);
            }}
          >
            <Icon name="copy" /> {t("copyResult")}
          </button>
          <Button size="small" variant="primary" onClick={() => onSave(result)} disabled={!canSave}>
            <Icon name="check" /> {t("saveResolution")}
          </Button>
        </div>
      </div>

      {conflict.binary ? (
        <div className="diff-empty">
          <Icon name="warning" size={24} />
          <div>{t("binaryConflict")}</div>
        </div>
      ) : free ? (
        <div className="merge-free">
          <div className="side-label">
            {t("completeResult")}
            {hasMarkers && <span className="muted">{t("markersRemaining")}</span>}
          </div>
          <textarea
            className="conflict-editor"
            value={freeText}
            spellCheck={false}
            onChange={(e) => setFreeText(e.target.value)}
          />
        </div>
      ) : (
        <div className="merge-body">
          <div className="merge-hint">
            <Icon name="info" size={13} />
            <span>{t("mergeHint")}</span>
          </div>
          {segments.map((seg, si) => {
            if (seg.kind === "text") {
              const lineCount = seg.text === "" ? 0 : seg.text.split("\n").length;
              if (lineCount === 0) return null;
              return (
                <div className="merge-unchanged" key={si}>
                  <span>{count(lineCount, t("unchangedLine"), t("unchangedLines"))}</span>
                </div>
              );
            }
            const index = segments.slice(0, si).filter((s) => s.kind === "conflict").length;
            const c = conflicts[index]!;
            const rows = alignLines(c.ours, c.theirs);
            const isResolved = resolved[index] ?? false;
            return (
              <div
                className={cx("merge-card", isResolved ? "resolved" : "unresolved", current === index && "current")}
                key={si}
                ref={(el) => {
                  cards.current[index] = el;
                }}
                onMouseDown={() => setCurrent(index)}
              >
                <div className="merge-card-header">
                  <span className={cx("merge-dot", isResolved ? "done" : "")} />
                  <span className="merge-title">{t("conflictNumber", { n: index + 1 })}</span>
                  {c.label && <span className="muted">({c.label})</span>}
                  <span className="spacer" />
                  <div className="segmented">
                    {(["ours", "theirs", "both"] as const).map((side) => (
                      <button
                        key={side}
                        className={cx("segmented-btn text", choices[index] === side && "active")}
                        onClick={() => useSide(index, side)}
                      >
                        {side === "ours" ? t("ours") : side === "theirs" ? t("theirs") : t("both")}
                      </button>
                    ))}
                  </div>
                  <IconButton
                    icon="undo"
                    title={t("resetConflict")}
                    small
                    onClick={() => {
                      setContents((prev) => prev.map((v, k) => (k === index ? "" : v)));
                      setResolved((prev) => prev.map((v, k) => (k === index ? false : v)));
                      setChoices((prev) => prev.map((v, k) => (k === index ? "none" : v)));
                    }}
                  />
                </div>
                <div className="merge-sides">
                  <div className="merge-side-labels">
                    <span>{t("oursHead")}</span>
                    <span>{t("theirs")}</span>
                  </div>
                  {rows.map((row, ri) => (
                    <div className="merge-row" key={ri}>
                      <button
                        className={cx("merge-cell ours", !row.ours && "empty")}
                        disabled={!row.ours}
                        title={row.ours ? t("insertOurs") : undefined}
                        onClick={() => row.ours && insertLine(index, row.ours.text)}
                      >
                        {row.ours ? (
                          <>
                            <span className="merge-line-no">{row.ours.no}</span>
                            <span className="merge-line-code">
                              <Segments segs={row.ours.segments} text={row.ours.text} />
                            </span>
                            <span className="merge-insert">
                              <Icon name="plus" size={11} />
                            </span>
                          </>
                        ) : (
                          <span className="merge-line-no" />
                        )}
                      </button>
                      <button
                        className={cx("merge-cell theirs", !row.theirs && "empty")}
                        disabled={!row.theirs}
                        title={row.theirs ? t("insertTheirs") : undefined}
                        onClick={() => row.theirs && insertLine(index, row.theirs.text)}
                      >
                        {row.theirs ? (
                          <>
                            <span className="merge-line-no">{row.theirs.no}</span>
                            <span className="merge-line-code">
                              <Segments segs={row.theirs.segments} text={row.theirs.text} />
                            </span>
                            <span className="merge-insert">
                              <Icon name="plus" size={11} />
                            </span>
                          </>
                        ) : (
                          <span className="merge-line-no" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="merge-actions">
                  <button className="merge-quick" onClick={() => insertAll(index, "ours")}>
                    {t("useAllOurs")}
                  </button>
                  <button className="merge-quick" onClick={() => insertAll(index, "theirs")}>
                    {t("useAllTheirs")}
                  </button>
                  {c.base.length > 0 && (
                    <button
                      className="merge-quick"
                      onClick={() => setBaseOpen(baseOpen === index ? null : index)}
                    >
                      {baseOpen === index ? t("hideBase") : t("showBase")}
                    </button>
                  )}
                  <span className="spacer" />
                  <span className={cx("merge-state", isResolved ? "done" : "")}>
                    {isResolved ? t("resolved") : t("pending")}
                  </span>
                </div>
                {baseOpen === index && c.base.length > 0 && (
                  <div className="merge-base">
                    <div className="side-label">{t("commonAncestor")}</div>
                    <pre>{c.base.join("\n")}</pre>
                  </div>
                )}
                <div className="merge-result">
                  <div className="side-label">
                    {t("result")}
                    {isResolved && <Icon name="check" size={12} />}
                  </div>
                  <textarea
                    ref={(el) => {
                      editors.current[index] = el;
                    }}
                    className="conflict-editor merge-editor"
                    value={contents[index] ?? ""}
                    placeholder={t("resultPlaceholder")}
                    spellCheck={false}
                    rows={Math.min(8, Math.max(2, (contents[index] ?? "").split("\n").length))}
                    onChange={(e) => setConflictText(index, e.target.value, "custom")}
                  />
                </div>
              </div>
            );
          })}
          {conflicts.length === 0 && (
            <div className="diff-empty">
              <Icon name="check" size={22} />
              <div>{t("nothingToResolve")}</div>
            </div>
          )}
          <div className="merge-result-preview">
            <div className="side-label">
              {t("finalResult")} · {t("lines", { n: resultLines })}
            </div>
            <pre>{free ? freeText : result}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
