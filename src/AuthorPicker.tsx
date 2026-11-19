import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { useT } from "./i18n";
import { cx } from "./ui";

const T = {
  en: {
    author: "Author",
    allAuthors: "All authors",
    searchAuthors: "Search authors",
    commitsOne: "1 commit",
    commitsOther: "{n} commits",
    noAuthorMatch: "No author matches “{query}”",
  },
  zh: {
    author: "提交人",
    allAuthors: "全部提交人",
    searchAuthors: "搜索提交人",
    commitsOne: "1 次提交",
    commitsOther: "{n} 次提交",
    noAuthorMatch: "没有匹配“{query}”的提交人",
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
    if (top + height > window.innerHeight - 8) top = Math.max(8, anchor.top - height - 4);
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
  const ref = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const [anchor, setAnchor] = useState<{ left: number; right: number; bottom: number; top: number } | null>(null);
  const [query, setQuery] = useState("");
  // The keyboard cursor over the rows the popup shows, "All authors"
  // included; the search field keeps the keyboard while the arrows move it,
  // as a combo box's popup does.
  const [active, setActive] = useState(0);
  const isOpen = anchor !== null;

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActive(0);
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const q = query.trim().toLowerCase();
  const shown = authors.filter(
    (a) => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q),
  );

  useEffect(() => {
    rowRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (name: string) => {
    onChange(name);
    setAnchor(null);
  };

  return (
    <>
      <button
        ref={ref}
        className={cx("picker-trigger author", isOpen && "open")}
        title={t("author")}
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            setAnchor(null);
            return;
          }
          const rect = ref.current?.getBoundingClientRect();
          if (rect) setAnchor({ left: rect.left, right: rect.right, bottom: rect.bottom, top: rect.top });
        }}
      >
        <Icon name="user" size={13} />
        <span className="picker-trigger-label">{value || t("author")}</span>
        <Icon name="chevronDown" size={11} />
      </button>
      {isOpen && anchor && (
        <Popover anchor={anchor} width={280} onClose={() => setAnchor(null)}>
          <div className="picker-search">
            <Icon name="search" size={13} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={t("searchAuthors")}
              aria-label={t("searchAuthors")}
              onKeyDown={(e) => {
                // The field keeps the keyboard; the arrows walk the popup and
                // Enter takes the row, as a combo box's popup does.
                if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
                  e.preventDefault();
                  const last = shown.length;
                  setActive((at) => {
                    if (e.key === "Home") return 0;
                    if (e.key === "End") return last;
                    const next = at + (e.key === "ArrowDown" ? 1 : -1);
                    return Math.max(0, Math.min(last, next));
                  });
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (active === 0) pick("");
                  else if (shown[active - 1]) pick(shown[active - 1]!.name);
                }
              }}
            />
          </div>
          <div className="picker-scroll">
            <button
              ref={(el) => {
                if (el) rowRefs.current.set(0, el);
                else rowRefs.current.delete(0);
              }}
              className={cx("bp-scope", value === "" && "active", active === 0 && "cursor")}
              onMouseEnter={() => setActive(0)}
              onClick={() => pick("")}
            >
              <Icon name="check" size={11} className={cx(value === "" ? "" : "hidden")} />
              <span>{t("allAuthors")}</span>
            </button>
            {shown.map((author, index) => (
              <div
                key={author.name + author.email}
                ref={(el) => {
                  if (el) rowRefs.current.set(index + 1, el);
                  else rowRefs.current.delete(index + 1);
                }}
                className={cx(
                  "bp-leaf author-row",
                  value === author.name && "current",
                  active === index + 1 && "cursor",
                )}
                onMouseEnter={() => setActive(index + 1)}
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
