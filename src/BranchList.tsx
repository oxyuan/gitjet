import { useMemo, useState } from "react";
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
    searchBranches: "Search branches",
    favorites: "Favourites",
    localBranches: "Local",
    remoteBranches: "Remote · {remote}",
    others: "Others",
    protected: "Protected",
    allBranches: "All branches",
    currentBranch: "Current branch",
    current: "Current",
    addFavorite: "Add to favourites",
    removeFavorite: "Remove from favourites",
    noMatch: "No branch matches “{query}”",
    noBranches: "No branches",
  },
  zh: {
    searchBranches: "搜索分支",
    favorites: "收藏",
    localBranches: "本地",
    remoteBranches: "远程 · {remote}",
    others: "其他",
    protected: "受保护",
    allBranches: "所有分支",
    currentBranch: "当前分支",
    current: "当前",
    addFavorite: "收藏分支",
    removeFavorite: "取消收藏",
    noMatch: "没有匹配“{query}”的分支",
    noBranches: "没有分支",
  },
} as const;

/** The branch tree of the log page: search, scopes, favourites, groups. */
export function BranchList({
  refs,
  current,
  value,
  favorites,
  onPick,
  onToggleFavorite,
}: {
  refs: RefsSnapshot | null;
  current: string;
  value: string;
  favorites: string[];
  onPick: (name: "all" | "current" | string) => void;
  onToggleFavorite: (key: string) => void;
}) {
  const t = useT(T);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => buildBranchSections(refs, current), [refs, current]);
  const visible = useMemo(() => searchSections(sections, query), [sections, query]);
  const starred = useMemo(() => favoriteLeaves(sections, favorites), [sections, favorites]);
  const leaves = useMemo(() => flattenSections(visible), [visible]);
  const searching = query.trim() !== "";

  const groupKey = (sectionKey: string, group: BranchGroup) => `${sectionKey}/${group.name}`;
  const isCollapsed = (sectionKey: string, group: BranchGroup) =>
    searching ? false : (collapsed[groupKey(sectionKey, group)] ?? group.branches.length > COLLAPSE_THRESHOLD);

  const groupLabel = (group: BranchGroup) =>
    group.name === "others" ? t("others") : group.name === "protected" ? t("protected") : group.name;

  const leafRow = (leaf: BranchLeaf, full = false) => {
    const starredNow = favorites.includes(leaf.key);
    return (
      <div
        key={(full ? "fav:" : "") + leaf.key}
        className={cx("bp-leaf", !full && "nested", leaf.current && "current", value === leaf.name && "selected")}
        title={leaf.name}
        onClick={() => onPick(leaf.name)}
        role="option"
        aria-selected={value === leaf.name}
      >
        <span className="bp-leaf-name">{full ? leaf.name : leaf.label}</span>
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
      <div className="picker-scroll branch-scroll">
        <div className="bp-scopes">
          <button className={cx("bp-scope", value === "all" && "active")} onClick={() => onPick("all")}>
            <Icon name="check" size={11} className={cx(value === "all" ? "" : "hidden")} />
            <span>{t("allBranches")}</span>
          </button>
          <button className={cx("bp-scope", value === "current" && "active")} onClick={() => onPick("current")}>
            <Icon name="check" size={11} className={cx(value === "current" ? "" : "hidden")} />
            <span>{t("currentBranch")}</span>
            {current && <span className="bp-scope-hint">{current}</span>}
          </button>
        </div>
        {starred.length > 0 && (
          <div className="bp-section">
            <div className="bp-section-title">
              <Icon name="star" size={11} className="bp-fav-mark" />
              {t("favorites")}
              <span className="bp-count">{starred.length}</span>
            </div>
            {starred.map((leaf) => leafRow(leaf, true))}
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
        ))}
        {leaves.length === 0 && starred.length === 0 && (
          <div className="picker-empty">
            {searching ? t("noMatch", { query: query.trim() }) : t("noBranches")}
          </div>
        )}
      </div>
    </div>
  );
}
