import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ProtectedRoute from "./routes/ProtectedRoute";
import { getAllTasksLocal, type LocalTask } from "./offline/db";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
const notifiedKey = "todo-pwa-notified-reminders";

const currentNotificationPermission = (): NotificationPermission =>
  "Notification" in window ? Notification.permission : "denied";

function readNotifiedReminders() {
  try {
    return JSON.parse(localStorage.getItem(notifiedKey) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeNotifiedReminders(value: Record<string, string>) {
  localStorage.setItem(notifiedKey, JSON.stringify(value));
}

async function getNotificationRegistration() {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const current = await navigator.serviceWorker.getRegistration();
    if (!current) await navigator.serviceWorker.register("/service-worker.js");

    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

async function showReminderNotification(task: LocalTask) {
  if (currentNotificationPermission() !== "granted") return false;

  const title = String(task.title || "Tarea");
  const description = typeof task.description === "string" ? task.description : "";
  const reminderAt = String(task.reminderAt || "");

  try {
    const registration = await getNotificationRegistration();
    const options: NotificationOptions = {
      body: description || "Tienes una tarea pendiente.",
      badge: "/icons/icon-192x192.png",
      icon: "/icons/icon-192x192.png",
      requireInteraction: true,
      tag: `todo-${task._id}-${reminderAt}`,
    };

    if (registration) {
      await registration.showNotification(`Recordatorio: ${title}`, options);
    } else {
      new Notification(`Recordatorio: ${title}`, options);
    }

    return true;
  } catch {
    return false;
  }
}

function ReminderWatcher() {
  useEffect(() => {
    const notifyDueTasks = async () => {
      if (!localStorage.getItem("token") || currentNotificationPermission() !== "granted") return;

      const tasks = await getAllTasksLocal();
      const notified = readNotifiedReminders();
      const now = Date.now();
      let changed = false;

      for (const task of tasks) {
        const reminderAt = task.reminderAt ? String(task.reminderAt) : "";
        if (!reminderAt || task.status === "Completada" || task.deleted) continue;

        const reminderTime = new Date(reminderAt).getTime();
        if (Number.isNaN(reminderTime) || reminderTime > now) continue;
        if (notified[task._id] === reminderAt) continue;

        const shown = await showReminderNotification(task);
        if (!shown) continue;

        notified[task._id] = reminderAt;
        changed = true;
      }

      if (changed) writeNotifiedReminders(notified);
    };

    const notifyWhenVisible = () => {
      if (document.visibilityState === "visible") void notifyDueTasks();
    };

    void notifyDueTasks();
    const interval = window.setInterval(() => void notifyDueTasks(), 30000);
    window.addEventListener("focus", notifyWhenVisible);
    document.addEventListener("visibilitychange", notifyWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", notifyWhenVisible);
      document.removeEventListener("visibilitychange", notifyWhenVisible);
    };
  }, []);

  return null;
}

function MobileInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 780px)");
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

    const updateMobile = () => setIsMobile(mobileQuery.matches && !isStandalone);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstallPrompt(null);

    updateMobile();
    mobileQuery.addEventListener("change", updateMobile);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      mobileQuery.removeEventListener("change", updateMobile);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt) return;

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  if (!isMobile || !installPrompt) return null;

  return (
    <button className="mobile-install-button" type="button" onClick={installApp}>
      <span aria-hidden="true">↓</span>
      Instalar app
    </button>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ReminderWatcher />
      <MobileInstallButton />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
