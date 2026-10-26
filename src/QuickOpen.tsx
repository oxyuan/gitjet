import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Git, type RepoFile } from "./mygo";
import { Icon } from "./icons";
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
  },
} as const;

export function QuickOpen({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const req = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = ++req.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      Git.files(query)
        .then((list) => {
          if (id !== req.current) return;
          setFiles(list);
          setIndex(0);
          setError("");
        })
        .catch((err) => {
          if (id !== req.current) return;
          setError(err instanceof Error ? err.message : String(err));
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

  const choose = (file: RepoFile | undefined) => {
    if (!file) return;
    onOpen(file.path);
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
                setIndex((i) => Math.min(files.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(files[index]);
              }
            }}
          />
          {loading && <Spinner />}
          <kbd>esc</kbd>
        </div>
        <div className="quick-list" ref={listRef}>
          {error && <div className="quick-empty">{error}</div>}
          {!error && files.length === 0 && !loading && (
            <div className="quick-empty">{t("noMatch", { query })}</div>
          )}
          {files.map((file, i) => {
            const slash = file.path.lastIndexOf("/");
            const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
            const name = file.path.slice(slash + 1);
            return (
              <button
                key={file.path}
                className={cx("quick-item", i === index && "active")}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(file)}
                title={file.path}
              >
                <Icon name="file" size={14} />
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
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
