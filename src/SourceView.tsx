import { useMemo, useState } from "react";
import type { SourceFile } from "./mygo";
import { SourceEditor } from "./SourceEditor";
import { Icon } from "./icons";
import { cx, formatWhen, IconButton } from "./ui";
import { PathCopyButton } from "./PathCopy";
import { useT } from "./i18n";

const T = {
  en: {
    workingTree: "Working Tree",
    index: "Index",
    deletedInWorktree: "deleted in working tree",
    meta: "{language} · {lines} · {size}",
    lines: "{n} lines",
    openHead: "Open the HEAD version",
    openWorkingTree: "Open the working tree version",
    workingTreeButton: "Working Tree",
    showDiff: "Show this file as a diff",
    diff: "Diff",
    annotateFile: "Annotate this file",
    annotate: "Annotate",

    revealInManager: "Reveal in file manager",
    wrap: "Wrap",
    truncated: "File truncated at 8 MB",
    binaryFile: "Binary file — no text to show",
    emptyFile: "Empty file",
    missingFile: "File does not exist in this revision",
    addedHere: "Changed here — click to roll this block back",
    deletedHere: "Deleted here — click to roll this back",
    blameUncommitted: "You · uncommitted",
  },
  zh: {
    workingTree: "工作区",
    index: "暂存区",
    deletedInWorktree: "工作区中已删除",
    meta: "{language} · {lines} · {size}",
    lines: "{n} 行",
    openHead: "打开 HEAD 版本",
    openWorkingTree: "打开工作区版本",
    workingTreeButton: "工作区",
    showDiff: "以差异方式显示此文件",
    diff: "差异",
    annotateFile: "Blame 此文件",
    annotate: "Blame",

    revealInManager: "在文件管理器中显示",
    wrap: "折行",
    truncated: "文件已截断至 8 MB",
    binaryFile: "二进制文件 — 无文本可显示",
    emptyFile: "空文件",
    missingFile: "此版本中不存在该文件",
    addedHere: "此处的修改 — 点击回滚这一块",
    deletedHere: "此处有删除 — 点击回滚",
    blameUncommitted: "你 · 未提交",
  },
} as const;

type Translate = (key: keyof typeof T["en"], vars?: Record<string, string | number>) => string;

function revisionLabel(revision: string, t: Translate): string {
  if (revision === "") return t("workingTree");
  if (revision === "INDEX") return t("index");
  if (/^[0-9a-f]{7,40}$/i.test(revision)) return revision.slice(0, 8);
  return revision;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** SourceView shows a file's actual contents, not a diff, so a review can
 *  read the code as it is. */
export function SourceView({
  file,
  line,
  root,
  onShowDiff,
  onBlame,
  onOpenWorkingTree,
  onOpenRevision,
  onCopyPath,
  onReveal,
  onRollbackHunk,
  onSymbol,
  onJump,
  onReferences,
  onLineHistory,
  onCommitDiff,
}: {
  file: SourceFile;
  /** 1-based line to put the cursor on, for a jump from another file. */
  line?: number;
  /** Absolute path of the repository, for the copy menu's absolute entries. */
  root: string;
  onShowDiff?: () => void;
  onBlame?: () => void;
  onOpenWorkingTree?: () => void;
  onOpenRevision?: () => void;
  onCopyPath: (text: string) => void;
  onReveal?: () => void;
  onRollbackHunk?: (hunk: number) => void;
  onSymbol?: (word: string) => void;
  onJump?: (word: string) => void;
  onReferences?: (word: string) => void;
  /** The gutter menu's "history of this line". */
  onLineHistory?: (line: number) => void;
  /** The gutter menu's diff of the commit that last touched the line. */
  onCommitDiff?: (hash: string) => void;
}) {
  const t = useT(T);
  const [wrap, setWrap] = useState(false);
  // The line the menu offers alongside the path: where the caret is.
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const lines = useMemo(() => {
    if (file.text === "") return [];
    const normalized = file.text.replace(/\r\n/g, "\n");
    const split = normalized.split("\n");
    if (split.length > 0 && split[split.length - 1] === "") split.pop();
    return split;
  }, [file.text]);

  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
  const name = file.path.slice(dir.length);
  const revision = revisionLabel(file.revision, t);

  return (
    <div className="source-view">
      <div className="diff-header source-header">
        <div className="diff-title-row">
          <span className={cx("source-kind", file.exists ? "" : "deleted")}>
            <Icon name="file" />
          </span>
          <span className="diff-path source-path">
            <span className="path-dir">{dir}</span>
            <span className="path-name">{name}</span>
          </span>
          <span className={cx("revision-chip", file.revision === "" ? "working" : "")}>{revision}</span>
          {!file.exists && <span className="deleted-badge">{t("deletedInWorktree")}</span>}
          <span className="muted source-meta">
            {t("meta", {
              language: file.language,
              lines: t("lines", { n: lines.length }),
              size: formatSize(file.size),
            })}
          </span>
          <span className="spacer" />
          {file.revision === "" && onOpenRevision && (
            <button className="toolbar-text-btn" onClick={onOpenRevision} title={t("openHead")}>
              <Icon name="hash" /> HEAD
            </button>
          )}
          {file.revision !== "" && onOpenWorkingTree && (
            <button className="toolbar-text-btn" onClick={onOpenWorkingTree} title={t("openWorkingTree")}>
              <Icon name="edit" /> {t("workingTreeButton")}
            </button>
          )}
          {onShowDiff && (
            <button className="toolbar-text-btn" onClick={onShowDiff} title={t("showDiff")}>
              <Icon name="diff" /> {t("diff")}
            </button>
          )}
          {onBlame && file.revision === "" && (
            <button className="toolbar-text-btn" onClick={onBlame} title={t("annotateFile")}>
              <Icon name="user" /> {t("annotate")}
            </button>
          )}
          <PathCopyButton path={file.path} root={root} line={caret} onCopy={onCopyPath} />
          {onReveal && <IconButton icon="external" title={t("revealInManager")} small onClick={onReveal} />}
        </div>
        <div className="diff-toolbar source-toolbar">
          <button className={cx("toolbar-text-btn", wrap && "active")} onClick={() => setWrap((v) => !v)}>
            <Icon name="rows" /> {t("wrap")}
          </button>
          <span className="toolbar-sep" />
          <span className="muted">UTF-8</span>
          <span className="spacer" />
          {file.truncated && <span className="source-warning">{t("truncated")}</span>}
        </div>
      </div>
      {file.binary ? (
        <div className="diff-empty">
          <Icon name="file" size={24} />
          <div>{t("binaryFile")}</div>
          <div className="muted">{formatSize(file.size)}</div>
        </div>
      ) : lines.length === 0 ? (
        <div className="diff-empty">
          <Icon name="file" size={20} />
          <div>{file.exists ? t("emptyFile") : t("missingFile")}</div>
        </div>
      ) : (
        <SourceEditor
          file={file}
          line={line}
          wrap={wrap}
          labels={{ addedHere: t("addedHere"), deletedHere: t("deletedHere") }}
          blameFormat={(blame) =>
            blame.uncommitted
              ? t("blameUncommitted")
              : [blame.author, blame.short, blame.summary, formatWhen(blame.time)].filter(Boolean).join(" · ")
          }
          onRollbackHunk={onRollbackHunk}
          onSymbol={onSymbol}
          onJump={onJump}
          onReferences={onReferences}
          onCaret={setCaret}
          onLineHistory={onLineHistory}
          onCommitDiff={onCommitDiff}
          onCopy={onCopyPath}
        />
      )}
    </div>
  );
}
