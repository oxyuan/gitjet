import { useLayoutEffect, useRef, useState } from "react";
import type { RefsSnapshot, RepoRef } from "./mygo";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { cx, IconButton, formatWhen } from "./ui";

const T = {
  en: {
    branches: "Branches",
    searchBranches: "Search branches",
    close: "Close",
    newBranch: "New Branch",
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
    current: "Current",
    detachedHead: "detached HEAD",
    checkedOut: "checked out",
    localBranches: "Local branches",
    remoteBranches: "Remote branches",
    noRemoteBranches: "No remote branches",
    tags: "Tags ({n})",
    noMatch: "No branch matches “{query}”",
    filterLog: "Log for this branch",
    merge: "Merge into current branch",
    rebase: "Rebase current branch onto this branch",
    deleteBranch: "Delete branch",
    gone: " gone",
  },
  zh: {
    branches: "分支",
    searchBranches: "搜索分支",
    close: "关闭",
    newBranch: "新建分支",
    fetch: "获取",
    pull: "拉取",
    push: "推送",
    current: "当前",
    detachedHead: "HEAD 已分离",
    checkedOut: "已检出",
    localBranches: "本地分支",
    remoteBranches: "远程分支",
    noRemoteBranches: "无远程分支",
    tags: "标签（{n}）",
    noMatch: "没有匹配“{query}”的分支",
    filterLog: "查看此分支的日志",
    merge: "合并到当前分支",
    rebase: "将当前分支变基到此分支",
    deleteBranch: "删除分支",
    gone: " 已失效",
  },
} as const;

function RefRow({
  refItem,
  current,
  onCheckout,
  onMerge,
  onRebase,
  onDelete,
  onFilterLog,
}: {
  refItem: RepoRef;
  current: string;
  onCheckout: () => void;
  onMerge: () => void;
  onRebase: () => void;
  onDelete: () => void;
  onFilterLog: () => void;
}) {
  const t = useT(T);
  const isCurrent = refItem.name === current && refItem.type === "local";
  return (
    <div
      className={cx("ref-row", isCurrent && "current")}
      onClick={onCheckout}
      title={`${refItem.name}\n${refItem.subject}`}
    >
      <span className="ref-icon">
        <Icon name={isCurrent ? "check" : refItem.type === "tag" ? "tag" : "branch"} />
      </span>
      <span className="ref-name">{refItem.name}</span>
      {refItem.upstream && (
        <span className="ref-upstream">
          {refItem.upstream}
          {refItem.ahead > 0 && <span className="ahead"> ↑{refItem.ahead}</span>}
          {refItem.behind > 0 && <span className="behind"> ↓{refItem.behind}</span>}
          {(refItem.ahead === -1 || refItem.behind === -1) && <span className="gone">{t("gone")}</span>}
        </span>
      )}
      <span className="ref-subject">{refItem.subject}</span>
      <span className="ref-time">{formatWhen(refItem.time)}</span>
      <span className="ref-actions" onClick={(e) => e.stopPropagation()}>
        <button className="mini-icon" title={t("filterLog")} onClick={onFilterLog}>
          <Icon name="log" size={13} />
        </button>
        <button className="mini-icon" title={t("merge")} onClick={onMerge}>
          <Icon name="merge" size={13} />
        </button>
        {refItem.type === "local" && (
          <button className="mini-icon" title={t("rebase")} onClick={onRebase}>
            <Icon name="rebase" size={13} />
          </button>
        )}
        <button className="mini-icon danger" title={t("deleteBranch")} onClick={onDelete}>
          <Icon name="trash" size={13} />
        </button>
      </span>
    </div>
  );
}

export function BranchPopup({
  refs,
  current,
  detached,
  x,
  y,
  onClose,
  onCheckout,
  onNewBranch,
  onMerge,
  onRebase,
  onDelete,
  onFetch,
  onPull,
  onPush,
  onFilterLog,
}: {
  refs: RefsSnapshot;
  current: string;
  detached: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onCheckout: (name: string) => void;
  onNewBranch: () => void;
  onMerge: (name: string) => void;
  onRebase: (name: string) => void;
  onDelete: (name: string) => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onFilterLog: (name: string) => void;
}) {
  const t = useT(T);
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y - rect.height;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top < 8) top = 8;
    setPos({ left, top });
  }, [x, y]);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const match = (r: RepoRef) => r.name.toLowerCase().includes(search.toLowerCase());
  const local = refs.local.filter(match);
  const remote = refs.remote.filter((r) => !r.symbolic && match(r));
  const tags = refs.tags.filter(match);
  const noResults = local.length === 0 && remote.length === 0 && tags.length === 0;

  return (
    <div className="branch-popup" style={pos} ref={ref} role="dialog" aria-label={t("branches")}>
      <div className="popup-search">
        <Icon name="search" size={13} />
        <input
          placeholder={t("searchBranches")}
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
        />
        <IconButton icon="close" title={t("close")} small onClick={onClose} />
      </div>
      <div className="popup-actions">
        <button className="popup-action" onClick={onNewBranch}>
          <Icon name="plus" /> {t("newBranch")}
        </button>
        <button className="popup-action" onClick={onFetch}>
          <Icon name="fetch" /> {t("fetch")}
        </button>
        <button className="popup-action" onClick={onPull}>
          <Icon name="pull" /> {t("pull")}
        </button>
        <button className="popup-action" onClick={onPush}>
          <Icon name="push" /> {t("push")}
        </button>
      </div>
      <div className="popup-scroll">
        <div className="popup-section-title">
          {t("current")}
          {detached && <span className="muted">{t("detachedHead")}</span>}
        </div>
        {current && !detached && (
          <div className="ref-row current">
            <span className="ref-icon">
              <Icon name="check" />
            </span>
            <span className="ref-name">{current}</span>
            <span className="spacer" />
            <span className="muted">{t("checkedOut")}</span>
          </div>
        )}
        <div className="popup-section-title">{t("localBranches")}</div>
        {local.map((r) => (
          <RefRow
            key={r.fullName}
            refItem={r}
            current={current}
            onCheckout={() => {
              onClose();
              onCheckout(r.name);
            }}
            onMerge={() => {
              onClose();
              onMerge(r.name);
            }}
            onRebase={() => {
              onClose();
              onRebase(r.name);
            }}
            onDelete={() => {
              onClose();
              onDelete(r.name);
            }}
            onFilterLog={() => {
              onClose();
              onFilterLog(r.name);
            }}
          />
        ))}
        <div className="popup-section-title">{t("remoteBranches")}</div>
        {remote.length === 0 && <div className="popup-empty">{t("noRemoteBranches")}</div>}
        {remote.map((r) => (
          <RefRow
            key={r.fullName}
            refItem={r}
            current={current}
            onCheckout={() => {
              onClose();
              onCheckout(r.name);
            }}
            onMerge={() => {
              onClose();
              onMerge(r.name);
            }}
            onRebase={() => {
              onClose();
              onRebase(r.name);
            }}
            onDelete={() => {
              onClose();
              onDelete(r.name);
            }}
            onFilterLog={() => {
              onClose();
              onFilterLog(r.name);
            }}
          />
        ))}
        <button className="popup-section-title tags-toggle" onClick={() => setShowTags((v) => !v)}>
          <Icon name={showTags ? "chevronDown" : "chevronRight"} size={11} /> {t("tags", { n: refs.tags.length })}
        </button>
        {showTags &&
          tags.map((r) => (
            <RefRow
              key={r.fullName}
              refItem={r}
              current={current}
              onCheckout={() => {
                onClose();
                onCheckout(r.name);
              }}
              onMerge={() => {
                onClose();
                onMerge(r.name);
              }}
              onRebase={() => {
                onClose();
                onRebase(r.name);
              }}
              onDelete={() => {
                onClose();
                onDelete(r.name);
              }}
              onFilterLog={() => {
                onClose();
                onFilterLog(r.name);
              }}
            />
          ))}
        {noResults && <div className="popup-empty">{t("noMatch", { query: search })}</div>}
      </div>
    </div>
  );
}
