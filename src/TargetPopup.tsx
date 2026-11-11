import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  },
  zh: {
    definition: "选择声明",
    implementation: "选择实现",
    typeDefinition: "选择类型声明",
    hint: "↑↓ 选择 · Enter 打开 · Esc 关闭",
    open: "打开",
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
  const [pos, setPos] = useState(() => ({
    left: request.anchor?.x ?? window.innerWidth / 2 - 180,
    top: request.anchor?.y ?? 96,
  }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(6, Math.min(pos.left, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(pos.top, window.innerHeight - rect.height - 6));
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [pos.left, pos.top]);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("mousedown", outside);
    return () => window.removeEventListener("mousedown", outside);
  }, [onClose]);

  const count = request.targets.length;

  return createPortal(
    <div
      className="target-popup"
      style={pos}
      ref={ref}
      role="listbox"
      tabIndex={0}
      aria-label={t(request.targetKind)}
      onKeyDown={(event) => {
        // A row's own Enter already runs its click; the container handles the
        // keys that belong to the list, where nothing else has focus.
        if (event.key === "Enter" && event.target !== event.currentTarget) return;
        if (event.key === "ArrowDown" || event.key === "PageDown") {
          setSelected((current) => (current + 1) % count);
        } else if (event.key === "ArrowUp" || event.key === "PageUp") {
          setSelected((current) => (current - 1 + count) % count);
        } else if (event.key === "Home") {
          setSelected(0);
        } else if (event.key === "End") {
          setSelected(count - 1);
        } else if (event.key === "Enter") {
          const target = request.targets[selected];
          if (target) onChoose(target);
        } else if (event.key === "Escape") {
          onClose();
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="target-popup-title">{t(request.targetKind)}</div>
      {request.targets.map((target, index) => (
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
      ))}
      <div className="target-popup-hint">{t("hint")}</div>
    </div>,
    document.body,
  );
}
