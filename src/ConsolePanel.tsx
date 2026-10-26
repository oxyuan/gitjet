import { useEffect, useRef, useState } from "react";
import { Channel } from "mygo-runtime";
import { Git, type Completion } from "./mygo";
import { Icon } from "./icons";
import { cx, IconButton, Spinner, useStoredState } from "./ui";
import { useT } from "./i18n";

const T = {
  en: {
    title: "Console",
    intro:
      "Console — runs the line as typed, in the repository root: git status, ls, pwd. Tab completes, ↑/↓ recalls history.",
    copyOutput: "Copy console output",
    clearConsole: "Clear console",
    openRepositoryFirst: "Open a repository first",
    exitCode: "exit code {code} · {ms} ms",
  },
  zh: {
    title: "控制台",
    intro: "控制台 — 命令按原样在仓库根目录执行：git status、ls、pwd 都可以。Tab 补全，↑/↓ 调出历史。",
    copyOutput: "复制控制台输出",
    clearConsole: "清空控制台",
    openRepositoryFirst: "请先打开仓库",
    exitCode: "退出码 {code} · {ms} 毫秒",
  },
} as const;

/** GREETING_ID marks the opening hint line, which is re-rendered in the
 *  current language instead of being stored as literal text. */
const GREETING_ID = 0;

interface ConsoleLine {
  id: number;
  kind: "command" | "output" | "error" | "info";
  text: string;
}

let nextId = 1;

export function ConsolePanel({ onCommandDone, repoOpen }: { onCommandDone: () => void; repoOpen: boolean }) {
  const t = useT(T);
  const [lines, setLines] = useState<ConsoleLine[]>([{ id: GREETING_ID, kind: "info", text: "" }]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useStoredState<string[]>("gitjet.console.history", []);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (completions.length === 0) return;
    const timer = setTimeout(() => setCompletions([]), 6000);
    return () => clearTimeout(timer);
  }, [completions]);

  const append = (kind: ConsoleLine["kind"], text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: nextId++, kind, text }];
      return next.length > 4000 ? next.slice(next.length - 4000) : next;
    });
  };

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const complete = async () => {
    if (!repoOpen) return;
    try {
      const list = await Git.completions(input);
      if (list.length === 0) return;
      setCompletions(list);
      setCompletionIndex(0);
    } catch {
      // Completion is best effort.
    }
  };

  const applyCompletion = (c: Completion) => {
    const i = input.lastIndexOf(" ");
    const head = i >= 0 ? input.slice(0, i + 1) : "";
    setInput(head + c.text + (c.kind === "command" ? " " : ""));
    setCompletions([]);
    inputRef.current?.focus();
  };

  const run = async (raw?: string) => {
    const command = (raw ?? input).trim();
    if (command === "" || running) return;
    append("command", command);
    setInput("");
    setCompletions([]);
    setHistory([command, ...history.filter((h) => h !== command)].slice(0, 100));
    setHistoryIndex(-1);
    setRunning(true);
    const channel = new Channel<string>();
    try {
      const promise = Git.console(command, channel);
      for await (const line of channel) {
        append("output", line);
      }
      const result = await promise;
      if (result.exitCode !== 0) {
        append("error", t("exitCode", { code: result.exitCode, ms: result.duration }));
      }
      onCommandDone();
    } catch (err) {
      append("error", err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  };

  const moveHistory = (delta: number) => {
    if (history.length === 0) return;
    let idx = historyIndex;
    if (idx === -1) idx = delta > 0 ? 0 : history.length - 1;
    else idx = Math.max(0, Math.min(history.length - 1, idx + delta));
    setHistoryIndex(idx);
    setInput(history[idx] ?? "");
  };

  return (
    <div className="console-panel">
      <div className="panel-toolbar">
        <span className="console-title">
          <Icon name="console" /> {t("title")}
        </span>
        <span className="spacer" />
        <IconButton
          icon="copy"
          title={t("copyOutput")}
          small
          onClick={() => {
            void navigator.clipboard.writeText(
              lines.map((l) => (l.id === GREETING_ID ? t("intro") : l.text)).join("\n"),
            );
          }}
        />
        <IconButton icon="trash" title={t("clearConsole")} small onClick={() => setLines([])} />
      </div>
      <div className="console-output" ref={outputRef} onClick={() => inputRef.current?.focus()}>
        {lines.map((line) => (
          <div className={cx("console-line", line.kind)} key={line.id}>
            {line.kind === "command" ? <span className="console-prompt-inline">$</span> : null}
            <span className="console-text">{line.id === GREETING_ID ? t("intro") : line.text || "\u00a0"}</span>
          </div>
        ))}
        {running && (
          <div className="console-line info">
            <Spinner />
          </div>
        )}
      </div>
      <div className="console-input-row">
        <span className="console-prompt">$</span>
        <input
          ref={inputRef}
          className="console-input"
          value={input}
          disabled={!repoOpen || running}
          placeholder={repoOpen ? "git status" : t("openRepositoryFirst")}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (completions.length > 0) {
                applyCompletion(completions[completionIndex]!);
                return;
              }
              void run();
            } else if (e.key === "Tab") {
              e.preventDefault();
              if (completions.length > 0) applyCompletion(completions[completionIndex]!);
              else void complete();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveHistory(1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              moveHistory(-1);
            } else if (e.key === "Escape") {
              setCompletions([]);
            } else if (e.key === "ArrowRight" && completions.length > 0) {
              e.preventDefault();
              setCompletionIndex((i) => (i + 1) % completions.length);
            } else if (e.key === "ArrowLeft" && completions.length > 0) {
              e.preventDefault();
              setCompletionIndex((i) => (i - 1 + completions.length) % completions.length);
            }
          }}
        />
      </div>
      {completions.length > 0 && (
        <div className="completions">
          {completions.slice(0, 12).map((c, i) => (
            <button
              key={c.text}
              className={cx("completion", i === completionIndex && "active")}
              onMouseDown={(e) => {
                e.preventDefault();
                applyCompletion(c);
              }}
            >
              <span className={`completion-kind kind-${c.kind}`}>{c.kind[0]!.toUpperCase()}</span>
              <span className="completion-text">{c.text}</span>
              <span className="completion-desc">{c.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
