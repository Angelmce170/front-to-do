import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatNotificationDate, notificationUrl } from "../notifications/notificationUtils";
import type { ProjectAlert } from "../projects/types";

export default function Notifications() {
  const [alerts, setAlerts] = useState<ProjectAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/projects/alerts?limit=500");
      setAlerts(Array.isArray(data.items) ? data.items : []);
      setUnreadCount(Number(data.unreadCount || 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAlerts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAlerts]);

  async function markRead(alert: ProjectAlert) {
    if (alert.read) return;

    setAlerts((current) =>
      current.map((item) => (item._id === alert._id ? { ...item, read: true } : item))
    );
    setUnreadCount((count) => Math.max(count - 1, 0));
    await api.patch(`/projects/alerts/${alert._id}/read`).catch(() => {});
  }

  async function deleteAlert(alertId: string) {
    const target = alerts.find((alert) => alert._id === alertId);
    setAlerts((current) => current.filter((alert) => alert._id !== alertId));
    if (target && !target.read) setUnreadCount((count) => Math.max(count - 1, 0));

    await api.delete(`/projects/alerts/${alertId}`).catch(() => {
      void loadAlerts();
    });
  }

  return (
    <div className="notifications-page">
      <header className="notifications-header">
        <div>
          <p className="eyebrow">CENTRO DE AVISOS</p>
          <h1>Notificaciones</h1>
          <span>{unreadCount} sin leer</span>
        </div>
        <Link className="btn btn-primary btn-compact" to="/dashboard">
          Volver
        </Link>
      </header>

      <main className="notifications-shell">
        {loading ? (
          <div className="empty-state">
            <span className="loader" />
            <p>Cargando notificaciones...</p>
          </div>
        ) : alerts.length ? (
          <div className="notification-full-list">
            {alerts.map((alert) => (
              <article key={alert._id} className={alert.read ? "notification-full-item" : "notification-full-item unread"}>
                <div>
                  <p className="eyebrow">{alert.type}</p>
                  <h2>{alert.title}</h2>
                  <p>{alert.body || alert.project?.title || "Nueva notificación"}</p>
                  <small>{formatNotificationDate(alert.createdAt)}</small>
                </div>
                <div className="notification-full-actions">
                  <a className="btn btn-compact" href={notificationUrl(alert)} onClick={() => void markRead(alert)}>
                    Abrir
                  </a>
                  {!alert.read && (
                    <button className="btn btn-compact" type="button" onClick={() => void markRead(alert)}>
                      Marcar leída
                    </button>
                  )}
                  <button className="btn btn-danger btn-compact" type="button" onClick={() => void deleteAlert(alert._id)}>
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">✓</span>
            <h3>Sin notificaciones</h3>
            <p>Cuando tengas avisos de proyectos aparecerán aquí.</p>
          </div>
        )}
      </main>
    </div>
  );
}
