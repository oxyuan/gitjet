import { useEffect, useMemo, useRef, useState } from "react";
import type { ConflictContent } from "./mygo";
import { wordDiff, type WordSegment } from "./diff";
import { Icon } from "./icons";
import { Button, cx, IconButton, Spinner } from "./ui";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "conflict"; ours: string[]; theirs: string[]; base: string[]; label: string };

type Choice = "ours" | "theirs" | "both" | "custom" | "none";

interface MergeRow {
  ours?: { no: number; text: string; segments?: WordSegment[] };
  theirs?: { no: number; text: string; segments?: WordSegment[] };
  same: boolean;
}

function parseConflicts(text: string): { segments: Segment[]; trailingNewline: boolean } {
  const trailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (trailingNewline) lines.pop();
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let ours: string[] | null = null;
  let theirs: string[] | null = null;
  let base: string[] | null = null;
  let mode: "none" | "ours" | "base" | "theirs" = "none";
  let label = "";
  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", text: buffer.join("\n") });
      buffer = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      flush();
      ours = [];
      theirs = null;
      base = null;
      mode = "ours";
      label = line.replace(/^<<<<<<<\s*/, "").trim();
    } else if (line.startsWith("|||||||") && mode === "ours") {
      base = [];
      mode = "base";
    } else if (line === "=======" && mode !== "none") {
      theirs = [];
      mode = "theirs";
    } else if (line.startsWith(">>>>>>>") && mode === "theirs" && ours && theirs) {
      segments.push({
        kind: "conflict",
        ours,
        theirs,
        base: base ?? [],
        label: label || line.replace(/^>>>>>>>\s*/, "").trim(),
      });
      ours = null;
      theirs = null;
      base = null;
      mode = "none";
    } else if (mode === "ours" && ours) ours.push(line);
    else if (mode === "base" && base) base.push(line);
    else if (mode === "theirs" && theirs) theirs.push(line);
    else buffer.push(line);
  }
  flush();
  return { segments, trailingNewline };
}

/** alignLines pairs the two sides of a conflict line by line, so changed
 *  lines face each other and can be reviewed and inserted individually. */
function alignLines(ours: string[], theirs: string[]): MergeRow[] {
  const rows: MergeRow[] = [];
  const n = Math.max(ours.length, theirs.length);
  for (let i = 0; i < n; i++) {
    const a = ours[i];
    const b = theirs[i];
    let left: MergeRow["ours"];
    let right: MergeRow["theirs"];
    if (a !== undefined) left = { no: i + 1, text: a };
    if (b !== undefined) right = { no: i + 1, text: b };
    if (a !== undefined && b !== undefined && a !== b) {
      const [leftSegs, rightSegs] = wordDiff(a, b);
      left = { ...left!, segments: leftSegs };
      right = { ...right!, segments: rightSegs };
    }
    rows.push({ ours: left, theirs: right, same: a === b });
  }
  return rows;
}

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
    () => segments.filter((s): s is Extract<Segment, { kind: "conflict" }> => s.kind === "conflict"),
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

  const assemble = (values: string[]) => {
    let index = 0;
    const parts = segments.map((seg) => (seg.kind === "text" ? seg.text : (values[index++] ?? "")));
    return parts.join("\n") + (trailingNewline ? "\n" : "");
  };

  // Keep resolved blocks and leave unresolved ones as markers, so switching
  // to whole-file editing never throws away work or hides a conflict.
  const assembleForFree = () => {
    let index = 0;
    const parts = segments.map((seg) => {
      if (seg.kind === "text") return seg.text;
      const i = index++;
      if (resolved[i]) return contents[i] ?? "";
      return `<<<<<<< ${seg.label}\n${seg.ours.join("\n")}\n=======\n${seg.theirs.join("\n")}\n>>>>>>> ${seg.label}`;
    });
    return parts.join("\n") + (trailingNewline ? "\n" : "");
  };

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
  const result = free ? freeText : assemble(contents);
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
                setFreeText(assembleForFree());
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
          {segments.map((seg, si) => {
            if (seg.kind === "text") {
              if (seg.text.trim() === "" && segments.length > 1) return null;
              return (
                <div className="merge-context" key={si}>
                  <pre>{seg.text}</pre>
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
          <div className="merge-hint">
            <Icon name="info" size={13} />
            Click any line on either side to add it to the result for that conflict, or choose
            Ours / Theirs / Both. Edit the result directly for anything finer.
          </div>
          {conflicts.length === 0 && (
            <div className="diff-empty">
              <Icon name="check" size={22} />
              <div>Nothing to resolve</div>
            </div>
          )}
          <div className="merge-result-preview">
            <div className="side-label">Final result · {result.split("\n").length} lines</div>
            <pre>{free ? freeText : result}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
