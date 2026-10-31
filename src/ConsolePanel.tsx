import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "mygo-runtime";
import { events, Git, type Completion, type JournalEntry } from "./mygo";
import { commandLine, completionPrefix, CONSOLE_PROGRAMS, rememberLine, splitCommand } from "./console";
import { Icon } from "./icons";
import { entryText, JournalView } from "./JournalView";
import { cx, IconButton, Spinner, useStoredState } from "./ui";
import { useLang, useT } from "./i18n";

const T = {
  en: {
    title: "Console",
    program: "Command program",
    introTitle: "How it works",
    hintPrefix: "The {program} chip is prepended: `status` runs `{program} status`.",
    hintShell: "Start with `!` to run another program as typed: `!ls -la`.",
    hintKeys: "Tab completes · ↑/↓ recalls history · click the chip to switch programs.",
    copyOutput: "Copy console output",
    copyLog: "Copy the recorded log",
    clearConsole: "Clear the console view (records are kept)",
    clearLog: "Clear the log view (records are kept)",
    logView: "Log",
    logHint: "Everything the app has run, with its full output",
    views: "Console views",
    revealJournal: "Open the log file",
    revealFailed: "The log file could not be opened",
    openRepositoryFirst: "Open a repository first",
    exitCode: "exit {code} · {ms} ms",
    noOutput: "No output",
    running: "Running",
  },
  zh: {
    title: "控制台",
    program: "命令前缀",
    introTitle: "使用提示",
    hintPrefix: "输入会自动加上前缀 `{program}`，例如 `status` 实际执行 `{program} status`。",
    hintShell: "以 `!` 开头按原样运行其他程序，例如 `!ls -la`。",
    hintKeys: "Tab 补全 · ↑/↓ 翻历史 · 点击左侧标签切换前缀程序。",
    copyOutput: "复制控制台输出",
    copyLog: "复制日志记录",
    clearConsole: "清空控制台显示（记录仍保留）",
    clearLog: "清除日志显示（记录仍保留）",
    logView: "日志",
    logHint: "软件执行过的全部操作及其完整输出",
    views: "控制台视图",
    revealJournal: "打开日志文件",
    revealFailed: "日志文件无法打开",
    openRepositoryFirst: "请先打开仓库",
    exitCode: "退出码 {code} · {ms} 毫秒",
    noOutput: "没有输出",
    running: "运行中",
  },
} as const;

/** INTRO_ID marks the opening hint block, which is re-rendered in the current
 *  language instead of being stored as literal text. */
const INTRO_ID = "intro";

/** Output is capped per block: a runaway build keeps the newest lines. */
const MAX_LINES = 4000;
/** Blocks older than this fall off the top, so a long session stays light. */
const MAX_BLOCKS = 200;

interface IntroBlock {
  id: string;
  kind: "intro";
}

interface RunBlock {
  id: string;
  kind: "run";
  /** The complete line that ran, program included. */
  command: string;
  /** A bang line, whose prompt is "$" rather than the program name. */
  shell: boolean;
  lines: string[];
  running: boolean;
  exitCode?: number;
  duration?: number;
  error?: string;
}

type ConsoleBlock = IntroBlock | RunBlock;

type ConsoleView = "log" | "console";

export function ConsolePanel({
  onCommandDone,
  repoOpen,
  repoKey,
  notify,
}: {
  onCommandDone: () => void;
  repoOpen: boolean;
  repoKey: string;
  notify: (kind: "info" | "success" | "error", title: string, message?: string) => void;
}) {
  const t = useT(T);
  const lang = useLang();
  // Entering the tab shows what the app has run; the command line is a click
  // away, so it is not the default.
  const [view, setView] = useState<ConsoleView>("log");
  const [blocks, setBlocks] = useState<ConsoleBlock[]>([{ id: INTRO_ID, kind: "intro" }]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [journalError, setJournalError] = useState("");
  const [journalPath, setJournalPath] = useState("");
  // Clearing a view is a watermark, never a deletion: the journal file keeps
  // every record and newer entries keep appearing.
  const [logClearedAt, setLogClearedAt] = useStoredState<number>(`gitjet.console.logCleared:${repoKey}`, 0);
  const [consoleClearedAt, setConsoleClearedAt] = useStoredState<number>(`gitjet.console.cleared:${repoKey}`, 0);
  const [input, setInput] = useState("");
  const [program, setProgram] = useStoredState<string>("gitjet.console.program", "git");
  // History is per program: a line recalled while mvn is selected must not
  // become `git ...` because the console used to only know git.
  const [storedHistory, setStoredHistory] = useStoredState<Record<string, string[]> | string[]>(
    "gitjet.console.history",
    {},
  );
  const historyByProgram = Array.isArray(storedHistory) ? { git: storedHistory } : storedHistory;
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [programMenu, setProgramMenu] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Block ids belong to this mount, so a fast refresh cannot collide with a
  // preserved block list.
  const nextId = useRef(1);
  const seeded = useRef(false);

  const activeProgram = CONSOLE_PROGRAMS.find((p) => p === program) ?? "git";
  const history = historyByProgram[activeProgram] ?? [];

  const remember = (line: string) => {
    setStoredHistory(rememberLine(historyByProgram, activeProgram, line));
  };

  // The journal is the source of truth for both views: the log renders it and
  // the command view is rebuilt from it, so switching tabs no longer loses
  // what was printed.
  const loadJournal = useCallback(
    async (seed: boolean) => {
      if (!repoOpen) {
        setJournal([]);
        setJournalError("");
        return;
      }
      try {
        const list = await Git.journal(500);
        setJournal(list);
        setJournalError("");
        if (!seed || seeded.current) return;
        seeded.current = true;
        const runs = list.filter(
          (entry) => entry.source === "console" && entry.command !== "" && entry.at > consoleClearedAt,
        );
        if (runs.length === 0) return;
        setBlocks([
          { id: INTRO_ID, kind: "intro" },
          ...runs.slice(-MAX_BLOCKS).map((entry) => ({
            id: entry.id,
            kind: "run" as const,
            command: entry.command,
            shell: false,
            lines: entry.output === "" ? [] : entry.output.split("\n"),
            running: false,
            exitCode: entry.exitCode,
            duration: entry.duration,
            error: entry.error === "" ? undefined : entry.error,
          })),
        ]);
      } catch (err) {
        setJournalError(err instanceof Error ? err.message : String(err));
      }
    },
    [repoOpen, consoleClearedAt],
  );

  useEffect(() => {
    void loadJournal(true);
  }, [loadJournal]);

  // Every operation notifies when it finishes; the journal is written before
  // the notification leaves, so a short debounce reads the new entry.
  useEffect(() => {
    if (!repoOpen) return;
    let timer: number | undefined;
    const off = events.repoChanged.on(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadJournal(false), 250);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [repoOpen, loadJournal]);

  useEffect(() => {
    if (!repoOpen) {
      setJournalPath("");
      return;
    }
    let alive = true;
    Git.journalFile()
      .then((path) => {
        if (alive) setJournalPath(path);
      })
      .catch(() => {
        if (alive) setJournalPath("");
      });
    return () => {
      alive = false;
    };
  }, [repoOpen]);

  useEffect(() => {
    if (view === "console") inputRef.current?.focus();
  }, [view]);

  const logEntries = useMemo(() => journal.filter((entry) => entry.at > logClearedAt), [journal, logClearedAt]);

  useEffect(() => {
    if (completions.length === 0) return;
    const timer = setTimeout(() => setCompletions([]), 6000);
    return () => clearTimeout(timer);
  }, [completions]);

  // The selected program owns the keyboard while the picker is open.
  useEffect(() => {
    if (!programMenu) return;
    menuRef.current?.querySelector<HTMLButtonElement>(".console-program-option.active")?.focus();
  }, [programMenu]);

  useEffect(() => {
    if (!programMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || chipRef.current?.contains(target)) return;
      setProgramMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [programMenu]);

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  const appendLine = (id: string, text: string) => {
    setBlocks((prev) =>
      prev.map((block) => {
        if (block.id !== id || block.kind !== "run") return block;
        const lines = [...block.lines, text];
        return { ...block, lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines };
      }),
    );
  };

  const finish = (id: string, patch: Partial<RunBlock>) => {
    setBlocks((prev) =>
      prev.map((block) => (block.id === id && block.kind === "run" ? { ...block, ...patch, running: false } : block)),
    );
  };

  const chooseProgram = (name: string) => {
    setProgram(name);
    setHistoryIndex(-1);
    setProgramMenu(false);
    // Picking a program is a step towards typing a command, so the caret
    // belongs in the command field, not on the menu button.
    inputRef.current?.focus();
  };

  const toggleProgramMenu = () => {
    if (programMenu) {
      setProgramMenu(false);
      inputRef.current?.focus();
      return;
    }
    setCompletions([]);
    setProgramMenu(true);
  };

  const moveProgramFocus = (delta: number) => {
    const options = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(".console-program-option") ?? [],
    );
    if (options.length === 0) return;
    const current = options.findIndex((option) => option === document.activeElement);
    const next = current < 0 ? 0 : (current + delta + options.length) % options.length;
    options[next]?.focus();
  };

  const complete = async () => {
    if (!repoOpen) return;
    const prefix = completionPrefix(input, activeProgram);
    if (prefix === "") return;
    try {
      const list = await Git.completions(prefix);
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
    const typed = (raw ?? input).trim();
    if (typed === "" || running) return;
    const shell = typed.startsWith("!");
    const command = commandLine(typed, activeProgram);
    if (command === "") return;
    const id = `local-${nextId.current++}`;
    setBlocks((prev) => {
      // The hint card is an empty-state, not a permanent header: once a
      // command runs, the whole area belongs to the command history.
      const next: ConsoleBlock[] = [
        ...prev.filter((block) => block.kind !== "intro"),
        { id, kind: "run", command, shell, lines: [], running: true },
      ];
      return next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next;
    });
    setInput("");
    setCompletions([]);
    remember(typed);
    setHistoryIndex(-1);
    setRunning(true);
    const channel = new Channel<string>();
    try {
      const promise = Git.console(command, channel);
      for await (const line of channel) {
        appendLine(id, line);
      }
      const result = await promise;
      finish(id, { exitCode: result.exitCode, duration: result.duration });
      onCommandDone();
    } catch (err) {
      finish(id, { error: err instanceof Error ? err.message : String(err) });
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

  const introText = () =>
    [
      t("introTitle"),
      `- ${t("hintPrefix", { program: activeProgram })}`,
      `- ${t("hintShell")}`,
      `- ${t("hintKeys")}`,
    ].join("\n");

  const blockText = (block: ConsoleBlock): string => {
    if (block.kind === "intro") return introText();
    const { head, rest } = splitCommand(block.command);
    const prompt = block.shell ? `$ ${block.command}` : `${head} ${rest}`.trim();
    const status = block.error
      ? block.error
      : block.exitCode !== undefined
        ? `[${t("exitCode", { code: block.exitCode, ms: block.duration ?? 0 })}]`
        : "";
    return [prompt, ...block.lines, status].filter((line) => line !== "").join("\n");
  };

  const revealJournal = async () => {
    try {
      const path = await Git.revealJournal();
      setJournalPath(path);
      notify("info", t("revealJournal"), path);
    } catch (err) {
      notify("error", t("revealFailed"), err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="console-panel">
      <div className="panel-toolbar">
        <div className="console-views" role="tablist" aria-label={t("views")}>
          <button
            type="button"
            role="tab"
            aria-selected={view === "log"}
            className={cx("console-view-tab", view === "log" && "active")}
            title={t("logHint")}
            onClick={() => setView("log")}
          >
            <Icon name="log" />
            {t("logView")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "console"}
            className={cx("console-view-tab", view === "console" && "active")}
            title={t("hintKeys")}
            onClick={() => setView("console")}
          >
            <Icon name="console" />
            {t("title")}
          </button>
        </div>
        <span className="spacer" />
        <IconButton
          icon="copy"
          title={view === "log" ? t("copyLog") : t("copyOutput")}
          small
          onClick={() => {
            const text =
              view === "log"
                ? logEntries.map((entry) => entryText(entry, lang)).join("\n\n")
                : blocks.map(blockText).join("\n\n");
            if (text !== "") void navigator.clipboard.writeText(text);
          }}
        />
        <IconButton
          icon="file"
          title={t("revealJournal")}
          small
          disabled={!repoOpen}
          onClick={() => void revealJournal()}
        />
        <IconButton
          icon="trash"
          title={view === "log" ? t("clearLog") : t("clearConsole")}
          small
          onClick={() => {
            if (view === "log") {
              setLogClearedAt(Date.now());
              return;
            }
            setBlocks([{ id: INTRO_ID, kind: "intro" }]);
            setConsoleClearedAt(Date.now());
            setProgramMenu(false);
            inputRef.current?.focus();
          }}
        />
      </div>
      {view === "log" ? (
        <JournalView
          entries={logEntries}
          hidden={journal.length - logEntries.length}
          repoOpen={repoOpen}
          error={journalError}
          filePath={journalPath}
          onShowAll={() => setLogClearedAt(0)}
          onOpenFile={() => void revealJournal()}
        />
      ) : (
        <>
      <div className="console-output" ref={outputRef} onClick={() => inputRef.current?.focus()}>
        {blocks.map((block) => {
          if (block.kind === "intro") {
            return (
              <div className="console-intro" key={block.id}>
                <div className="console-intro-title">{t("introTitle")}</div>
                <ul className="console-intro-list">
                  <li>{t("hintPrefix", { program: activeProgram })}</li>
                  <li>{t("hintShell")}</li>
                  <li>{t("hintKeys")}</li>
                </ul>
              </div>
            );
          }
          const { head, rest } = splitCommand(block.command);
          const failed = block.error !== undefined || (block.exitCode !== undefined && block.exitCode !== 0);
          return (
            <div className={cx("console-block", block.running && "running", failed && "failed")} key={block.id}>
              <div className="console-block-head">
                <span className={cx("console-block-prompt", block.shell && "shell")}>
                  {block.shell ? "$" : head}
                </span>
                <span className="console-block-cmd">{block.shell ? block.command : rest}</span>
                <span className="spacer" />
                {block.running ? (
                  <span className="console-block-meta">
                    <Spinner /> {t("running")}
                  </span>
                ) : block.exitCode !== undefined ? (
                  <span className={cx("console-block-meta", failed && "failed")}>
                    {t("exitCode", { code: block.exitCode, ms: block.duration ?? 0 })}
                  </span>
                ) : null}
              </div>
              {block.lines.length > 0 && (
                <pre className="console-block-out">{block.lines.join("\n")}</pre>
              )}
              {!block.running && block.lines.length === 0 && block.error === undefined && (
                <div className="console-block-empty">{t("noOutput")}</div>
              )}
              {block.error !== undefined && <div className="console-block-error">{block.error}</div>}
            </div>
          );
        })}
      </div>
      <div className="console-input-row">
        {input.startsWith("!") ? (
          <span className="console-prompt shell">$</span>
        ) : (
          <button
            ref={chipRef}
            type="button"
            className={cx("console-program", programMenu && "open")}
            title={t("program")}
            aria-label={t("program")}
            aria-haspopup="menu"
            aria-expanded={programMenu}
            disabled={!repoOpen || running}
            onClick={toggleProgramMenu}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setCompletions([]);
                setProgramMenu(true);
              }
            }}
          >
            {activeProgram}
          </button>
        )}
        <input
          ref={inputRef}
          className="console-input"
          value={input}
          // A console must keep what was typed: WebKit's sentence
          // capitalisation would turn "status" into "Status".
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          disabled={!repoOpen || running}
          placeholder={repoOpen ? undefined : t("openRepositoryFirst")}
          onChange={(e) => {
            setInput(e.target.value);
            if (programMenu) setProgramMenu(false);
          }}
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
      {programMenu && (
        <div
          className="console-program-menu"
          ref={menuRef}
          role="menu"
          aria-label={t("program")}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setProgramMenu(false);
              inputRef.current?.focus();
            } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
              e.preventDefault();
              moveProgramFocus(1);
            } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
              e.preventDefault();
              moveProgramFocus(-1);
            } else if (e.key === "Tab") {
              e.preventDefault();
              setProgramMenu(false);
              (e.shiftKey ? chipRef.current : inputRef.current)?.focus();
            }
          }}
        >
          <div className="console-program-menu-head">
            <span>{t("program")}</span>
            <kbd>esc</kbd>
          </div>
          <div className="console-program-grid">
            {CONSOLE_PROGRAMS.map((name) => (
              <button
                key={name}
                type="button"
                role="menuitemradio"
                aria-checked={name === activeProgram}
                className={cx("console-program-option", name === activeProgram && "active")}
                onClick={() => chooseProgram(name)}
              >
                <span className="console-program-name">{name}</span>
                {name === activeProgram && <Icon name="check" size={10} />}
              </button>
            ))}
          </div>
        </div>
      )}
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
        </>
      )}
    </div>
  );
}
