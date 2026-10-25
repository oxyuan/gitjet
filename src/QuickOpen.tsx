import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Git, type RepoFile } from "./mygo";
import { Icon } from "./icons";
import { cx, Spinner } from "./ui";

export function QuickOpen({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
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
      <div className="quick-panel" role="dialog" aria-label="Quick open file">
        <div className="quick-input-row">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            placeholder="Search files by name…"
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
            <div className="quick-empty">No file matches “{query}”</div>
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
                {!file.tracked && <span className="quick-badge">untracked</span>}
              </button>
            );
          })}
        </div>
        <div className="quick-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span className="spacer" />
          <span>{files.length} files</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
