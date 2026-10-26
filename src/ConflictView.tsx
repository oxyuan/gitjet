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

type Choice = "ours" | "theirs" | "both" | "custom" | "none";

function Lines({ text }: { text: string }) {
  if (text === "") return <span className="muted">(empty)</span>;
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
}: {
  path: string;
  conflict: ConflictContent;
  busy: boolean;
  onSave: (content: string) => void;
  onMarkResolved: () => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onClose: () => void;
}) {
  const { segments, trailingNewline } = useMemo(() => parseConflicts(conflict.working), [conflict.working]);
  const conflicts = useMemo(
    () => segments.filter((s): s is ConflictSegment => s.kind === "conflict"),
    [segments],
  );
  const [contents, setContents] = useState<string[]>(() => conflicts.map(() => ""));
  const [resolved, setResolved] = useState<boolean[]>(() => conflicts.map(() => false));
  const [choices, setChoices] = useState<Choice[]>(() => conflicts.map(() => "none"));
  const [free, setFree] = useState(false);
  const [freeText, setFreeText] = useState(conflict.working);
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
  const hasMarkers = result.includes("<<<<<<<") || result.includes("=======") || result.includes(">>>>>>>");
  const canSave = !busy && !conflict.binary && (free ? !hasMarkers : unresolved === 0 && !hasMarkers);

  if (!conflict.working.includes("<<<<<<<")) {
    return (
      <div className="conflict-view">
        <div className="diff-header">
          <div className="diff-title-row">
            <span className="diff-status st-conflict">!</span>
            <span className="diff-path">{path}</span>
            <span className="muted">No conflict markers remain — choose a side or mark it resolved</span>
            <span className="spacer" />
            {busy && <Spinner />}
            <IconButton icon="close" title="Close" small onClick={onClose} />
          </div>
          <div className="diff-toolbar conflict-toolbar">
            <Button size="small" onClick={() => onTakeSide("ours")} disabled={!conflict.hasOurs || busy}>
              <Icon name="ours" /> Take Ours
            </Button>
            <Button size="small" onClick={() => onTakeSide("theirs")} disabled={!conflict.hasTheirs || busy}>
              <Icon name="theirs" /> Take Theirs
            </Button>
            <span className="toolbar-sep" />
            <Button size="small" onClick={onMarkResolved} disabled={busy}>
              <Icon name="check" /> Mark Resolved
            </Button>
          </div>
        </div>
        <div className="conflict-body">
          <div className="conflict-sides">
            <div className="conflict-side ours">
              <div className="side-label">Ours (HEAD)</div>
              <pre>
                <Lines text={conflict.ours} />
              </pre>
            </div>
            <div className="conflict-side theirs">
              <div className="side-label">Theirs</div>
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
            {unresolved === 0 ? "All conflicts resolved" : `${unresolved} unresolved`} · {conflicts.length}{" "}
            {conflicts.length === 1 ? "block" : "blocks"}
          </span>
          <span className="spacer" />
          {busy && <Spinner />}
          <IconButton icon="close" title="Close" small onClick={onClose} />
        </div>
        <div className="diff-toolbar merge-toolbar">
          <div className="segmented">
            <button className={cx("segmented-btn text", !free && "active")} onClick={() => setFree(false)}>
              Blocks
            </button>
            <button
              className={cx("segmented-btn text", free && "active")}
              onClick={() => {
                setFreeText(assembleFreeText(segments, contents, resolved, trailingNewline));
                setFree(true);
              }}
              title="Edit the complete result as one file"
            >
              Whole file
            </button>
          </div>
          {!free && conflicts.length > 0 && (
            <>
              <span className="toolbar-sep" />
              <IconButton icon="chevronUp" title="Previous conflict" small onClick={() => jump(-1)} />
              <IconButton icon="chevronDown" title="Next conflict" small onClick={() => jump(1)} />
              <span className="muted">
                {Math.min(current + 1, conflicts.length)} / {conflicts.length}
              </span>
            </>
          )}
          <span className="spacer" />
          {!free && conflicts.length > 0 && (
            <>
              <button className="toolbar-text-btn" onClick={() => conflicts.forEach((_, i) => useSide(i, "ours"))}>
                <Icon name="ours" /> All Ours
              </button>
              <button className="toolbar-text-btn" onClick={() => conflicts.forEach((_, i) => useSide(i, "theirs"))}>
                <Icon name="theirs" /> All Theirs
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
            <Icon name="copy" /> Copy result
          </button>
          <Button size="small" variant="primary" onClick={() => onSave(result)} disabled={!canSave}>
            <Icon name="check" /> Save Resolution
          </Button>
        </div>
      </div>

      {conflict.binary ? (
        <div className="diff-empty">
          <Icon name="warning" size={24} />
          <div>Binary conflict — choose a side</div>
        </div>
      ) : free ? (
        <div className="merge-free">
          <div className="side-label">
            Complete result
            {hasMarkers && <span className="muted"> — resolve every “{'<<<<<<<'}” marker before saving</span>}
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
            <span>
              Click any line beside a conflict to add it to the result, or choose Ours / Theirs / Both.
              The result is editable, so you can adjust it line by line.
            </span>
          </div>
          {segments.map((seg, si) => {
            if (seg.kind === "text") {
              const count = seg.text === "" ? 0 : seg.text.split("\n").length;
              if (count === 0) return null;
              return (
                <div className="merge-unchanged" key={si}>
                  <span>{count} unchanged line{count === 1 ? "" : "s"}</span>
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
                  <span className="merge-title">Conflict {index + 1}</span>
                  {c.label && <span className="muted">({c.label})</span>}
                  <span className="spacer" />
                  <div className="segmented">
                    {(["ours", "theirs", "both"] as const).map((side) => (
                      <button
                        key={side}
                        className={cx("segmented-btn text", choices[index] === side && "active")}
                        onClick={() => useSide(index, side)}
                      >
                        {side === "ours" ? "Ours" : side === "theirs" ? "Theirs" : "Both"}
                      </button>
                    ))}
                  </div>
                  <IconButton
                    icon="undo"
                    title="Reset this conflict"
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
                    <span>Ours (HEAD)</span>
                    <span>Theirs</span>
                  </div>
                  {rows.map((row, ri) => (
                    <div className="merge-row" key={ri}>
                      <button
                        className={cx("merge-cell ours", !row.ours && "empty")}
                        disabled={!row.ours}
                        title={row.ours ? "Insert this line from Ours" : undefined}
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
                        title={row.theirs ? "Insert this line from Theirs" : undefined}
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
                    Use all Ours
                  </button>
                  <button className="merge-quick" onClick={() => insertAll(index, "theirs")}>
                    Use all Theirs
                  </button>
                  {c.base.length > 0 && (
                    <button
                      className="merge-quick"
                      onClick={() => setBaseOpen(baseOpen === index ? null : index)}
                    >
                      {baseOpen === index ? "Hide base" : "Show base"}
                    </button>
                  )}
                  <span className="spacer" />
                  <span className={cx("merge-state", isResolved ? "done" : "")}>
                    {isResolved ? "resolved" : "pending"}
                  </span>
                </div>
                {baseOpen === index && c.base.length > 0 && (
                  <div className="merge-base">
                    <div className="side-label">Common ancestor</div>
                    <pre>{c.base.join("\n")}</pre>
                  </div>
                )}
                <div className="merge-result">
                  <div className="side-label">
                    Result
                    {isResolved && <Icon name="check" size={12} />}
                  </div>
                  <textarea
                    ref={(el) => {
                      editors.current[index] = el;
                    }}
                    className="conflict-editor merge-editor"
                    value={contents[index] ?? ""}
                    placeholder="Choose Ours, Theirs or Both, click lines above to insert them, or type the merged code here."
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
              <div>Nothing to resolve</div>
            </div>
          )}
          <div className="merge-result-preview">
            <div className="side-label">
              Final result ·{" "}
              {(result.endsWith("\n") ? result.split("\n").length - 1 : result.split("\n").length)} lines
            </div>
            <pre>{free ? freeText : result}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
