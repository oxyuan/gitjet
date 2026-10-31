import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { useT } from "./i18n";

const T = {
  en: {
    close: "Close",
    ok: "OK",
    cancel: "Cancel",
    dismiss: "Dismiss",
    branchTip: "Branch {name}",
    tagTip: "Tag {name}",
    remoteBranchTip: "Remote branch {name}",
    stagedTip: "{status} (staged)",
    added: "added",
    deleted: "deleted",
    modified: "modified",
    renamed: "renamed",
    copied: "copied",
    typechange: "typechange",
    conflict: "conflict",
    untracked: "untracked",
    ignored: "ignored",
  },
  zh: {
    close: "关闭",
    ok: "确定",
    cancel: "取消",
    dismiss: "关闭",
    branchTip: "分支 {name}",
    tagTip: "标签 {name}",
    remoteBranchTip: "远程分支 {name}",
    stagedTip: "{status}（已暂存）",
    added: "新增",
    deleted: "已删除",
    modified: "已修改",
    renamed: "已重命名",
    copied: "已复制",
    typechange: "类型变更",
    conflict: "冲突",
    untracked: "未跟踪",
    ignored: "已忽略",
  },
} as const;

export function Button({
  children,
  variant = "default",
  size = "normal",
  onClick,
  disabled,
  title,
  type = "button",
  className,
  autoFocus,
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "normal" | "small";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size === "small" ? " btn-small" : ""}${className ? " " + className : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      autoFocus={autoFocus}
    >
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  title,
  onClick,
  active,
  disabled,
  small,
  className,
  spinner,
}: {
  icon: IconName;
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  disabled?: boolean;
  small?: boolean;
  className?: string;
  spinner?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""}${small ? " icon-btn-small" : ""}${className ? " " + className : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {spinner ? <span className="spinner" /> : <Icon name={icon} />}
    </button>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <label
      className={`checkbox${disabled ? " disabled" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className="checkbox-box"
        aria-hidden="true"
        style={{
          background: checked || indeterminate ? "color-mix(in srgb, var(--accent) 8%, var(--input-bg))" : "var(--input-bg)",
          borderColor: checked || indeterminate ? "var(--accent)" : "var(--border-strong)",
          color: checked || indeterminate ? "var(--accent)" : "transparent",
        }}
      >
        {indeterminate && !checked ? (
          <span className="checkbox-dash" />
        ) : checked ? (
          <svg className="checkbox-check" viewBox="0 0 16 16">
            <path d="M3.4 8.5 6.3 11.4 12.6 4.9" />
          </svg>
        ) : null}
      </span>
      {label !== undefined && <span className="checkbox-label">{label}</span>}
    </label>
  );
}

export function Field({
  label,
  children,
  hint,
  inline,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={`field${inline ? " field-inline" : ""}`}>
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  onKeyDown,
  monospace,
  disabled,
  spellCheck,
  selectOnFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  monospace?: boolean;
  disabled?: boolean;
  spellCheck?: boolean;
  selectOnFocus?: boolean;
}) {
  return (
    <input
      className={`text-input${monospace ? " mono" : ""}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onFocus={selectOnFocus ? (e) => e.currentTarget.select() : undefined}
      onKeyDown={onKeyDown}
      disabled={disabled}
      spellCheck={spellCheck ?? false}
    />
  );
}

export function Select({
  value,
  onChange,
  children,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {children}
    </select>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" />
      {label && <span>{label}</span>}
    </span>
  );
}

/** Open modals, oldest first. Escape closes only the last one, so a dialog
 *  opened from another dialog does not take both down. */
const modalStack: number[] = [];
let modalSeq = 0;

export function Modal({
  title,
  icon,
  children,
  footer,
  onClose,
  width = 520,
  className,
}: {
  title: string;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
  className?: string;
}) {
  const t = useT(T);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const idRef = useRef(0);
  if (idRef.current === 0) idRef.current = ++modalSeq;
  useEffect(() => {
    const id = idRef.current;
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || modalStack[modalStack.length - 1] !== id) return;
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      const at = modalStack.indexOf(id);
      if (at >= 0) modalStack.splice(at, 1);
    };
  }, []);
  return createPortal(
    <div
      className="modal-overlay"
      // The control that opened the dialog sits under this backdrop, so the
      // second press of a double click lands here and would close what the
      // first one opened. detail > 1 is exactly that press: a click meant for
      // the backdrop is always a fresh single one.
      onMouseDown={(e) => {
        if (e.detail > 1 || e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div className={`modal${className ? " " + className : ""}`} style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          {icon && <Icon name={icon} />}
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose} title={t("close")} aria-label={t("close")}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  detail?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT(T);
  return (
    <Modal
      title={title}
      icon={danger ? "warning" : "info"}
      width={460}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{t("cancel")}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} autoFocus>
            {confirmLabel ?? t("ok")}
          </Button>
        </>
      }
    >
      <div className="confirm-message">{message}</div>
      {detail && <div className="confirm-detail">{detail}</div>}
    </Modal>
  );
}

export type ContextItem =
  | {
      separator: true;
    }
  | {
      separator?: false;
      /** Information, not an action: drawn as a muted caption. */
      header: true;
      label: string;
    }
  | {
      separator?: false;
      header?: false;
      label: string;
      icon?: IconName;
      shortcut?: string;
      /** A muted value shown after the label, e.g. the string that will be
       *  copied. Truncates with the label when the menu is narrow. */
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      /** Nested choices, opened to the right of the row on hover. */
      children?: ContextItem[];
      onClick?: () => void;
    };

/** The rows of a menu, shared by the root menu and its submenus. */
function menuRows(
  items: ContextItem[],
  onClose: () => void,
  openSub: ((items: ContextItem[], anchor: DOMRect) => void) | null,
  closeSub: (() => void) | null,
) {
  return items.map((item, i) =>
    item.separator ? (
      <div className="menu-separator" key={i} />
    ) : item.header ? (
      <div className="menu-header" key={i}>
        {item.label}
      </div>
    ) : (
      <button
        key={i}
        className={`menu-item${item.danger ? " danger" : ""}`}
        disabled={item.disabled}
        onMouseEnter={(e) => {
          if (item.children) openSub?.(item.children, e.currentTarget.getBoundingClientRect());
          else closeSub?.();
        }}
        onClick={(e) => {
          if (item.children) {
            openSub?.(item.children, e.currentTarget.getBoundingClientRect());
            return;
          }
          onClose();
          item.onClick?.();
        }}
        role="menuitem"
        aria-haspopup={item.children ? "menu" : undefined}
        title={item.hint || undefined}
      >
        <span className="menu-icon">
          {item.checked ? <Icon name="check" /> : item.icon ? <Icon name={item.icon} /> : null}
        </span>
        <span className="menu-label">
          {item.label}
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </span>
        {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
        {item.children && (
          <span className="menu-arrow">
            <Icon name="chevronRight" size={12} />
          </span>
        )}
      </button>
    ),
  );
}

function SubMenu({
  items,
  anchor,
  onClose,
}: {
  items: ContextItem[];
  anchor: DOMRect;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({
    left: anchor.right + 2,
    top: anchor.top,
    visibility: "hidden",
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 2;
    let left = anchor.right + gap;
    let top = anchor.top;
    if (left + rect.width > window.innerWidth - 6) left = anchor.left - rect.width - gap;
    if (top + rect.height > window.innerHeight - 6) {
      top = Math.max(6, window.innerHeight - rect.height - 6);
    }
    setPos({ left, top, visibility: "visible" });
  }, [anchor]);
  return createPortal(
    <div
      className="context-menu context-submenu"
      style={pos}
      ref={ref}
      role="menu"
      // The root menu listens for mousedown on the window to close itself;
      // a press inside this portal is not "outside" it.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menuRows(items, onClose, null, null)}
    </div>,
    document.body,
  );
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ items: ContextItem[]; anchor: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - 6) left = window.innerWidth - rect.width - 6;
    if (top + rect.height > window.innerHeight - 6) top = Math.max(6, window.innerHeight - rect.height - 6);
    setPos({ left, top });
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // A submenu is a second portal, not a child of this menu's DOM.
      if (target?.closest?.(".context-submenu")) return;
      if (ref.current && !ref.current.contains(target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <>
      {createPortal(
        <div className="context-menu" style={pos} ref={ref} role="menu">
          {menuRows(
            items,
            onClose,
            (items, anchor) => setSub({ items, anchor }),
            () => setSub(null),
          )}
        </div>,
        document.body,
      )}
      {sub && <SubMenu items={sub.items} anchor={sub.anchor} onClose={onClose} />}
    </>
  );
}

/** The single bottom-right stack that owns toasts and the operation dock.
 *  Both portal into it so the corner has one aligned edge; render order within
 *  it is set by the order rules in style.css. */
let notices: HTMLDivElement | null = null;

export function noticeHost(): HTMLElement {
  if (!notices || !notices.isConnected) {
    notices = document.createElement("div");
    notices.className = "notice-stack";
    document.body.appendChild(notices);
  }
  return notices;
}

export function Toast({
  kind,
  title,
  message,
  onClose,
}: {
  kind: "info" | "success" | "error";
  title: string;
  message?: string;
  onClose: () => void;
}) {
  const t = useT(T);
  useEffect(() => {
    const timer = setTimeout(onClose, kind === "error" ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [onClose, kind]);
  return createPortal(
    <div className={`toast toast-${kind}`} role="status">
      <span className="toast-icon">
        <Icon name={kind === "error" ? "error" : kind === "success" ? "check" : "info"} />
      </span>
      <div className="toast-text">
        <div className="toast-title">{title}</div>
        {message && <div className="toast-message">{message}</div>}
      </div>
      <button className="toast-close" onClick={onClose} aria-label={t("dismiss")}>
        <Icon name="close" size={12} />
      </button>
    </div>,
    noticeHost(),
  );
}

/** A splitter drags the left panel's width; double click resets it. */
export function Splitter({
  width,
  setWidth,
  min = 280,
  max = 720,
  reset = 430,
}: {
  width: number;
  setWidth: (w: number) => void;
  min?: number;
  max?: number;
  reset?: number;
}) {
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      const next = Math.min(max, Math.max(min, drag.current.startW + e.clientX - drag.current.startX));
      setWidth(next);
    };
    const up = () => {
      drag.current = null;
      document.body.classList.remove("resizing");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [max, min, setWidth]);
  return (
    <div
      className="splitter"
      onMouseDown={(e) => {
        drag.current = { startX: e.clientX, startW: width };
        document.body.classList.add("resizing");
      }}
      onDoubleClick={() => setWidth(reset)}
      role="separator"
      aria-orientation="vertical"
    />
  );
}

const KIND_LETTER: Record<string, { letter: string; cls: string }> = {
  added: { letter: "A", cls: "st-added" },
  deleted: { letter: "D", cls: "st-deleted" },
  modified: { letter: "M", cls: "st-modified" },
  renamed: { letter: "R", cls: "st-renamed" },
  copied: { letter: "C", cls: "st-renamed" },
  typechange: { letter: "T", cls: "st-modified" },
  conflict: { letter: "U", cls: "st-conflict" },
  untracked: { letter: "?", cls: "st-untracked" },
  ignored: { letter: "!", cls: "st-ignored" },
};

/** StatusMark is the coloured letter shown next to a changed file. */
export function StatusMark({ kind, staged }: { kind: string; staged?: boolean }) {
  const t = useT(T);
  const meta = KIND_LETTER[kind] ?? KIND_LETTER.modified!;
  const status = kind in KIND_LETTER ? t(kind as keyof typeof T["en"]) : kind;
  return (
    <span
      className={`status-mark ${meta.cls}${staged ? " staged" : ""}`}
      title={staged ? t("stagedTip", { status }) : status}
    >
      {meta.letter}
    </span>
  );
}

export function RefChip({
  name,
  type,
  head,
  onClick,
}: {
  name: string;
  type: string;
  head?: boolean;
  onClick?: () => void;
}) {
  const t = useT(T);
  return (
    <span
      className={`ref-chip ref-${type}${head ? " ref-head" : ""}${onClick ? " clickable" : ""}`}
      onClick={onClick}
      title={
        type === "tag"
          ? t("tagTip", { name })
          : type === "remote"
            ? t("remoteBranchTip", { name })
            : t("branchTip", { name })
      }
    >
      {type === "tag" ? <Icon name="tag" size={11} /> : head ? <Icon name="check" size={11} /> : <Icon name="branch" size={11} />}
      {name}
    </span>
  );
}

export function formatWhen(unix: number): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

/** YYYY-MM-DD HH:mm:ss in the machine's time zone. A stamp from today loses
 *  its date and keeps the clock, prefixed with the caller's word for "today":
 *  the year is the least interesting part of a commit made ten minutes ago. */
export function formatStamp(unix: number, today?: string): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (today && d.toDateString() === new Date().toDateString()) return `${today} ${clock}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

export function formatFullDate(unix: number): string {
  if (!unix) return "";
  return new Date(unix * 1000).toLocaleString();
}

export function shortPath(path: string, max = 60): string {
  if (path.length <= max) return path;
  const parts = path.split("/");
  let out = parts[parts.length - 1] ?? path;
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = parts[i] + "/" + out;
    if (next.length > max) break;
    out = next;
  }
  return "…/" + out;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function useStoredState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      // A broken value falls back to the default.
    }
    return initial;
  });
  const set = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage can be unavailable; the value still lives in memory.
    }
  };
  return [value, set];
}

export const monoStyle: CSSProperties = { fontFamily: "var(--font-mono)" };
