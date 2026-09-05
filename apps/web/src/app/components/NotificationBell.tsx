import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { notificationApi, type UserNotificationRow } from "../../infrastructure/api/auth";
import { AppIcon } from "./AppIcon";
import { Skeleton } from "./Skeleton";
import { RichContent } from "./exam/RichContent";

// Near-realtime: 30s polling keeps the badge fresh without new server infra
// (SSE/websocket would need a second long-connection budget on Railway).
const POLL_MS = 30_000;

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ngày trước`;
  return new Date(ts).toLocaleDateString("vi-VN");
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<UserNotificationRow[]>();
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const r = await notificationApi.list(1, 20);
      setItems(r.notifications); setUnread(r.unread); setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được thông báo");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function openPanel() {
    const next = !open;
    setOpen(next);
    if (next) { setLoading(true); await refresh(); setLoading(false); }
  }
  async function markRead(id: string) {
    try { await notificationApi.markRead([id]); setItems(list => list?.map(n => n.id === id ? { ...n, readAt: Date.now() } : n)); setUnread(u => Math.max(0, u - 1)); } catch { /* badge refreshes on next poll */ }
  }
  async function markAll() {
    try { await notificationApi.markRead(); setItems(list => list?.map(n => ({ ...n, readAt: n.readAt ?? Date.now() }))); setUnread(0); } catch { }
  }
  async function remove(id: string) {
    try { await notificationApi.remove(id); setItems(list => list?.filter(n => n.id !== id)); } catch { }
  }
  function clickItem(n: UserNotificationRow) {
    if (!n.readAt) void markRead(n.id);
    if (n.link) { setOpen(false); navigate(n.link); }
  }

  return <div className="relative" ref={panelRef}>
    <button className="btn-secondary !py-2 !px-3 relative" onClick={() => void openPanel()} aria-label={`Thông báo${unread ? ` (${unread} chưa đọc)` : ""}`} title="Thông báo">
      <AppIcon name="bell" size={17} />
      {unread > 0 && <span className="notification-badge" aria-hidden>{unread > 99 ? "99+" : unread}</span>}
    </button>
    {open && <div className="notification-panel" role="dialog" aria-label="Danh sách thông báo">
      <div className="notification-panel-head">
        <strong>Thông báo</strong>
        {unread > 0 && <button className="admin-text-link" onClick={() => void markAll()}>Đánh dấu tất cả đã đọc</button>}
      </div>
      <div className="notification-panel-body">
        {loading && !items ? [0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)
          : error ? <div className="notification-empty"><p className="form-error !mt-0">{error}</p><button className="btn-secondary" onClick={() => void refresh()}>Thử lại</button></div>
          : !items?.length ? <div className="notification-empty"><AppIcon name="bell" size={26} /><p>Chưa có thông báo nào.</p></div>
          : items.map(n => <div key={n.id} className={`notification-item ${n.readAt ? "" : "unread"}`}>
            <button className="notification-item-main" onClick={() => clickItem(n)}>
              <span className={`notification-cat cat-${n.category}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="notification-title">{n.title}</span>
                <span className="notification-body"><RichContent html={n.body} /></span>
                <span className="notification-time">{timeAgo(n.createdAt)}</span>
              </span>
            </button>
            <span className="notification-actions">
              {!n.readAt && <button title="Đánh dấu đã đọc" aria-label="Đánh dấu đã đọc" onClick={() => void markRead(n.id)}><AppIcon name="check" size={14} /></button>}
              <button title="Xóa thông báo" aria-label="Xóa thông báo" onClick={() => void remove(n.id)}><AppIcon name="close" size={14} /></button>
            </span>
          </div>)}
      </div>
    </div>}
  </div>;
}
