import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ProjectAlert } from "../projects/types";
import { formatNotificationDate, notificationUrl } from "./notificationUtils";

export default function NotificationMenu() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<ProjectAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/projects/alerts?limit=5");
      setAlerts(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unreadCount || 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void loadAlerts();
    const initialLoad = window.setTimeout(refresh, 0);
    const interval = window.setInterval(() => void loadAlerts(), 30000);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loadAlerts]);

  async function markRead(alert: ProjectAlert) {
    if (alert.read) return;

    setAlerts((current) =>
      current.map((item) => (item._id === alert._id ? { ...item, read: true } : item))
    );
    setUnreadCount((count) => Math.max(count - 1, 0));
    await api.patch(`/projects/alerts/${alert._id}/read`).catch(() => {});
  }

  function openAllNotifications() {
    const tab = window.open("/notifications", "_blank", "noopener,noreferrer");
    tab?.focus();
  }

  return (
    <div className="notification-center">
      <button
        className="notification-trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span aria-hidden="true">!</span>
        <span className="notification-trigger-label">Notificaciones</span>
        {unreadCount > 0 && <strong>{unreadCount > 99 ? "99+" : unreadCount}</strong>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-head">
            <div>
              <p className="eyebrow">AVISOS</p>
              <h3>Notificaciones</h3>
            </div>
            <button className="btn btn-compact" type="button" onClick={() => void loadAlerts()}>
              Actualizar
            </button>
          </div>

          <div className="notification-mini-list">
            {alerts.map((alert) => (
              <a
                key={alert._id}
                className={alert.read ? "notification-mini-item" : "notification-mini-item unread"}
                href={notificationUrl(alert)}
                onClick={() => void markRead(alert)}
              >
                <strong>{alert.title}</strong>
                <span>{alert.body || alert.project?.title || "Nueva notificación"}</span>
                <small>{formatNotificationDate(alert.createdAt)}</small>
              </a>
            ))}

            {!alerts.length && (
              <div className="notification-empty">
                {loading ? "Cargando notificaciones..." : "Sin notificaciones recientes."}
              </div>
            )}
          </div>

          <button className="notification-view-all" type="button" onClick={openAllNotifications}>
            Ver todas
          </button>
        </div>
      )}
    </div>
  );
}
