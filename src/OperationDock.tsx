import { useEffect, useRef } from "react";
import { Icon } from "./icons";
import { cx, Spinner } from "./ui";

/** A git operation streamed to the page while it runs. */
export interface OperationState {
  title: string;
  icon: "fetch" | "pull" | "push" | "commit" | "stash" | "reset" | "merge";
  lines: string[];
  running: boolean;
  error?: string;
  success?: string;
}

/**
 * OperationDock is the quiet counterpart of a progress dialog: one line of
 * status that expands into git's output on demand. It stays out of the way
 * so fetch and pull never take over the window.
 */
export function OperationDock({
  op,
  open,
  onToggle,
  onClose,
}: {
  op: OperationState;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const latest = op.lines.length > 0 ? op.lines[op.lines.length - 1] : "";
  const status = op.error ?? (op.running ? latest : (op.success ?? latest));

  // A finished operation clears itself unless its output is open: reading
  // the log must not be raced by the timer.
  useEffect(() => {
    if (op.running || op.error || open) return;
    const timer = window.setTimeout(() => closeRef.current(), 5000);
    return () => window.clearTimeout(timer);
  }, [op.running, op.error, op.success, open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [op.lines, open]);

  return (
    <section className={cx("op-dock", op.running && "running", op.error && "failed")} aria-live="polite">
      <button className="op-dock-head" onClick={onToggle} title={open ? "Hide output" : "Show output"}>
        {op.running ? <Spinner /> : <Icon name={op.error ? "error" : "check"} size={13} />}
        <span className="op-dock-title">{op.title}</span>
        <span className="op-dock-status">{status || "Starting…"}</span>
        <Icon name={open ? "chevronDown" : "chevronUp"} size={12} className="op-dock-chevron" />
      </button>
      {open && (
        <div className="op-dock-body">
          <pre className="op-dock-log" ref={logRef}>
            {op.lines.join("\n") || (op.running ? "Starting…" : "No output.")}
          </pre>
          <div className="op-dock-foot">
            <button
              className="op-dock-link"
              onClick={() => void navigator.clipboard.writeText(op.lines.join("\n"))}
            >
              <Icon name="copy" size={12} /> Copy
            </button>
            <span className="spacer" />
            {!op.running && (
              <button className="op-dock-link" onClick={onClose}>
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
