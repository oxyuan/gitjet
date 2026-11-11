import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "./i18n";
import { Icon } from "./icons";
import { cx } from "./ui";

/** One notice kept for the session: the same shape the transient toast
 *  shows, plus an identity and the time it arrived. */
export type Notice = {
  id: number;
  kind: "info" | "success" | "error";
  title: string;
  message?: string;
  at: number;
};

const T = {
  en: {
    notifications: "Notifications",
    empty: "Nothing has happened in this session.",
    clear: "Clear",
    close: "Close",
    show: "Show notifications",
  },
  zh: {
    notifications: "通知",
    empty: "本次打开后还没有通知。",
    clear: "清空",
    close: "关闭",
    show: "查看通知",
  },
} as const;

function noticeTime(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })} ${time}`;
}

/** IDEA's notification bell: the session's history behind one icon in the
 *  status bar, with the count of messages that arrived since it was read. */
export function NotificationCenter({
  notices,
  onClear,
}: {
  notices: Notice[];
  onClear: () => void;
}) {
  const t = useT(T);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const unread = Math.max(notices.length - seen, 0);

  useEffect(() => {
    if (open) setSeen(notices.length);
    else if (notices.length < seen) setSeen(notices.length);
  }, [open, notices.length, seen]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || bellRef.current?.contains(target)) return;
      setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <>
      <button
        ref={bellRef}
        className={cx("notification-bell", unread > 0 && "unread")}
        title={t("show")}
        aria-label={t("show")}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) setSeen(notices.length);
        }}
      >
        <Icon name="bell" size={13} />
        {unread > 0 && <span className="notification-badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open &&
        createPortal(
          <div className="notification-panel" ref={panelRef} role="dialog" aria-label={t("notifications")}>
            <div className="notification-head">
              <span>{t("notifications")}</span>
              <span className="spacer" />
              <button
                className="notification-action"
                onClick={() => {
                  onClear();
                  setSeen(0);
                }}
                disabled={notices.length === 0}
              >
                {t("clear")}
              </button>
              <button className="notification-action" onClick={() => setOpen(false)} aria-label={t("close")}>
                <Icon name="close" size={12} />
              </button>
            </div>
            {notices.length === 0 ? (
              <div className="notification-empty">{t("empty")}</div>
            ) : (
              <div className="notification-list">
                {notices.map((notice) => (
                  <div key={notice.id} className={`notification-item ${notice.kind}`}>
                    <span className="notification-kind">
                      <Icon
                        name={notice.kind === "error" ? "error" : notice.kind === "success" ? "check" : "info"}
                        size={12}
                      />
                    </span>
                    <div className="notification-body">
                      <div className="notification-title">
                        <span>{notice.title}</span>
                        <time dateTime={new Date(notice.at).toISOString()}>{noticeTime(notice.at)}</time>
                      </div>
                      {notice.message && <div className="notification-message">{notice.message}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
