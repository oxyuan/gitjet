import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Git, type Commit, type RepoFile } from "./mygo";
import { FileIcon, Icon } from "./icons";
import { count, useT } from "./i18n";
import { cx, Spinner } from "./ui";

const T = {
  en: {
    label: "Quick open file",
    placeholder: "Search files by name…",
    noMatch: "No file matches “{query}”",
    untracked: "untracked",
    navigate: "navigate",
    open: "open",
    fileCountOne: "{n} file",
    fileCountOther: "{n} files",
    commits: "commits",
    commitResultOne: "{n} commit",
    commitResultOther: "{n} commits",
  },
  zh: {
    label: "快速打开文件",
    placeholder: "按文件名搜索…",
    noMatch: "没有匹配“{query}”的文件",
    untracked: "未跟踪",
    navigate: "导航",
    open: "打开",
    fileCountOne: "{n} 个文件",
    fileCountOther: "{n} 个文件",
    commits: "提交",
    commitResultOne: "{n} 个提交",
    commitResultOther: "{n} 个提交",
  },
} as const;

export function QuickOpen({
  onClose,
  onOpen,
  onOpenCommit,
}: {
  onClose: () => void;
  onOpen: (path: string) => void;
  onOpenCommit: (hash: string) => void;
}) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const req = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    const term = query.trim();
    const timer = window.setTimeout(() => {
      const filesRequest = Git.files(query);
      // Commits join the results once the query is specific enough to mean
      // something as a message or author search.
      const commitsRequest =
        term.length >= 2
          ? Git.log({
              all: true,
              refs: [],
              path: "",
              line: 0,
              search: term,
              author: "",
              since: 0,
              limit: 6,
              skip: 0,
              firstParent: false,
            })
          : Promise.resolve(null);
      Promise.allSettled([filesRequest, commitsRequest])
        .then(([fileResult, commitResult]) => {
          if (id !== req.current) return;
          if (fileResult.status === "fulfilled") {
            setFiles(fileResult.value);
            setError("");
          } else {
            setError(fileResult.reason instanceof Error ? fileResult.reason.message : String(fileResult.reason));
          }
          const found =
            commitResult.status === "fulfilled" && commitResult.value ? commitResult.value.commits : [];
          setCommits(found);
          setIndex(0);
        })
        .finally(() => {
          if (id === req.current) setLoading(false);
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".quick-item.active");
    el?.scrollIntoView({ block: "nearest" });
  }, [index, files]);

  const rows: ({ kind: "commit"; commit: Commit } | { kind: "file"; file: RepoFile })[] = [
    ...commits.map((commit) => ({ kind: "commit" as const, commit })),
    ...files.map((file) => ({ kind: "file" as const, file })),
  ];

  const choose = (row: (typeof rows)[number] | undefined) => {
    if (!row) return;
    if (row.kind === "commit") onOpenCommit(row.commit.hash);
    else onOpen(row.file.path);
    onClose();
  };

  return createPortal(
    <div className="quick-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-panel" role="dialog" aria-label={t("label")}>
        <div className="quick-input-row">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder={t("placeholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(rows.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(rows[index]);
              }
            }}
          />
          {loading && <Spinner />}
          <kbd>esc</kbd>
        </div>
        <div className="quick-list" ref={listRef}>
          {error && <div className="quick-empty">{error}</div>}
          {!error && rows.length === 0 && !loading && (
            <div className="quick-empty">{t("noMatch", { query })}</div>
          )}
          {rows.map((row, i) => {
            if (row.kind === "commit") {
              const commit = row.commit;
              return (
                <button
                  key={`commit:${commit.hash}`}
                  className={cx("quick-item", i === index && "active")}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => setIndex(i)}
                  onDoubleClick={() => choose(row)}
                  title={commit.message}
                >
                  <Icon name="commit" size={14} />
                  <span className="quick-dir">{commit.short}</span>
                  <span className="quick-name">{commit.subject}</span>
                  <span className="quick-badge">{commit.author}</span>
                </button>
              );
            }
            const file = row.file;
            const slash = file.path.lastIndexOf("/");
            const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
            const name = file.path.slice(slash + 1);
            return (
              <button
                key={`file:${file.path}`}
                className={cx("quick-item", i === index && "active")}
                onMouseEnter={() => setIndex(i)}
                onClick={() => setIndex(i)}
                onDoubleClick={() => choose(row)}
                title={file.path}
              >
                <FileIcon path={file.path} size={14} />
                <span className="quick-dir">{dir}</span>
                <span className="quick-name">{name}</span>
                {!file.tracked && <span className="quick-badge">{t("untracked")}</span>}
              </button>
            );
          })}
        </div>
        <div className="quick-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {t("navigate")}</span>
          <span><kbd>↵</kbd> {t("open")}</span>
          <span className="spacer" />
          <span>
            {count(
              files.length,
              t("fileCountOne", { n: files.length }),
              t("fileCountOther", { n: files.length }),
            )}
            {commits.length > 0 &&
              ` · ${count(
                commits.length,
                t("commitResultOne", { n: commits.length }),
                t("commitResultOther", { n: commits.length }),
              )}`}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
