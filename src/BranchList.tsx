import { useMemo, useState } from "react";
import {
  buildBranchSections,
  COLLAPSE_THRESHOLD,
  flattenSections,
  searchSections,
  type BranchGroup,
  type BranchLeaf,
} from "./branches";
import { Icon } from "./icons";
import { useT } from "./i18n";
import type { RefsSnapshot } from "./mygo";
import { ContextMenu, cx, type ContextItem } from "./ui";

const T = {
  en: {
    searchBranches: "Search branches",
    localBranches: "Local",
    remoteBranches: "Remote · {remote}",
    toPush: "{count} commit(s) to push",
    toPull: "{count} commit(s) to pull",
    others: "Others",
    protected: "Protected",
    current: "current",
    currentBranch: "Current branch",
    noBranches: "No branches",
    noMatch: "Nothing matches “{query}”",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    checkout: "Check out",
    filterTip: "Double-click to show this branch's history · right-click to check out",
    newBranch: "New branch from here…",
    merge: "Merge into current",
    rebase: "Rebase current onto this",
    deleteBranch: "Delete branch",
    copyName: "Copy branch name",
    pullBranch: "Pull",
    pushBranch: "Push",
  },
  zh: {
    searchBranches: "搜索分支",
    localBranches: "本地",
    remoteBranches: "远程 · {remote}",
    toPush: "{count} 个提交待推送",
    toPull: "{count} 个提交待拉取",
    others: "其它",
    protected: "受保护",
    current: "当前",
    currentBranch: "当前分支",
    noBranches: "没有分支",
    noMatch: "没有匹配“{query}”的分支",
    addFavorite: "收藏分支",
    removeFavorite: "取消收藏",
    checkout: "切换",
    filterTip: "双击查看该分支历史 · 右键切换分支",
    newBranch: "从此分支新建…",
    merge: "合并到当前分支",
    rebase: "变基当前分支到此",
    deleteBranch: "删除分支",
    copyName: "复制分支名",
    pullBranch: "拉取",
    pushBranch: "推送",
  },
} as const;

/**
 * The branch tree of the branch page. A single click only selects the row for
 * reading; showing a branch's history and checking it out are deliberate, so
 * they live on double click and in the context menu.
 */
export function BranchList({
  refs,
  current,
  favorites,
  selected,
  onSelect,
  onCheckout,
  onToggleFavorite,
  onNewBranch,
  onMerge,
  onRebase,
  onDelete,
  onCopy,
  onPull,
  onPush,
}: {
  refs: RefsSnapshot | null;
  current: string;
  favorites: string[];
  /** Branch whose history is shown; "" means every local and remote branch. */
  selected: string;
  onSelect: (name: string) => void;
  onCheckout: (name: string) => void;
  onToggleFavorite: (key: string) => void;
  onNewBranch: (start: string) => void;
  onMerge: (name: string) => void;
  onRebase: (name: string) => void;
  onDelete: (name: string) => void;
  onCopy: (text: string) => void;
  /** Pull the checked out branch, then push the given local branch. */
  onPull: (leaf: BranchLeaf) => void;
  onPush: (leaf: BranchLeaf) => void;
}) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);

  const sections = useMemo(() => buildBranchSections(refs, current), [refs, current]);
  const visible = useMemo(() => searchSections(sections, query), [sections, query]);
  const leaves = useMemo(() => flattenSections(visible), [visible]);
  const searching = query.trim() !== "";

  const groupKey = (sectionKey: string, group: BranchGroup) => `${sectionKey}/${group.name}`;
  const isCollapsed = (sectionKey: string, group: BranchGroup) =>
    searching ? false : (collapsed[groupKey(sectionKey, group)] ?? group.branches.length > COLLAPSE_THRESHOLD);

  const groupLabel = (group: BranchGroup) =>
    group.name === "others" ? t("others") : group.name === "protected" ? t("protected") : group.name;

  const branchMenu = (leaf: BranchLeaf, x: number, y: number) => {
    const starredNow = favorites.includes(leaf.key);
    const items: ContextItem[] = [
      { label: t("checkout"), icon: "branch", disabled: leaf.current, onClick: () => onCheckout(leaf.name) },
      {
        label: starredNow ? t("removeFavorite") : t("addFavorite"),
        icon: "star",
        onClick: () => onToggleFavorite(leaf.key),
      },
      { separator: true },
      { label: t("newBranch"), icon: "plus", onClick: () => onNewBranch(leaf.name) },
      { label: t("merge"), icon: "merge", onClick: () => onMerge(leaf.name) },
      { label: t("rebase"), icon: "rebase", onClick: () => onRebase(leaf.name) },
      ...(leaf.remote === ""
        ? ([
            { separator: true } as ContextItem,
            // A pull only makes sense for the branch that is checked out.
            ...(leaf.current
              ? [{ label: t("pullBranch"), icon: "pull", onClick: () => onPull(leaf) } as ContextItem]
              : []),
            { label: t("pushBranch"), icon: "push", onClick: () => onPush(leaf) } as ContextItem,
          ])
        : []),
      { separator: true },
      { label: t("copyName"), icon: "copy", onClick: () => onCopy(leaf.name) },
    ];
    if (leaf.remote === "" && !leaf.current) {
      items.push({ label: t("deleteBranch"), icon: "trash", danger: true, onClick: () => onDelete(leaf.name) });
    }
    setMenu({ x, y, items });
  };

  const leafRow = (leaf: BranchLeaf, full = false) => {
    const starredNow = favorites.includes(leaf.key);
    return (
      <div
        key={(full ? "fav:" : "") + leaf.key}
        className={cx("bp-leaf", !full && "nested", leaf.current && "current", selected === leaf.name && "selected")}
        title={leaf.upstream ? `${leaf.name} → ${leaf.upstream}` : t("filterTip")}
        onDoubleClick={() => onSelect(leaf.name)}
        onContextMenu={(e) => {
          e.preventDefault();
          branchMenu(leaf, e.clientX, e.clientY);
        }}
        role="treeitem"
        aria-selected={selected === leaf.name}
      >
        <span className="bp-leaf-name">{full ? leaf.name : leaf.label}</span>
        {leaf.current && (
          <span className="bp-current" title={t("currentBranch")}>
            <Icon name="check" size={11} />
            <span>{t("current")}</span>
          </span>
        )}
        {leaf.ahead > 0 && (
          <span className="bp-sync ahead" title={t("toPush", { count: leaf.ahead })}>
            ↑{leaf.ahead}
          </span>
        )}
        {leaf.behind > 0 && (
          <span className="bp-sync behind" title={t("toPull", { count: leaf.behind })}>
            ↓{leaf.behind}
          </span>
        )}
        <button
          className={cx("bp-star", starredNow && "on")}
          title={starredNow ? t("removeFavorite") : t("addFavorite")}
          aria-pressed={starredNow}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(leaf.key);
          }}
        >
          <Icon name="star" size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="branch-list">
      <div className="picker-search branch-list-search">
        <Icon name="search" size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchBranches")}
          aria-label={t("searchBranches")}
        />
        {query && (
          <button className="search-clear" onClick={() => setQuery("")} aria-label={t("searchBranches")}>
            <Icon name="close" size={11} />
          </button>
        )}
      </div>
      <div className="picker-scroll branch-scroll" role="tree">
        {visible.map((section) => {
          const all = section.groups.flatMap((group) => group.branches);
          // Favourites float to the top of their own section and leave the
          // groups behind, so a branch appears exactly once.
          const pinned = all.filter((leaf) => favorites.includes(leaf.key));
          const pinnedKeys = new Set(pinned.map((leaf) => leaf.key));
          const groups = section.groups
            .map((group) => ({ ...group, branches: group.branches.filter((leaf) => !pinnedKeys.has(leaf.key)) }))
            .filter((group) => group.branches.length > 0);
          return (
            <div className="bp-section" key={section.key}>
              <div className="bp-section-title">
                <Icon name={section.remote ? "fetch" : "branch"} size={11} />
                <span>
                  {section.remote ? t("remoteBranches", { remote: section.remote }) : t("localBranches")}
                </span>
                <span className="bp-count">{all.length}</span>
              </div>
              {pinned.map((leaf) => leafRow(leaf, true))}
              {groups.map((group) => {
                const closed = isCollapsed(section.key, group);
                return (
                  <div className="bp-group-block" key={section.key + group.name}>
                    <button
                      className="bp-group"
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [groupKey(section.key, group)]: !closed }))
                      }
                    >
                      <Icon name={closed ? "chevronRight" : "chevronDown"} size={11} />
                      <span className={cx("bp-dot", `tone-${group.tone}`)} />
                      <span className="bp-group-name">{groupLabel(group)}</span>
                      <span className="bp-count">{group.branches.length}</span>
                    </button>
                    {!closed && group.branches.map((leaf) => leafRow(leaf))}
                  </div>
                );
              })}
            </div>
          );
        })}
        {leaves.length === 0 && (
          <div className="picker-empty">
            {searching ? t("noMatch", { query: query.trim() }) : t("noBranches")}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
