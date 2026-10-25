import { useLayoutEffect, useRef, useState } from "react";
import type { RefsSnapshot, RepoRef } from "./mygo";
import { Icon } from "./icons";
import { cx, IconButton, formatWhen } from "./ui";

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
          {(refItem.ahead === -1 || refItem.behind === -1) && <span className="gone"> gone</span>}
        </span>
      )}
      <span className="ref-subject">{refItem.subject}</span>
      <span className="ref-time">{formatWhen(refItem.time)}</span>
      <span className="ref-actions" onClick={(e) => e.stopPropagation()}>
        <button className="mini-icon" title="Log for this branch" onClick={onFilterLog}>
          <Icon name="log" size={13} />
        </button>
        <button className="mini-icon" title="Merge into current branch" onClick={onMerge}>
          <Icon name="merge" size={13} />
        </button>
        {refItem.type === "local" && (
          <button className="mini-icon" title="Rebase current branch onto this branch" onClick={onRebase}>
            <Icon name="rebase" size={13} />
          </button>
        )}
        <button className="mini-icon danger" title="Delete branch" onClick={onDelete}>
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
    <div className="branch-popup" style={pos} ref={ref} role="dialog" aria-label="Branches">
      <div className="popup-search">
        <Icon name="search" size={13} />
        <input
          placeholder="Search branches"
          value={search}
          autoFocus
          onChange={(e) => setSearch(e.target.value)}
        />
        <IconButton icon="close" title="Close" small onClick={onClose} />
      </div>
      <div className="popup-actions">
        <button className="popup-action" onClick={onNewBranch}>
          <Icon name="plus" /> New Branch
        </button>
        <button className="popup-action" onClick={onFetch}>
          <Icon name="fetch" /> Fetch
        </button>
        <button className="popup-action" onClick={onPull}>
          <Icon name="pull" /> Pull
        </button>
        <button className="popup-action" onClick={onPush}>
          <Icon name="push" /> Push
        </button>
      </div>
      <div className="popup-scroll">
        <div className="popup-section-title">
          Current
          {detached && <span className="muted">detached HEAD</span>}
        </div>
        {current && !detached && (
          <div className="ref-row current">
            <span className="ref-icon">
              <Icon name="check" />
            </span>
            <span className="ref-name">{current}</span>
            <span className="spacer" />
            <span className="muted">checked out</span>
          </div>
        )}
        <div className="popup-section-title">Local branches</div>
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
        <div className="popup-section-title">Remote branches</div>
        {remote.length === 0 && <div className="popup-empty">No remote branches</div>}
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
          <Icon name={showTags ? "chevronDown" : "chevronRight"} size={11} /> Tags ({refs.tags.length})
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
        {noResults && <div className="popup-empty">No branch matches “{search}”</div>}
      </div>
    </div>
  );
}
