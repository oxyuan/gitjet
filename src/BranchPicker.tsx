import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  buildBranchSections,
  COLLAPSE_THRESHOLD,
  favoriteLeaves,
  flattenSections,
  searchSections,
  type BranchGroup,
  type BranchLeaf,
} from "./branches";
import { Icon } from "./icons";
import { useT } from "./i18n";
import type { RefsSnapshot } from "./mygo";
import { cx } from "./ui";

const T = {
  en: {
    branchFilter: "Branch filter",
    allBranches: "All branches",
    currentBranch: "Current branch",
    searchBranches: "Search branches",
    favorites: "Favourites",
    localBranches: "Local",
    remoteBranches: "Remote · {remote}",
    others: "Others",
    protected: "Protected",
    current: "Current",
    addFavorite: "Add to favourites",
    removeFavorite: "Remove from favourites",
    noMatch: "No branch matches “{query}”",
    noAuthorMatch: "No author matches “{query}”",
    noBranches: "No branches",
    author: "Author",
    allAuthors: "All authors",
    searchAuthors: "Search authors",
    commitsOne: "1 commit",
    commitsOther: "{n} commits",
  },
  zh: {
    branchFilter: "分支筛选",
    allBranches: "所有分支",
    currentBranch: "当前分支",
    searchBranches: "搜索分支",
    favorites: "收藏",
    localBranches: "本地",
    remoteBranches: "远程 · {remote}",
    others: "其他",
    protected: "受保护",
    current: "当前",
    addFavorite: "收藏分支",
    removeFavorite: "取消收藏",
    noMatch: "没有匹配“{query}”的分支",
    noAuthorMatch: "没有匹配“{query}”的提交人",
    noBranches: "没有分支",
    author: "提交人",
    allAuthors: "全部提交人",
    searchAuthors: "搜索提交人",
    commitsOne: "1 次提交",
    commitsOther: "{n} 次提交",
  },
} as const;

/** A small floating panel anchored under its trigger. */
function Popover({
  anchor,
  width,
  onClose,
  children,
}: {
  anchor: { left: number; right: number; bottom: number; top: number };
  width: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    const w = Math.min(width, window.innerWidth - 16);
    let left = anchor.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (left < 8) left = 8;
    let top = anchor.bottom + 4;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, anchor.top - height - 4);
    }
    setPos({ left, top });
  }, [anchor, width]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="picker-popover"
      ref={ref}
      role="dialog"
      style={{ width: Math.min(width, window.innerWidth - 16), left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

function useAnchor() {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; right: number; bottom: number; top: number } | null>(null);
  const open = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor({ left: rect.left, right: rect.right, bottom: rect.bottom, top: rect.top });
  };
  const close = () => setAnchor(null);
  return { ref, anchor, open, close, isOpen: anchor !== null };
}

export type BranchPickMode = "filter" | "checkout";

export function BranchPicker({
  refs,
  current,
  value,
  mode,
  favorites,
  onToggleFavorite,
  onPick,
  disabled,
}: {
  refs: RefsSnapshot | null;
  current: string;
  /** "all", "current", or a branch name (filter mode only). */
  value: string;
  mode: BranchPickMode;
  /** Keys (ref full names) the user starred. */
  favorites: string[];
  onToggleFavorite: (key: string) => void;
  onPick: (leaf: BranchLeaf | "all" | "current") => void;
  disabled?: boolean;
}) {
  const t = useT(T);
  const { ref, anchor, open, close, isOpen } = useAnchor();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  const sections = useMemo(() => buildBranchSections(refs, current), [refs, current]);
  const visible = useMemo(() => searchSections(sections, query), [sections, query]);
  const starred = useMemo(() => {
    const all = favoriteLeaves(sections, favorites);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const inView = new Set(flattenSections(visible).map((leaf) => leaf.key));
    return all.filter((leaf) => inView.has(leaf.key));
  }, [sections, favorites, visible, query]);
  const leaves = useMemo(() => flattenSections(visible), [visible]);
  const searching = query.trim() !== "";

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(-1);
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const groupKey = (sectionKey: string, group: BranchGroup) => `${sectionKey}/${group.name}`;
  const isCollapsed = (sectionKey: string, group: BranchGroup) => {
    if (searching) return false;
    return collapsed[groupKey(sectionKey, group)] ?? group.branches.length > COLLAPSE_THRESHOLD;
  };

  const toggleGroup = (sectionKey: string, group: BranchGroup) => {
    const key = groupKey(sectionKey, group);
    const next = !isCollapsed(sectionKey, group);
    setCollapsed((prev) => ({ ...prev, [key]: next }));
  };

  const pick = (leaf: BranchLeaf | "all" | "current") => {
    onPick(leaf);
    close();
  };

  const groupLabel = (group: BranchGroup) =>
    group.name === "others" ? t("others") : group.name === "protected" ? t("protected") : group.name;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(leaves.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0 && leaves[activeIndex]) {
      e.preventDefault();
      pick(leaves[activeIndex]!);
    }
  };

  const triggerLabel =
    mode === "filter"
      ? value === "all"
        ? t("allBranches")
        : value === "current"
          ? t("currentBranch")
          : value
      : current || t("currentBranch");

  const leafRow = (leaf: BranchLeaf, opts: { nested: boolean; full?: boolean; index?: number }) => {
    const starredNow = favorites.includes(leaf.key);
    return (
      <div
        key={(opts.full ? "fav:" : "") + leaf.key}
        className={cx(
          "bp-leaf",
          opts.nested && "nested",
          leaf.current && "current",
          opts.index !== undefined && opts.index === activeIndex && "active",
        )}
        title={leaf.name}
        onClick={() => pick(leaf)}
        onMouseEnter={() => opts.index !== undefined && setActiveIndex(opts.index!)}
        role="option"
        aria-selected={leaf.current}
      >
        <span className="bp-leaf-name">{opts.full ? leaf.name : leaf.label}</span>
        {leaf.current && (
          <span className="bp-current" title={t("currentBranch")}>
            <Icon name="check" size={11} />
            <span>{t("current")}</span>
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
    <>
      <button
        ref={ref}
        className={cx("picker-trigger", isOpen && "open")}
        title={t("branchFilter")}
        onClick={() => (isOpen ? close() : open())}
        disabled={disabled}
      >
        <Icon name="branch" size={13} />
        <span className="picker-trigger-label">{triggerLabel}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {isOpen && anchor && (
        <Popover anchor={anchor} width={340} onClose={close}>
          <div className="picker-search">
            <Icon name="search" size={13} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(-1);
              }}
              onKeyDown={onKeyDown}
              placeholder={t("searchBranches")}
              aria-label={t("searchBranches")}
            />
          </div>
          <div className="picker-scroll">
            {mode === "filter" && (
              <div className="bp-scopes">
                <button
                  className={cx("bp-scope", value === "current" && "active")}
                  onClick={() => pick("current")}
                >
                  <Icon name="check" size={11} className={cx(value === "current" ? "" : "hidden")} />
                  <span>{t("currentBranch")}</span>
                  {current && <span className="bp-scope-hint">{current}</span>}
                </button>
                <button className={cx("bp-scope", value === "all" && "active")} onClick={() => pick("all")}>
                  <Icon name="check" size={11} className={cx(value === "all" ? "" : "hidden")} />
                  <span>{t("allBranches")}</span>
                </button>
              </div>
            )}
            {starred.length > 0 && (
              <div className="bp-section">
                <div className="bp-section-title">
                  <Icon name="star" size={11} className="bp-fav-mark" />
                  {t("favorites")}
                  <span className="bp-count">{starred.length}</span>
                </div>
                {starred.map((leaf) => leafRow(leaf, { nested: false, full: true }))}
              </div>
            )}
            {visible.map((section) => (
              <div className="bp-section" key={section.key}>
                <div className="bp-section-title">
                  {section.remote ? t("remoteBranches", { remote: section.remote }) : t("localBranches")}
                </div>
                {section.groups.map((group) => {
                  const closed = isCollapsed(section.key, group);
                  return (
                    <div className="bp-group-block" key={section.key + group.name}>
                      <button className="bp-group" onClick={() => toggleGroup(section.key, group)}>
                        <Icon name={closed ? "chevronRight" : "chevronDown"} size={11} />
                        <span className={cx("bp-dot", `tone-${group.tone}`)} />
                        <span className="bp-group-name">{groupLabel(group)}</span>
                        <span className="bp-count">{group.branches.length}</span>
                      </button>
                      {!closed &&
                        group.branches.map((leaf) => leafRow(leaf, { nested: true, index: leaves.indexOf(leaf) }))}
                    </div>
                  );
                })}
              </div>
            ))}
            {leaves.length === 0 && starred.length === 0 && (
              <div className="picker-empty">
                {searching ? t("noMatch", { query: query.trim() }) : t("noBranches")}
              </div>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

export interface AuthorOption {
  name: string;
  email: string;
  count: number;
}

export function AuthorPicker({
  authors,
  value,
  onChange,
  disabled,
}: {
  authors: AuthorOption[];
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
}) {
  const t = useT(T);
  const { ref, anchor, open, close, isOpen } = useAnchor();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const q = query.trim().toLowerCase();
  const shown = authors.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
  );

  const pick = (name: string) => {
    onChange(name);
    close();
  };

  return (
    <>
      <button
        ref={ref}
        className={cx("picker-trigger author", isOpen && "open")}
        title={t("author")}
        onClick={() => (isOpen ? close() : open())}
        disabled={disabled}
      >
        <Icon name="user" size={13} />
        <span className="picker-trigger-label">{value || t("author")}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {isOpen && anchor && (
        <Popover anchor={anchor} width={280} onClose={close}>
          <div className="picker-search">
            <Icon name="search" size={13} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchAuthors")}
              aria-label={t("searchAuthors")}
            />
          </div>
          <div className="picker-scroll">
            <button className={cx("bp-scope", value === "" && "active")} onClick={() => pick("")}>
              <Icon name="check" size={11} className={cx(value === "" ? "" : "hidden")} />
              <span>{t("allAuthors")}</span>
            </button>
            {shown.map((author) => (
              <div
                key={author.name + author.email}
                className={cx("bp-leaf author-row", value === author.name && "current")}
                onClick={() => pick(author.name)}
                title={`${author.name} <${author.email}>`}
              >
                <span className="bp-avatar">{(author.name || "?").slice(0, 1).toUpperCase()}</span>
                <span className="bp-leaf-name">{author.name}</span>
                <span className="bp-count">
                  {author.count === 1 ? t("commitsOne") : t("commitsOther", { n: author.count })}
                </span>
              </div>
            ))}
            {shown.length === 0 && <div className="picker-empty">{t("noAuthorMatch", { query: query.trim() })}</div>}
          </div>
        </Popover>
      )}
    </>
  );
}
