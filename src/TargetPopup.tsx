import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "./i18n";
import { Icon } from "./icons";
import type { NavigationTarget, TargetRequest } from "./navigation";

const T = {
  en: {
    definition: "Choose Declaration",
    implementation: "Choose Implementation",
    typeDefinition: "Choose Type Declaration",
    hint: "↑↓ choose · Enter open · Esc close",
    open: "Open",
    filter: "Filter targets",
    noMatches: "No target matches that filter.",
  },
  zh: {
    definition: "选择声明",
    implementation: "选择实现",
    typeDefinition: "选择类型声明",
    hint: "↑↓ 选择 · Enter 打开 · Esc 关闭",
    open: "打开",
    filter: "筛选目标",
    noMatches: "没有符合筛选条件的目标。",
  },
} as const;

/** A chooser anchored to the symbol, for the times a language server has
 *  more than one answer. IDEA shows this popup instead of picking one. */
export function TargetPopup({
  request,
  onChoose,
  onClose,
}: {
  request: TargetRequest;
  onChoose: (target: NavigationTarget) => void;
  onClose: () => void;
}) {
  const t = useT(T);
  const ref = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState(0);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState(() => ({
    left: request.anchor?.x ?? window.innerWidth / 2 - 180,
    top: request.anchor?.y ?? 96,
  }));
  // IDEA's chooser is a speed-search list: typing narrows it, the arrows
  // walk what is left, and Enter opens the selected row.
  const targets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return request.targets;
    return request.targets.filter((target) =>
      `${request.word} ${target.path}:${target.line}`.toLowerCase().includes(needle),
    );
  }, [request, query]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(pos.left, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(pos.top, window.innerHeight - rect.height - 6));
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [pos.left, pos.top]);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [onClose]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  const count = targets.length;
  const move = (delta: number) =>
    setSelected((current) => (count === 0 ? 0 : (current + delta + count) % count));

  return createPortal(
    <div
      className="target-popup"
      style={pos}
      ref={ref}
      role="listbox"
      aria-label={t(request.targetKind)}
      onKeyDown={(event) => {
        // The filter owns the keys while it has focus; a row's focus still
        // needs Escape and the arrows, as the popup's list always did.
        if (event.target instanceof HTMLInputElement) return;
        if (event.key === "Escape") {
          onClose();
        } else if (event.key === "ArrowDown" || event.key === "PageDown") {
          move(1);
        } else if (event.key === "ArrowUp" || event.key === "PageUp") {
          move(-1);
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="target-popup-title">{t(request.targetKind)}</div>
      <input
        className="symbol-filter"
        autoFocus
        value={query}
        placeholder={t("filter")}
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "PageDown") {
            move(1);
          } else if (event.key === "ArrowUp" || event.key === "PageUp") {
            move(-1);
          } else if (event.key === "Home") {
            setSelected(0);
          } else if (event.key === "End") {
            setSelected(Math.max(count - 1, 0));
          } else if (event.key === "Enter") {
            const target = targets[Math.min(selected, count - 1)];
            if (target) onChoose(target);
          } else if (event.key === "Escape") {
            onClose();
          } else {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
      />
      {targets.length === 0 ? (
        <div className="target-popup-empty">{t("noMatches")}</div>
      ) : (
        targets.map((target, index) => (
          <button
            key={`${target.uri}:${target.line}:${target.column}`}
            className={`target-popup-row${index === selected ? " selected" : ""}`}
            role="option"
            aria-selected={index === selected}
            title={t("open")}
            onMouseEnter={() => setSelected(index)}
            onClick={() => onChoose(target)}
          >
            <Icon name="file" size={12} />
            <span className="target-popup-name">{request.word}</span>
            <span className="target-popup-where">
              <span className="target-popup-path">{target.path}</span>
              <span className="target-popup-line">{target.line}</span>
            </span>
          </button>
        ))
      )}
      <div className="target-popup-hint">{t("hint")}</div>
    </div>,
    document.body,
  );
}
