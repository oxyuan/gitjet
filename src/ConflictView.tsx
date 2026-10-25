import { useMemo, useState } from "react";
import type { ConflictContent } from "./mygo";
import { Icon } from "./icons";
import { Button, cx, IconButton, Spinner } from "./ui";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "conflict"; ours: string; theirs: string; base: string; label: string };

function parseConflicts(text: string): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let ours: string[] | null = null;
  let theirs: string[] | null = null;
  let base: string[] | null = null;
  let mode: "none" | "ours" | "base" | "theirs" = "none";
  let label = "";
  const flushText = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", text: buffer.join("\n") });
      buffer = [];
    }
  };
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      flushText();
      ours = [];
      theirs = null;
      base = null;
      mode = "ours";
      label = line.replace(/^<<<<<<<\s*/, "").trim();
    } else if (line.startsWith("|||||||") && mode === "ours") {
      base = [];
      mode = "base";
    } else if (line === "=======" && mode !== "none") {
      if (base) {
        theirs = [];
        mode = "theirs";
      } else {
        theirs = [];
        mode = "theirs";
      }
    } else if (line.startsWith(">>>>>>>") && mode === "theirs" && ours && theirs) {
      segments.push({
        kind: "conflict",
        ours: ours.join("\n"),
        theirs: theirs.join("\n"),
        base: (base ?? []).join("\n"),
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
  flushText();
  return segments;
}

export function ConflictView({
  path,
  conflict,
  busy,
  onSave,
  onTakeSide,
  onMarkResolved,
  onClose,
}: {
  path: string;
  conflict: ConflictContent;
  busy: boolean;
  onSave: (content: string) => void;
  onTakeSide: (side: "ours" | "theirs") => void;
  onMarkResolved: () => void;
  onClose: () => void;
}) {
  const segments = useMemo(() => parseConflicts(conflict.working), [conflict.working]);
  const conflicts = segments.filter((s): s is Extract<Segment, { kind: "conflict" }> => s.kind === "conflict");
  const [choices, setChoices] = useState<("ours" | "theirs" | "both" | "manual")[]>(
    conflicts.map(() => "manual"),
  );
  const [result, setResult] = useState(conflict.working);
  const [manual, setManual] = useState(false);

  const applyChoices = (next: typeof choices) => {
    setChoices(next);
    setManual(false);
    let index = 0;
    const parts = segments.map((seg) => {
      if (seg.kind === "text") return seg.text;
      const choice = next[index++] ?? "manual";
      if (choice === "ours") return seg.ours;
      if (choice === "theirs") return seg.theirs;
      if (choice === "both") return [seg.ours, seg.theirs].filter(Boolean).join("\n");
      return `<<<<<<< ${seg.label}\n${seg.ours}\n=======\n${seg.theirs}\n>>>>>>> ${seg.label}`;
    });
    setResult(parts.join("\n"));
  };

  const hasMarkers = conflicts.length > 0;
  const unresolved = !manual && choices.some((c) => c === "manual") && hasMarkers;

  return (
    <div className="conflict-view">
      <div className="diff-header">
        <div className="diff-title-row">
          <span className="diff-status st-conflict">!</span>
          <span className="diff-path">{path}</span>
          <span className="muted">{hasMarkers ? `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}` : "delete/modify conflict"}</span>
          <span className="spacer" />
          {busy && <Spinner />}
          <IconButton icon="close" title="Close" small onClick={onClose} />
        </div>
        <div className="diff-toolbar conflict-toolbar">
          <Button size="small" onClick={() => onTakeSide("ours")} disabled={!conflict.hasOurs || busy}>
            <Icon name="ours" /> Accept Ours
          </Button>
          <Button size="small" onClick={() => onTakeSide("theirs")} disabled={!conflict.hasTheirs || busy}>
            <Icon name="theirs" /> Accept Theirs
          </Button>
          <span className="toolbar-sep" />
          <Button size="small" onClick={() => onSave(result)} disabled={busy}>
            <Icon name="check" /> Save Resolution
          </Button>
          <Button size="small" onClick={onMarkResolved} disabled={busy}>
            Mark Resolved
          </Button>
          <span className="spacer" />
          {result.includes("<<<<<<<") && <span className="conflict-warning">Conflict markers remain</span>}
        </div>
      </div>
      {conflict.binary ? (
        <div className="diff-empty">
          <Icon name="warning" size={24} />
          <div>Binary conflict — choose a side</div>
        </div>
      ) : (
        <div className="conflict-body">
          {hasMarkers && (
            <div className="conflict-cards">
              {segments.map((seg, i) => {
                if (seg.kind === "text") return null;
                const conflictIndex = segments.slice(0, i).filter((s) => s.kind === "conflict").length;
                const choice = choices[conflictIndex] ?? "manual";
                return (
                  <div className="conflict-card" key={i}>
                    <div className="conflict-card-header">
                      <Icon name="warning" />
                      <span>Conflict {conflictIndex + 1}</span>
                      {seg.label && <span className="muted">({seg.label})</span>}
                      <span className="spacer" />
                      <div className="segmented">
                        {(["ours", "theirs", "both", "manual"] as const).map((c) => (
                          <button
                            key={c}
                            className={cx("segmented-btn text", choice === c && "active")}
                            onClick={() => {
                              const next = [...choices];
                              next[conflictIndex] = c;
                              applyChoices(next);
                            }}
                          >
                            {c === "both" ? "Both" : c === "manual" ? "Edit" : c === "ours" ? "Ours" : "Theirs"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="conflict-sides">
                      <div className={cx("conflict-side ours", choice === "ours" && "chosen")}>
                        <div className="side-label">Ours (HEAD)</div>
                        <pre>{seg.ours || "(empty)"}</pre>
                      </div>
                      <div className={cx("conflict-side theirs", choice === "theirs" && "chosen")}>
                        <div className="side-label">Theirs</div>
                        <pre>{seg.theirs || "(empty)"}</pre>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!hasMarkers && (
            <div className="conflict-sides">
              <div className="conflict-side ours">
                <div className="side-label">Ours (HEAD)</div>
                <pre>{conflict.ours || "(empty)"}</pre>
              </div>
              <div className="conflict-side theirs">
                <div className="side-label">Theirs</div>
                <pre>{conflict.theirs || "(empty)"}</pre>
              </div>
            </div>
          )}
          <div className="conflict-result">
            <div className="side-label">
              Result
              {unresolved && <span className="muted"> — choose a side for every conflict or edit the result</span>}
            </div>
            <textarea
              className="conflict-editor"
              value={result}
              spellCheck={false}
              onChange={(e) => {
                setResult(e.target.value);
                setManual(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
