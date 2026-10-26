import { useMemo } from "react";
import { useT } from "./i18n";
import type { SymbolHit } from "./mygo";
import { classifyHits, hitText } from "./symbols";
import { Icon } from "./icons";
import { Modal, Spinner } from "./ui";

const T = {
  en: {
    title: "Usages of {name}",
    definitions: "Declarations",
    references: "References",
    none: "Nothing in the working tree mentions {name}.",
    empty: "No declarations found; these are the places that mention it.",
    hint: "Text search over the working tree. A language server answers more precisely when one is installed.",
    open: "Open",
  },
  zh: {
    title: "{name} 的引用",
    definitions: "声明",
    references: "引用",
    none: "工作区里没有出现 {name}。",
    empty: "没找到声明位置，下面是出现该词的地方。",
    hint: "这是在 工作区 内做文本搜索；装了语言服务器时，跳转会更准确。",
    open: "打开",
  },
} as const;

type Props = {
  word: string;
  language: string;
  hits: SymbolHit[] | null;
  onClose: () => void;
  onOpen: (path: string, line: number) => void;
};

/** Lists where a word is declared and used, and jumps to any of them. */
export function SymbolPanel({ word, language, hits, onClose, onOpen }: Props) {
  const t = useT(T);
  const groups = useMemo(() => (hits ? classifyHits(hits, word, language) : null), [hits, word, language]);

  return (
    <Modal title={t("title", { name: word })} icon="search" onClose={onClose} width={640}>
      {!hits || !groups ? (
        <Spinner label={t("title", { name: word })} />
      ) : hits.length === 0 ? (
        <div className="symbol-empty">{t("none", { name: word })}</div>
      ) : (
        <div className="symbol-list">
          {groups.definitions.length > 0 && (
            <>
              <div className="symbol-group">{t("definitions")}</div>
              {groups.definitions.map((hit) => (
                <SymbolRow key={`${hit.path}:${hit.line}`} hit={hit} onOpen={onOpen} />
              ))}
            </>
          )}
          {(groups.references.length > 0 || groups.definitions.length === 0) && (
            <>
              <div className="symbol-group">
                {groups.definitions.length === 0 ? t("empty") : t("references")}
              </div>
              {groups.references.map((hit) => (
                <SymbolRow key={`${hit.path}:${hit.line}`} hit={hit} onOpen={onOpen} />
              ))}
            </>
          )}
          <div className="symbol-hint">{t("hint")}</div>
        </div>
      )}
    </Modal>
  );
}

function SymbolRow({ hit, onOpen }: { hit: SymbolHit; onOpen: (path: string, line: number) => void }) {
  const t = useT(T);
  const dir = hit.path.includes("/") ? hit.path.slice(0, hit.path.lastIndexOf("/") + 1) : "";
  const name = hit.path.slice(dir.length);
  return (
    <button className="symbol-row" onClick={() => onOpen(hit.path, hit.line)} title={t("open")}>
      <span className="symbol-path">
        <span className="path-dir">{dir}</span>
        <span className="path-name">{name}</span>
      </span>
      <span className="symbol-line">{hit.line}</span>
      <code className="symbol-code">{hitText(hit)}</code>
      <Icon name="external" size={11} />
    </button>
  );
}
