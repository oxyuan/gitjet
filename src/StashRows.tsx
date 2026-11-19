import { useRef, useState } from "react";
import type { Stash } from "./mygo";
import { useT } from "./i18n";
import { textSpeedSearch } from "./speedSearch";
import { ContextMenu, formatWhen, type ContextItem } from "./ui";

/** What a stash row can do to its entry. The commit page owns the only list,
 *  so one set of actions serves every entry. */
export interface StashActions {
  onOpen: (index: number) => void;
  onApply: (index: number, pop: boolean, restoreIndex: boolean) => void;
  onDrop: (index: number) => void;
}

const T = {
  en: {
    stashDetail: "Show the stash contents",
    popStash: "Pop stash",
    applyStash: "Apply stash",
    dropStash: "Drop stash",
    pop: "Pop",
    apply: "Apply",
    drop: "Drop",
  },
  zh: {
    stashDetail: "查看 Stash 内容",
    popStash: "弹出 Stash",
    applyStash: "应用 Stash",
    dropStash: "删除 Stash",
    pop: "弹出",
    apply: "应用",
    drop: "删除",
  },
} as const;

/** One row's menu. IDEA's stash list offers the same entries, and the
 *  destructive one sits on its own at the bottom. */
function stashMenu(
  stash: Stash,
  actions: StashActions,
  label: (key: "stashDetail" | "popStash" | "applyStash" | "dropStash") => string,
): ContextItem[] {
  return [
    { label: label("stashDetail"), icon: "diff", onClick: () => actions.onOpen(stash.index) },
    { separator: true },
    { label: label("popStash"), icon: "unstage", onClick: () => actions.onApply(stash.index, true, false) },
    { label: label("applyStash"), icon: "stage", onClick: () => actions.onApply(stash.index, false, false) },
    { separator: true },
    { label: label("dropStash"), icon: "trash", onClick: () => actions.onDrop(stash.index) },
  ];
}

/** The stash rows the commit page draws: the buttons, the context menu and
 *  the keyboard live together so one row behaves the same way everywhere. */
export function StashRows({ stashes, actions }: { stashes: Stash[]; actions: StashActions }) {
  const t = useT(T);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Typing walks the list, as a JBList's speed search does; the buffer shows
  // over the rows and clears when typing stops.
  const [speed, setSpeed] = useState("");
  const speedBuffer = useRef("");
  const speedTimer = useRef<number | null>(null);

  /** IDEA walks a list with the keyboard: ↑↓ move, Enter is the row's click,
   *  and the delete key is the row's own delete. */
  const onKey = (e: React.KeyboardEvent, stash: Stash, at: number) => {
    // A focused mini button owns its own Enter and Delete.
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter") {
      e.preventDefault();
      actions.onOpen(stash.index);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      actions.onDrop(stash.index);
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      speedBuffer.current += e.key;
      if (speedTimer.current !== null) window.clearTimeout(speedTimer.current);
      speedTimer.current = window.setTimeout(() => {
        speedBuffer.current = "";
        setSpeed("");
      }, 1200);
      setSpeed(speedBuffer.current);
      const rows = listRef.current?.querySelectorAll<HTMLElement>(".stash-row");
      const found = textSpeedSearch(
        stashes.map((s) => s.message),
        speedBuffer.current,
        at,
      );
      const target = found >= 0 ? rows?.[found] : undefined;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = listRef.current?.querySelectorAll<HTMLElement>(".stash-row");
    const target = rows?.[at + (e.key === "ArrowDown" ? 1 : -1)];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="stash-rows" ref={listRef}>
      {speed && (
        <div className="stash-speed" aria-live="polite">
          {speed}
        </div>
      )}
      {stashes.map((s, at) => (
        <div
          className="tree-row stash-row"
          key={s.ref}
          tabIndex={0}
          onClick={() => actions.onOpen(s.index)}
          onKeyDown={(e) => onKey(e, s, at)}
          title={`${t("stashDetail")}\n${formatWhen(s.time)}`}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, items: stashMenu(s, actions, t) });
          }}
        >
          <span className="stash-ref">stash@{"{" + s.index + "}"}</span>
          <span className="tree-name">{s.message}</span>
          <span className="stash-actions" onClick={(e) => e.stopPropagation()}>
            <button className="mini-btn" onClick={() => actions.onApply(s.index, true, false)} title={t("popStash")}>
              {t("pop")}
            </button>
            <button className="mini-btn" onClick={() => actions.onApply(s.index, false, false)} title={t("applyStash")}>
              {t("apply")}
            </button>
            <button className="mini-btn danger" onClick={() => actions.onDrop(s.index)} title={t("dropStash")}>
              {t("drop")}
            </button>
          </span>
        </div>
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
