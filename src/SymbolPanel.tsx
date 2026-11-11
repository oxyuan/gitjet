import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./i18n";
import { Git, type SymbolHit, type UsagePreview } from "./mygo";
import { classifyHits, filterHits, groupHits, hitKey, hitText } from "./symbols";
import { Icon } from "./icons";
import { cx, Modal, Spinner } from "./ui";

const T = {
  en: {
    title: "Usages of {name}",
    declaration: "declaration",
    summary: "{n} usages in {files} files",
    one: "{n} usage in 1 file",
    none: "No usages of {name} were found.",
    noneText: "Nothing in the working tree mentions {name}.",
    filter: "Filter paths or lines",
    hint: "Text search over the working tree. A language server answers more precisely when one is installed.",
    server: "Language server: {server}",
    open: "Open",
    noResults: "No usage matches that filter.",
    noPreview: "No preview for this usage.",
    openHint: "Double-click or press Enter to open",
  },
  zh: {
    title: "{name} 的引用",
    declaration: "声明",
    summary: "{files} 个文件中共 {n} 处引用",
    one: "1 个文件中共 {n} 处引用",
    none: "没有找到 {name} 的引用。",
    noneText: "工作区里没有出现 {name}。",
    filter: "筛选路径或代码行",
    hint: "这是在 工作区 内做文本搜索；装了语言服务器时，跳转会更准确。",
    server: "语言服务器：{server}",
    open: "打开",
    noResults: "没有符合筛选条件的引用。",
    noPreview: "无法预览这处引用。",
    openHint: "双击或按 Enter 打开",
  },
} as const;

type Props = {
  word: string;
  language: string;
  hits: SymbolHit[] | null;
  /** A language server answered: its declarations are marked, and the list
   *  spans every file it reported, not only the ones already open. */
  source: "lsp" | "text";
  /** Row keys (`path:line`) the server called declarations. */
  definitions?: string[];
  server?: string;
  onClose: () => void;
  onOpen: (hit: SymbolHit) => void;
};

/** Lists where a word is declared and used, grouped by file, filtered as you
 *  type and walkable with the arrow keys and Enter. */
export function SymbolPanel({
  word,
  language,
  hits,
  source,
  definitions,
  server,
  onClose,
  onOpen,
}: Props) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => (hits ? filterHits(hits, query) : []), [hits, query]);
  const groups = useMemo(() => groupHits(filtered), [filtered]);
  const declared = useMemo(() => {
    if (!hits) return new Set<string>();
    if (source === "lsp") return new Set(definitions ?? []);
    return new Set(classifyHits(hits, word, language).definitions.map(hitKey));
  }, [hits, source, definitions, word, language]);
  // IDEA's usage count covers references; the declaration is the root of
  // the result, not one of its usages.
  const usages = useMemo(
    () => (source === "lsp" ? filtered.filter((hit) => !declared.has(hitKey(hit))) : filtered),
    [filtered, source, declared],
  );
  const files = useMemo(() => new Set(usages.map((hit) => hit.path)).size, [usages]);
  const order = useMemo(() => new Map(filtered.map((hit, index) => [hit, index])), [filtered]);

  // The preview follows the selected row, as IDEA's Show Usages does. A
  // window is fetched once per usage and kept for the life of the panel.
  const [preview, setPreview] = useState<UsagePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previews = useRef(new Map<string, UsagePreview>());
  const previewSeq = useRef(0);
  useEffect(() => {
    // A new selection invalidates any answer still in flight, cached or not.
    const seq = ++previewSeq.current;
    const hit = filtered[Math.min(selected, Math.max(filtered.length - 1, 0))];
    if (!hit) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const key = `${hit.path}:${hit.line}:${hit.column}`;
    const cached = previews.current.get(key);
    if (cached) {
      setPreview(cached);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    // Walking the list with the mouse must not read a window per row; IDEA
    // delays its preview update the same way.
    const timer = window.setTimeout(() => {
      void Git.usagePreview(hit.path, hit.line, 4)
        .then((result) => {
          if (seq !== previewSeq.current) return;
          previews.current.set(key, result);
          setPreview(result);
        })
        .catch(() => {
          if (seq === previewSeq.current) setPreview(null);
        })
        .finally(() => {
          if (seq === previewSeq.current) setPreviewing(false);
        });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [filtered, selected]);

  useEffect(() => {
    setSelected(0);
  }, [query]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-usage="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, filtered]);

  const choose = (hit: SymbolHit | undefined) => {
    if (hit) onOpen(hit);
  };
  const move = (delta: number) =>
    setSelected((current) => Math.max(0, Math.min(current + delta, Math.max(filtered.length - 1, 0))));

  return (
    <Modal title={t("title", { name: word })} icon="search" onClose={onClose} width={720}>
      {!hits ? (
        <Spinner label={t("title", { name: word })} />
      ) : hits.length === 0 ? (
        <div className="symbol-empty">{source === "lsp" ? t("none", { name: word }) : t("noneText", { name: word })}</div>
      ) : (
        <>
          <input
            className="symbol-filter"
            autoFocus
            value={query}
            placeholder={t("filter")}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                move(1);
              } else if (event.key === "ArrowUp") {
                move(-1);
              } else if (event.key === "Enter") {
                choose(filtered[selected]);
              } else {
                return;
              }
              event.preventDefault();
            }}
          />
          <div className="symbol-summary">
            {t(files === 1 ? "one" : "summary", {
              n: source === "lsp" ? usages.length : filtered.length,
              files,
            })}
          </div>
          <div className="symbol-body">
            <div
              className="symbol-list"
              ref={listRef}
              onKeyDown={(event) => {
                // The filter has finished with its own keys; a row that took
                // the focus still walks the list and opens on Enter.
                if (event.key === "ArrowDown") move(1);
                else if (event.key === "ArrowUp") move(-1);
                else if (event.key === "Enter") choose(filtered[selected]);
                else return;
                event.preventDefault();
              }}
            >
              {filtered.length === 0 ? (
                <div className="symbol-empty">{t("noResults")}</div>
              ) : (
                groups.map((group) => {
                  const dir = group.path.includes("/") ? group.path.slice(0, group.path.lastIndexOf("/") + 1) : "";
                  const name = group.path.slice(dir.length);
                  return (
                    <div key={group.path}>
                      <div className="symbol-file">
                        <Icon name="file" size={12} />
                        <span className="path-dir">{dir}</span>
                        <span className="path-name">{name}</span>
                        <span className="symbol-count">{group.hits.length}</span>
                      </div>
                      {group.hits.map((hit) => {
                        const index = order.get(hit) ?? 0;
                        return (
                          <SymbolRow
                            key={`${hit.path}:${hit.line}:${hit.column}`}
                            hit={hit}
                            index={index}
                            selected={index === selected}
                            declaration={declared.has(hitKey(hit))}
                            onSelect={() => setSelected(index)}
                            onOpen={onOpen}
                          />
                        );
                      })}
                    </div>
                  );
                })
              )}
              <div className="symbol-hint">
                {source === "lsp" && server ? t("server", { server }) : t("hint")}
                <span className="symbol-hint-sep"> · </span>
                {t("openHint")}
              </div>
            </div>
            <SymbolPreview
              preview={preview}
              loading={previewing}
              hit={previewing ? null : filtered[Math.min(selected, Math.max(filtered.length - 1, 0))] ?? null}
              word={word}
              onOpen={() => choose(filtered[selected])}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

function SymbolRow({
  hit,
  index,
  selected,
  declaration,
  onSelect,
  onOpen,
}: {
  hit: SymbolHit;
  index: number;
  selected: boolean;
  declaration: boolean;
  onSelect: () => void;
  onOpen: (hit: SymbolHit) => void;
}) {
  const t = useT(T);
  return (
    <button
      className={`symbol-row${selected ? " selected" : ""}`}
      data-usage={index}
      onClick={onSelect}
      onDoubleClick={() => onOpen(hit)}
      onMouseEnter={onSelect}
      title={t("openHint")}
    >
      <span className="symbol-line">{hit.line}</span>
      <code className="symbol-code">{hitText(hit)}</code>
      {declaration && <span className="symbol-badge">{t("declaration")}</span>}
      <Icon name="external" size={11} />
    </button>
  );
}

/** The code around the selected usage, under the list as IDEA's Show Usages
 *  shows it. The matched word is marked; the header's button opens the row. */
function SymbolPreview({
  preview,
  loading,
  hit,
  word,
  onOpen,
}: {
  preview: UsagePreview | null;
  loading: boolean;
  hit: SymbolHit | null;
  word: string;
  onOpen: () => void;
}) {
  const t = useT(T);
  if (loading) {
    return (
      <div className="symbol-preview">
        <div className="symbol-preview-empty">
          <Spinner label={word} />
        </div>
      </div>
    );
  }
  if (!preview || preview.lines.length === 0) {
    return (
      <div className="symbol-preview">
        <div className="symbol-preview-empty">{t("noPreview")}</div>
      </div>
    );
  }
  const cut = preview.path.includes("/") ? preview.path.lastIndexOf("/") + 1 : 0;
  const dir = preview.path.slice(0, cut);
  const name = preview.path.slice(cut);
  const marked = hit && hit.line === preview.line ? hit : null;
  return (
    <div className="symbol-preview">
      <div className="symbol-preview-head">
        <Icon name="file" size={12} />
        <span className="path-dir">{dir}</span>
        <span className="path-name">{name}</span>
        <span className="symbol-preview-line">{preview.line}</span>
        <span className="spacer" />
        <button className="toolbar-text-btn" onClick={onOpen}>
          {t("open")}
        </button>
      </div>
      <div className="symbol-preview-code">
        {preview.lines.map((line) => (
          <div
            key={line.line}
            className={cx("symbol-preview-row", line.line === preview.line && "active")}
          >
            <span className="symbol-preview-number">{line.line}</span>
            <code>{markedLine(line.text, line.line === preview.line ? word : "", marked?.column ?? 1)}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Marks the usage's word on its preview line. The column picks the right
 *  occurrence when the word appears more than once. */
function markedLine(text: string, word: string, column: number) {
  if (word === "") return text;
  let at = text.indexOf(word, Math.max(column - 1, 0));
  if (at < 0) at = text.indexOf(word);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="symbol-preview-hit">{word}</span>
      {text.slice(at + word.length)}
    </>
  );
}
