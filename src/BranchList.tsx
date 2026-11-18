import { useEffect, useMemo, useRef, useState } from "react";
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
    merge: "Merge “{branch}” into “{into}”",
    rebase: "Rebase current onto this",
    deleteBranch: "Delete branch",
    deleteRemoteBranch: "Delete remote branch",
    deleteTag: "Delete tag",
    copyName: "Copy branch name",
    copyTagName: "Copy tag name",
    checkoutUpdate: "Checkout and Update",
    updateSelected: "Update Selected",
    resetToRemote: "Reset to Remote Branch",
    pushTag: "Push Tag to origin",
    recent: "Recent",
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
    merge: "将“{branch}”合并到“{into}”",
    rebase: "Rebase 当前分支到此",
    deleteBranch: "删除分支",
    deleteRemoteBranch: "删除远程分支",
    deleteTag: "删除标签",
    copyName: "复制分支名",
    copyTagName: "复制标签名",
    checkoutUpdate: "检出并更新",
    updateSelected: "更新所选分支",
    resetToRemote: "重置到远端分支",
    pushTag: "推送标签到 origin",
    recent: "最近",
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
  recent,
  onCheckoutUpdate,
  onUpdateSelected,
  onResetToRemote,
  onPushTag,
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
  recent: string[];
  onCheckoutUpdate: (name: string) => void;
  onUpdateSelected: (name: string) => void;
  onResetToRemote: (name: string) => void;
  onPushTag: (name: string) => void;
}) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // A single click picks a tag for reading; the selection is not the history
  // scope, so it never repaints the log on its own.
  const [pickedTag, setPickedTag] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  // The keyboard cursor over the rows the tree is showing (favourites,
  // expanded groups and tags alike); -1 means the list has no focus.
  const [active, setActive] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

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

  // One description of what the tree shows, used both to paint it and to walk
  // it with the keyboard, so the two orders cannot drift apart.
  const layout = useMemo(
    () =>
      visible.map((section) => {
        const all = section.groups.flatMap((group) => group.branches);
        const closed = section.groups.length > 0 && section.groups.every((group) => isCollapsed(section.key, group));
        const pinned = all.filter((leaf) => favorites.includes(leaf.key));
        const pinnedKeys = new Set(pinned.map((leaf) => leaf.key));
        const groups = section.groups
          .map((group) => ({
            ...group,
            branches: group.branches.filter((leaf) => !pinnedKeys.has(leaf.key)),
          }))
          .filter((group) => group.branches.length > 0)
          .map((group) => ({ ...group, closed: isCollapsed(section.key, group) }));
        return { section, closed, pinned, groups, total: all.length };
      }),
    // isCollapsed reads `collapsed` and `searching` through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, favorites, collapsed, searching],
  );

  type Row = { kind: "leaf"; leaf: BranchLeaf } | { kind: "tag"; tag: TagLeaf };
  const rowId = (row: Row) => (row.kind === "leaf" ? `bp-branch-${row.leaf.key}` : `bp-tag-${row.tag.key}`);
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const view of layout) {
      if (view.closed) continue;
      for (const leaf of view.pinned) out.push({ kind: "leaf", leaf });
      for (const group of view.groups) {
        if (group.closed) continue;
        for (const leaf of group.branches) out.push({ kind: "leaf", leaf });
      }
    }
    if (!tagCollapsed) for (const tag of visibleTags) out.push({ kind: "tag", tag });
    return out;
  }, [layout, visibleTags, tagCollapsed]);
  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => map.set(rowId(row), index));
    return map;
  }, [rows]);
  const activeRow = active >= 0 ? rows[active] : undefined;
  // Collapsing a group can leave the cursor past the end of the visible rows.
  useEffect(() => {
    setActive((index) => (index >= rows.length ? rows.length - 1 : index));
  }, [rows.length]);

  /** Moves the keyboard cursor and keeps its row in sight. */
  const moveTo = (index: number) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setActive(next);
    listRef.current?.focus({ preventScroll: true });
    const row = rows[next]!;
    requestAnimationFrame(() => rowRefs.current.get(rowId(row))?.scrollIntoView({ block: "nearest" }));
  };

  // IDEA's branch popup runs on Enter: the branch is checked out, a tag opens
  // its history, exactly as the row's primary action does.
  const activateRow = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === "tag") onSelect(row.tag.name);
    else onCheckout(row.leaf.name);
  };

  const onRowKey = (e: React.KeyboardEvent) => {
    const current = active;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveTo(current < 0 ? 0 : current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveTo(current < 0 ? rows.length - 1 : current - 1);
        break;
      case "PageDown":
        e.preventDefault();
        moveTo(current < 0 ? 0 : current + 10);
        break;
      case "PageUp":
        e.preventDefault();
        moveTo(current < 0 ? rows.length - 1 : current - 10);
        break;
      case "Home":
        e.preventDefault();
        moveTo(0);
        break;
      case "End":
        e.preventDefault();
        moveTo(rows.length - 1);
        break;
      case "Enter":
        e.preventDefault();
        activateRow(activeRow);
        break;
      case " ":
        // IDEA toggles the favorite of the selected branch with Space.
        if (activeRow?.kind === "leaf") {
          e.preventDefault();
          onToggleFavorite(activeRow.leaf.key);
        }
        break;
      case "Delete":
      case "Backspace":
        // The popup's own delete actions, which ask before removing anything.
        if (activeRow?.kind === "leaf") {
          e.preventDefault();
          onDelete(activeRow.leaf.name);
        } else if (activeRow?.kind === "tag") {
          e.preventDefault();
          onDeleteTag(activeRow.tag.name);
        }
        break;
      case "f":
      case "F":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
        }
        break;
      case "Escape":
        e.preventDefault();
        setActive(-1);
        searchRef.current?.focus();
        break;
      default:
        break;
    }
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // An IME uses Enter and the arrows to commit or pick a candidate.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(e.key === "ArrowDown" ? 0 : rows.length - 1);
      return;
    }
    if (e.key === "Enter") {
      const row = activeRow ?? rows[0];
      if (row) {
        e.preventDefault();
        activateRow(row);
      }
      return;
    }
    if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      setQuery("");
      setActive(-1);
    }
  };

  const groupLabel = (group: BranchGroup) =>
    group.name === "others" ? t("others") : group.name === "protected" ? t("protected") : group.name;

  /** Folds or unfolds every group of one section at once. */
  const toggleSection = (section: BranchSection) => {
    const close = section.groups.some((group) => !isCollapsed(section.key, group));
    const next = { ...collapsed };
    for (const group of section.groups) next[groupKey(section.key, group)] = close;
    setCollapsed(next);
  };

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
      { label: t("merge", { branch: leaf.name, into: current }), icon: "merge", onClick: () => onMerge(leaf.name) },
      { label: t("rebase"), icon: "rebase", onClick: () => onRebase(leaf.name) },
      ...(leaf.remote === ""
        ? ([
            { separator: true } as ContextItem,
            // A pull only makes sense for the branch that is checked out.
            ...(leaf.current
              ? [{ label: t("pullBranch"), icon: "pull", onClick: () => onPull(leaf) } as ContextItem]
              : []),
            { label: t("pushBranch"), icon: "push", onClick: () => onPush(leaf) } as ContextItem,
            ...(leaf.current
              ? []
              : [
                  {
                    label: t("checkoutUpdate"),
                    icon: "pull",
                    onClick: () => onCheckoutUpdate(leaf.name),
                  } as ContextItem,
                ]),
            { label: t("updateSelected"), icon: "refresh", onClick: () => onUpdateSelected(leaf.name) } as ContextItem,
            { label: t("resetToRemote"), icon: "reset", danger: true, onClick: () => onResetToRemote(leaf.name) } as ContextItem,
          ])
        : []),
      { separator: true },
      { label: t("compare"), icon: "diff", disabled: leaf.current, onClick: () => onCompare(leaf.name) },
      { separator: true },
      { label: t("copyName"), icon: "copy", onClick: () => onCopy(leaf.name) },
    ];
    if (!leaf.current) {
      items.push({
        label: leaf.remote === "" ? t("deleteBranch") : t("deleteRemoteBranch"),
        icon: "trash",
        danger: true,
        onClick: () => onDelete(leaf.name),
      });
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
        { label: t("pushTag"), icon: "push", onClick: () => onPushTag(tag.name) },
        { label: t("deleteTag"), icon: "trash", danger: true, onClick: () => onDeleteTag(tag.name) },
      ],
    });
  };

  const leafRow = (leaf: BranchLeaf, full = false) => {
    const starredNow = favorites.includes(leaf.key);
    const id = `bp-branch-${leaf.key}`;
    const cursor = active >= 0 && rowIndex.get(id) === active;
    return (
      <div
        key={(full ? "fav:" : "") + leaf.key}
        id={id}
        ref={(el) => {
          if (el) rowRefs.current.set(id, el);
          else rowRefs.current.delete(id);
        }}
        className={cx(
          "bp-leaf",
          !full && "nested",
          leaf.current && "current",
          selected === leaf.name && "selected",
          cursor && "cursor",
        )}
        title={leaf.upstream ? `${leaf.name} → ${leaf.upstream}` : t("filterTip")}
        onClick={() => {
          setActive(rowIndex.get(id) ?? -1);
          // Put the keyboard in the tree, where the arrows work.
          listRef.current?.focus({ preventScroll: true });
        }}
        // The keyboard cursor follows the pointer, as IDEA's popup tree does:
        // Enter then acts on the row under the mouse.
        onMouseEnter={() => setActive(rowIndex.get(id) ?? -1)}
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
    const picked = selected === tag.name || pickedTag === tag.name;
    const id = `bp-tag-${tag.key}`;
    const cursor = active >= 0 && rowIndex.get(id) === active;
    return (
      <div
        key={"tag:" + tag.key}
        id={id}
        ref={(el) => {
          if (el) rowRefs.current.set(id, el);
          else rowRefs.current.delete(id);
        }}
        className={cx("bp-tag", picked && "selected", cursor && "cursor")}
        role="treeitem"
        aria-selected={picked}
        title={`${tag.name} · ${tag.short}\n${tag.subject}\n${formatWhen(tag.time)}`}
        onClick={() => {
          setPickedTag(tag.name);
          setActive(rowIndex.get(id) ?? -1);
          listRef.current?.focus({ preventScroll: true });
        }}
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
          ref={searchRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onSearchKey}
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
      {!searching && recent.length > 0 && (
        <div className="branch-recent">
          <span className="branch-recent-label">{t("recent")}</span>
          {recent.map((name) => (
            <button
              key={name}
              className={cx("branch-recent-chip", name === current && "current")}
              title={name}
              onClick={() => onSelect(name)}
              onDoubleClick={() => onCheckout(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div
        className="picker-scroll branch-scroll"
        role="tree"
        ref={listRef}
        tabIndex={0}
        aria-activedescendant={activeRow ? rowId(activeRow) : undefined}
        onKeyDown={onRowKey}
      >
        {layout.map(({ section, closed, pinned, groups, total: all }) => {
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
                  <span className="bp-count">{all}</span>
                </button>
              </div>
              {!closed && pinned.map((leaf) => leafRow(leaf, true))}
              {groups.map((group) => {
                const groupClosed = group.closed;
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
