import { useEffect, useRef } from "react";
import type { JournalEntry } from "./mygo";
import { cx } from "./ui";
import { useLang, useT, type Lang } from "./i18n";

const T = {
  en: {
    empty: "Nothing has run yet",
    emptyHint: "Pull, push, commits and console commands land here with everything they printed.",
    noRepo: "Open a repository first",
    cleared: "The view was cleared",
    clearedHint: "Every record is still in the log file.",
    showAll: "Show all records",
    openFile: "Show the log file",
    file: "Log file",
    unreadable: "The log could not be read",
    unnamed: "Operation",
    exit: "exit {code} · {ms} ms",
    neverRan: "did not run",
  },
  zh: {
    empty: "还没有操作记录",
    emptyHint: "Pull、Push、提交和控制台命令的执行过程都会完整记录在这里。",
    noRepo: "请先打开仓库",
    cleared: "已清除显示",
    clearedHint: "全部记录仍保留在日志文件中。",
    showAll: "显示全部记录",
    openFile: "打开日志文件",
    file: "日志文件",
    unreadable: "日志读取失败",
    unnamed: "操作",
    exit: "退出码 {code} · {ms} 毫秒",
    neverRan: "未执行",
  },
} as const;

/** ACTIONS names each action the back end journals, in both languages. */
const ACTIONS: Record<string, { en: string; zh: string }> = {
  console: { en: "Console", zh: "命令行" },
  pull: { en: "Pull", zh: "拉取" },
  push: { en: "Push", zh: "推送" },
  fetch: { en: "Fetch", zh: "获取" },
  commit: { en: "Commit", zh: "提交" },
  checkout: { en: "Checkout", zh: "切换分支" },
  merge: { en: "Merge", zh: "合并" },
  rebase: { en: "Rebase", zh: "变基" },
  "cherry-pick": { en: "Cherry-pick", zh: "拣选提交" },
  revert: { en: "Revert", zh: "还原提交" },
  reset: { en: "Reset", zh: "重置" },
  "stash-push": { en: "Stash", zh: "贮藏" },
  "stash-apply": { en: "Apply stash", zh: "应用贮藏" },
  "stash-pop": { en: "Pop stash", zh: "弹出贮藏" },
  "stash-drop": { en: "Drop stash", zh: "删除贮藏" },
  "stash-branch": { en: "Stash to branch", zh: "贮藏到分支" },
  abort: { en: "Abort operation", zh: "中止操作" },
  continue: { en: "Continue operation", zh: "继续操作" },
  rewrite: { en: "Rewrite history", zh: "改写历史" },
  "worktree-add": { en: "Add worktree", zh: "添加工作树" },
  "worktree-remove": { en: "Remove worktree", zh: "移除工作树" },
  "worktree-prune": { en: "Prune worktrees", zh: "清理工作树" },
  submodules: { en: "Update submodules", zh: "更新子模块" },
  unshallow: { en: "Unshallow", zh: "补齐浅克隆" },
};

function actionLabel(action: string, lang: Lang, fallback: string): string {
  const entry = ACTIONS[action];
  return entry ? entry[lang] : action === "" ? fallback : action;
}

/** stamp renders a journal time as MM-DD HH:MM:SS, independent of locale. */
function stamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** entryText is one entry as plain text, for copying out of the view. */
export function entryText(entry: JournalEntry, lang: Lang): string {
  const lines = [`${stamp(entry.at)}  ${actionLabel(entry.action, lang, "Operation")}`];
  if (entry.command) lines.push(`$ ${entry.command}`);
  for (const command of entry.commands ?? []) lines.push(`$ ${command}`);
  if (entry.output) lines.push(entry.output);
  lines.push(entry.error || `exit ${entry.exitCode ?? 0} · ${entry.duration ?? 0} ms`);
  return lines.join("\n");
}

/**
 * JournalView renders what the app has run, newest last. A cleared view is a
 * filter, not a deletion: the entries below it still exist in the log file.
 */
export function JournalView({
  entries,
  hidden,
  repoOpen,
  error,
  filePath,
  onShowAll,
  onOpenFile,
}: {
  entries: JournalEntry[];
  hidden: number;
  repoOpen: boolean;
  error: string;
  filePath: string;
  onShowAll: () => void;
  onOpenFile: () => void;
}) {
  const t = useT(T);
  const lang = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (first.current) {
      first.current = false;
      el.scrollTop = el.scrollHeight;
      return;
    }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (!repoOpen) {
    return (
      <div className="journal">
        <div className="journal-empty">{t("noRepo")}</div>
      </div>
    );
  }

  if (error !== "") {
    return (
      <div className="journal">
        <div className="journal-empty">
          <div>{t("unreadable")}</div>
          <div className="journal-empty-hint">{error}</div>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="journal">
        <div className="journal-empty">
          <div>{hidden > 0 ? t("cleared") : t("empty")}</div>
          <div className="journal-empty-hint">{hidden > 0 ? t("clearedHint") : t("emptyHint")}</div>
          {hidden > 0 && (
            <button type="button" className="journal-empty-btn" onClick={onShowAll}>
              {t("showAll")}
            </button>
          )}
          {filePath !== "" && (
            <button type="button" className="journal-file" onClick={onOpenFile} title={t("openFile")}>
              <span>{t("file")}</span>
              <code>{filePath}</code>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="journal" ref={ref}>
      {entries.map((entry) => {
        const failed = Boolean(entry.error);
        return (
          <div className={cx("journal-entry", failed && "failed")} key={entry.id}>
            <div className="journal-entry-head">
              <span className={cx("journal-action", failed && "failed")}>
                {actionLabel(entry.action, lang, t("unnamed"))}
              </span>
              <span className="journal-time">{stamp(entry.at)}</span>
              <span className="spacer" />
              <span className={cx("journal-meta", failed && "failed")}>
                {failed && entry.exitCode < 0
                  ? t("neverRan")
                  : t("exit", { code: entry.exitCode ?? 0, ms: entry.duration ?? 0 })}
              </span>
            </div>
            {entry.command && (
              <div className="journal-cmd">
                <span className="journal-prompt">$</span>
                <span>{entry.command}</span>
              </div>
            )}
            {(entry.commands ?? []).map((command, i) => (
              <div className="journal-cmd" key={`${entry.id}-${i}`}>
                <span className="journal-prompt">$</span>
                <span>{command}</span>
              </div>
            ))}
            {entry.output && <pre className="journal-out">{entry.output}</pre>}
            {failed && <div className="journal-error">{entry.error}</div>}
          </div>
        );
      })}
    </div>
  );
}
