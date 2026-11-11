import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "./i18n";
import type { SymbolHit } from "./mygo";
import { classifyHits, filterHits, groupHits, hitKey, hitText } from "./symbols";
import { Icon } from "./icons";
import { Modal, Spinner } from "./ui";

const T = {
  en: {
    title: "Usages of {name}",
    declaration: "declaration",
    summary: "{n} usages in {files} files · {declarations} declarations",
    one: "{n} usage in 1 file · {declarations} declarations",
    none: "No usages of {name} were found.",
    noneText: "Nothing in the working tree mentions {name}.",
    filter: "Filter paths or lines",
    hint: "Text search over the working tree. A language server answers more precisely when one is installed.",
    server: "Language server: {server}",
    open: "Open",
    noResults: "No usage matches that filter.",
  },
  zh: {
    title: "{name} 的引用",
    declaration: "声明",
    summary: "{files} 个文件中共 {n} 处引用 · {declarations} 处声明",
    one: "1 个文件中共 {n} 处引用 · {declarations} 处声明",
    none: "没有找到 {name} 的引用。",
    noneText: "工作区里没有出现 {name}。",
    filter: "筛选路径或代码行",
    hint: "这是在 工作区 内做文本搜索；装了语言服务器时，跳转会更准确。",
    server: "语言服务器：{server}",
    open: "打开",
    noResults: "没有符合筛选条件的引用。",
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
                setSelected((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                setSelected((current) => Math.max(current - 1, 0));
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
              declarations:
                source === "lsp"
                  ? filtered.length - usages.length
                  : filtered.filter((hit) => declared.has(hitKey(hit))).length,
            })}
          </div>
          <div className="symbol-list" ref={listRef}>
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
                          onOpen={onOpen}
                          onHover={() => setSelected(index)}
                        />
                      );
                    })}
                  </div>
                );
              })
            )}
            <div className="symbol-hint">
              {source === "lsp" && server ? t("server", { server }) : t("hint")}
            </div>
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
  onOpen,
  onHover,
}: {
  hit: SymbolHit;
  index: number;
  selected: boolean;
  declaration: boolean;
  onOpen: (hit: SymbolHit) => void;
  onHover: () => void;
}) {
  const t = useT(T);
  return (
    <button
      className={`symbol-row${selected ? " selected" : ""}`}
      data-usage={index}
      onClick={() => onOpen(hit)}
      onMouseEnter={onHover}
      title={t("open")}
    >
      <span className="symbol-line">{hit.line}</span>
      <code className="symbol-code">{hitText(hit)}</code>
      {declaration && <span className="symbol-badge">{t("declaration")}</span>}
      <Icon name="external" size={11} />
    </button>
  );
}
