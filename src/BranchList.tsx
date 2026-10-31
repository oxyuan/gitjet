import { useMemo, useState } from "react";
import {
  buildBranchSections,
  buildTagLeaves,
  COLLAPSE_THRESHOLD,
  flattenSections,
  groupStartsCollapsed,
  searchSections,
  searchTags,
  type BranchGroup,
  type BranchLeaf,
  type BranchSection,
  type TagLeaf,
} from "./branches";
import { Icon } from "./icons";
import { useT } from "./i18n";
import type { RefsSnapshot } from "./mygo";
import { ContextMenu, cx, formatWhen, IconButton, type ContextItem } from "./ui";

const T = {
  en: {
    searchBranches: "Search branches and tags",
    localBranches: "Local",
    remoteBranches: "Remote · {remote}",
    tags: "Tags",
    toPush: "{count} commit(s) to push",
    toPull: "{count} commit(s) to pull",
    others: "Others",
    protected: "Protected",
    currentBranch: "Current branch",
    noBranches: "No branches or tags",
    noMatch: "Nothing matches “{query}”",
    addFavorite: "Add to favorites",
    removeFavorite: "Remove from favorites",
    checkout: "Check out",
    filterTip: "Double-click to show this branch's history · right-click for actions",
    newBranch: "New branch from here…",
    merge: "Merge into current",
    rebase: "Rebase current onto this",
    deleteBranch: "Delete branch",
    deleteTag: "Delete tag",
    copyName: "Copy branch name",
    copyTagName: "Copy tag name",
    compare: "Compare with the working branch",
    pullBranch: "Pull",
    pushBranch: "Push",
    newTag: "New tag…",
    showHistory: "Show history",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    expandSection: "Expand every branch here",
    collapseSection: "Collapse every branch here",
  },
  zh: {
    searchBranches: "搜索分支和标签",
    localBranches: "本地",
    remoteBranches: "远程 · {remote}",
    tags: "标签",
    toPush: "{count} 个提交待 Push",
    toPull: "{count} 个提交待 Pull",
    others: "其它",
    protected: "受保护",
    currentBranch: "当前分支",
    noBranches: "没有分支或标签",
    noMatch: "没有匹配“{query}”的分支或标签",
    addFavorite: "收藏分支",
    removeFavorite: "取消收藏",
    checkout: "Checkout",
    filterTip: "双击查看该分支历史 · 右键查看更多操作",
    newBranch: "从此分支新建…",
    merge: "Merge 到当前分支",
    rebase: "Rebase 当前分支到此",
    deleteBranch: "删除分支",
    deleteTag: "删除标签",
    copyName: "复制分支名",
    copyTagName: "复制标签名",
    compare: "与当前分支比较",
    pullBranch: "Pull",
    pushBranch: "Push",
    newTag: "新建标签…",
    showHistory: "查看历史",
    expandAll: "全部展开",
    collapseAll: "全部收起",
    expandSection: "展开此处的所有分支",
    collapseSection: "收起此处的所有分支",
  },
} as const;

const TAG_SECTION_KEY = "tags";

/**
 * The branch tree of the branch page. A single click only selects the row for
 * reading; showing a branch's history and checking it out are deliberate, so
 * they live on double click and in the context menu. A section title folds or
 * unfolds every group beneath it, and the toolbar does the same for the whole
 * list, so a hundred remote branches are one click away.
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
  onDeleteTag,
  onNewTag,
  onCopy,
  onPull,
  onPush,
  onCompare,
}: {
  refs: RefsSnapshot | null;
  current: string;
  favorites: string[];
  /** Branch or tag whose history is shown; "" means every local and remote branch. */
  selected: string;
  onSelect: (name: string) => void;
  onCheckout: (name: string) => void;
  onToggleFavorite: (key: string) => void;
  onNewBranch: (start: string) => void;
  onMerge: (name: string) => void;
  onRebase: (name: string) => void;
  onDelete: (name: string) => void;
  onDeleteTag: (name: string) => void;
  onNewTag: (start: string) => void;
  onCopy: (text: string) => void;
  /** Pull the checked out branch, then push the given local branch. */
  onPull: (leaf: BranchLeaf) => void;
  onPush: (leaf: BranchLeaf) => void;
  onCompare: (ref: string) => void;
}) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // A single click picks a tag for reading; the selection is not the history
  // scope, so it never repaints the log on its own.
  const [pickedTag, setPickedTag] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);

  const sections = useMemo(() => buildBranchSections(refs, current), [refs, current]);
  const visible = useMemo(() => searchSections(sections, query), [sections, query]);
  const tags = useMemo(() => buildTagLeaves(refs), [refs]);
  const visibleTags = useMemo(() => searchTags(tags, query), [tags, query]);
  const leaves = useMemo(() => flattenSections(visible), [visible]);
  const searching = query.trim() !== "";

  const groupKey = (sectionKey: string, group: BranchGroup) => `${sectionKey}/${group.name}`;
  const isCollapsed = (sectionKey: string, group: BranchGroup) =>
    searching ? false : (collapsed[groupKey(sectionKey, group)] ?? groupStartsCollapsed(group.branches.length));
  const tagCollapsed = searching ? false : (collapsed[TAG_SECTION_KEY] ?? tags.length > COLLAPSE_THRESHOLD);

  const groupLabel = (group: BranchGroup) =>
    group.name === "others" ? t("others") : group.name === "protected" ? t("protected") : group.name;

  /** Folds or unfolds every group of one section at once. */
  const toggleSection = (section: BranchSection) => {
    const close = section.groups.some((group) => !isCollapsed(section.key, group));
    const next = { ...collapsed };
    for (const group of section.groups) next[groupKey(section.key, group)] = close;
    setCollapsed(next);
  };

  const sectionClosed = (section: BranchSection) =>
    section.groups.length > 0 && section.groups.every((group) => isCollapsed(section.key, group));

  /** The toolbar's expand/collapse acts on every section, tags included. */
  const setAllCollapsed = (close: boolean) => {
    const next: Record<string, boolean> = { ...collapsed };
    for (const section of sections) {
      for (const group of section.groups) next[groupKey(section.key, group)] = close;
    }
    next[TAG_SECTION_KEY] = close;
    setCollapsed(next);
  };

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
      { label: t("compare"), icon: "diff", disabled: leaf.current, onClick: () => onCompare(leaf.name) },
      { separator: true },
      { label: t("copyName"), icon: "copy", onClick: () => onCopy(leaf.name) },
    ];
    if (leaf.remote === "" && !leaf.current) {
      items.push({ label: t("deleteBranch"), icon: "trash", danger: true, onClick: () => onDelete(leaf.name) });
    }
    setMenu({ x, y, items });
  };

  const tagMenu = (tag: TagLeaf, x: number, y: number) => {
    setMenu({
      x,
      y,
      items: [
        { label: t("showHistory"), icon: "log", onClick: () => onSelect(tag.name) },
        { label: t("checkout"), icon: "branch", onClick: () => onCheckout(tag.name) },
        { label: t("newBranch"), icon: "plus", onClick: () => onNewBranch(tag.name) },
        { label: t("compare"), icon: "diff", onClick: () => onCompare(tag.name) },
        { separator: true },
        { label: t("copyTagName"), icon: "copy", onClick: () => onCopy(tag.name) },
        { label: t("deleteTag"), icon: "trash", danger: true, onClick: () => onDeleteTag(tag.name) },
      ],
    });
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
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon name="star" size={12} />
        </button>
      </div>
    );
  };

  const tagRow = (tag: TagLeaf) => {
    const active = selected === tag.name || pickedTag === tag.name;
    return (
      <div
        key={"tag:" + tag.key}
        className={cx("bp-tag", active && "selected")}
        role="treeitem"
        aria-selected={active}
        title={`${tag.name} · ${tag.short}\n${tag.subject}\n${formatWhen(tag.time)}`}
        onClick={() => setPickedTag(tag.name)}
        onDoubleClick={() => onSelect(tag.name)}
        onContextMenu={(e) => {
          e.preventDefault();
          tagMenu(tag, e.clientX, e.clientY);
        }}
      >
        <span className="bp-tag-line">
          <Icon name="tag" size={11} />
          <span className="bp-tag-name">{tag.name}</span>
          <span className="bp-tag-time">{formatWhen(tag.time)}</span>
        </span>
        <span className="bp-tag-meta">
          <code>{tag.short}</code>
          <span className="bp-tag-subject">{tag.subject}</span>
        </span>
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
        <span className="branch-list-actions">
          <IconButton icon="expand" title={t("expandAll")} small onClick={() => setAllCollapsed(false)} />
          <IconButton icon="collapse" title={t("collapseAll")} small onClick={() => setAllCollapsed(true)} />
        </span>
      </div>
      <div className="picker-scroll branch-scroll" role="tree">
        {visible.map((section) => {
          const all = section.groups.flatMap((group) => group.branches);
          const closed = sectionClosed(section);
          // Favourites float to the top of their own section and leave the
          // groups behind, so a branch appears exactly once.
          const pinned = all.filter((leaf) => favorites.includes(leaf.key));
          const pinnedKeys = new Set(pinned.map((leaf) => leaf.key));
          const groups = section.groups
            .map((group) => ({ ...group, branches: group.branches.filter((leaf) => !pinnedKeys.has(leaf.key)) }))
            .filter((group) => group.branches.length > 0);
          return (
            <div className={cx("bp-section", section.remote && "remote")} key={section.key}>
              <div className="bp-section-title">
                <button
                  className="bp-section-toggle"
                  aria-expanded={!closed}
                  title={closed ? t("expandSection") : t("collapseSection")}
                  onClick={() => toggleSection(section)}
                >
                  <Icon name={closed ? "chevronRight" : "chevronDown"} size={11} />
                  <Icon name={section.remote ? "fetch" : "branch"} size={11} />
                  <span>
                    {section.remote ? t("remoteBranches", { remote: section.remote }) : t("localBranches")}
                  </span>
                  <span className="bp-count">{all.length}</span>
                </button>
              </div>
              {!closed && pinned.map((leaf) => leafRow(leaf, true))}
              {groups.map((group) => {
                const groupClosed = isCollapsed(section.key, group);
                return (
                  <div className="bp-group-block" key={section.key + group.name}>
                    <button
                      className="bp-group"
                      onClick={() =>
                        setCollapsed((prev) => ({ ...prev, [groupKey(section.key, group)]: !groupClosed }))
                      }
                    >
                      <Icon name={groupClosed ? "chevronRight" : "chevronDown"} size={11} />
                      <span className={cx("bp-dot", `tone-${group.tone}`)} />
                      <span className="bp-group-name">{groupLabel(group)}</span>
                      <span className="bp-count">{group.branches.length}</span>
                    </button>
                    {!groupClosed && group.branches.map((leaf) => leafRow(leaf))}
                  </div>
                );
              })}
            </div>
          );
        })}
        {visibleTags.length > 0 && (
          <div className="bp-section tags" key={TAG_SECTION_KEY}>
            <div className="bp-section-title">
              <button
                className="bp-section-toggle"
                aria-expanded={!tagCollapsed}
                title={tagCollapsed ? t("expandSection") : t("collapseSection")}
                onClick={() => setCollapsed((prev) => ({ ...prev, [TAG_SECTION_KEY]: !tagCollapsed }))}
              >
                <Icon name={tagCollapsed ? "chevronRight" : "chevronDown"} size={11} />
                <span>{t("tags")}</span>
                <span className="bp-count">{tags.length}</span>
              </button>
              <button
                className="bp-section-action"
                title={t("newTag")}
                onClick={() => onNewTag(refs?.head || "HEAD")}
              >
                <Icon name="plus" size={11} />
              </button>
            </div>
            {!tagCollapsed && visibleTags.map(tagRow)}
          </div>
        )}
        {leaves.length === 0 && visibleTags.length === 0 && (
          <div className="picker-empty">
            {searching ? t("noMatch", { query: query.trim() }) : t("noBranches")}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
