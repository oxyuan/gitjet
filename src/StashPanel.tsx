import { useRef, useState } from "react";
import type { Stash } from "./mygo";
import { useT } from "./i18n";
import { Icon } from "./icons";
import { ContextMenu, formatWhen, type ContextItem } from "./ui";

/** What a stash row can do to its entry; the dock panel and the commit page's
 *  stash section share it, so one list has one set of actions. */
export interface StashActions {
  onOpen: (index: number) => void;
  onApply: (index: number, pop: boolean, restoreIndex: boolean) => void;
  onDrop: (index: number) => void;
}

const T = {
  en: {
    stashes: "Stashes",
    stashDetail: "Show the stash contents",
    popStash: "Pop stash",
    applyStash: "Apply stash",
    dropStash: "Drop stash",
    clearStashes: "Clear all stashes",
    stashChanges: "Stash changes",
    refresh: "Refresh",
    pop: "Pop",
    apply: "Apply",
    drop: "Drop",
    empty: "No stashes",
    emptyHint: "Stashing puts the working tree aside and leaves the index as it was.",
    stepHint: "↑↓ step · Enter shows the contents · ⌫ drops",
  },
  zh: {
    stashes: "Stash",
    stashDetail: "查看 Stash 内容",
    popStash: "弹出 Stash",
    applyStash: "应用 Stash",
    dropStash: "删除 Stash",
    clearStashes: "清空所有 Stash",
    stashChanges: "Stash 更改",
    refresh: "刷新",
    pop: "弹出",
    apply: "应用",
    drop: "删除",
    empty: "没有 Stash",
    emptyHint: "Stash 会把工作区搁置起来，索引保持原样。",
    stepHint: "↑↓ 切换 · Enter 查看内容 · ⌫ 删除",
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

/** The stash rows themselves: the commit page's section body and the dock
 *  panel draw the same list, so both get the buttons, the menu and the
 *  keyboard from one place. */
export function StashRows({ stashes, actions }: { stashes: Stash[]; actions: StashActions }) {
  const t = useT(T);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = listRef.current?.querySelectorAll<HTMLElement>(".stash-row");
    const target = rows?.[at + (e.key === "ArrowDown" ? 1 : -1)];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="stash-rows" ref={listRef}>
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

/** IDEA's stash tab in the Git tool window: the entries, a way to make one,
 *  and the same rows the commit page draws. */
export function StashPanel({
  stashes,
  actions,
  onStashPush,
  onRefresh,
  onClear,
  busy,
}: {
  stashes: Stash[];
  actions: StashActions;
  onStashPush: () => void;
  onRefresh: () => void;
  onClear: () => void;
  busy?: boolean;
}) {
  const t = useT(T);
  return (
    <div className="stash-panel">
      <div className="section-header static">
        <Icon name="stash" size={13} />
        <span className="section-title">{t("stashes")}</span>
        <span className="section-count">{stashes.length}</span>
        <span className="spacer" />
        <button className="mini-btn" onClick={onStashPush} title={t("stashChanges")}>
          + {t("stashChanges")}
        </button>
        <button className="mini-btn" onClick={onRefresh} title={t("refresh")}>
          ⟳
        </button>
        <button
          className="mini-btn danger"
          onClick={onClear}
          disabled={stashes.length === 0 || busy}
          title={t("clearStashes")}
        >
          ⌫
        </button>
      </div>
      {stashes.length === 0 ? (
        <div className="changes-empty">
          <Icon name="stash" size={20} />
          <span>{t("empty")}</span>
          <span className="muted">{t("emptyHint")}</span>
        </div>
      ) : (
        <StashRows stashes={stashes} actions={actions} />
      )}
      <div className="stash-panel-hint">{t("stepHint")}</div>
    </div>
  );
}
