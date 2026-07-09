import type { ProjectAlert } from "./types";

type Props = {
  alerts: ProjectAlert[];
  onRead: (alertId: string) => void;
};

export default function ProjectAlerts({ alerts, onRead }: Props) {
  return (
    <div className="project-alerts">
      {alerts.slice(0, 3).map((alert) => (
        <button
          key={alert._id}
          className={alert.read ? "alert-pill read" : "alert-pill"}
          type="button"
          onClick={() => onRead(alert._id)}
        >
          {alert.title}
        </button>
      ))}
    </div>
  );
}
