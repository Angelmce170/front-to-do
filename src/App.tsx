import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Notifications from "./pages/Notifications";
import Register from "./pages/Register";
import ProtectedRoute from "./routes/ProtectedRoute";
import { api } from "./api";
import { getAllTasksLocal, type LocalTask } from "./offline/db";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
const notifiedKey = "todo-pwa-notified-reminders";
const remindersChangedEvent = "todo-pwa-reminders-changed";
const maxTimerDelay = 2_147_483_647;

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

function dueReminderTasks(tasks: LocalTask[], notified: Record<string, string>) {
  const now = Date.now();

  return tasks.filter((task) => {
    const reminderAt = task.reminderAt ? String(task.reminderAt) : "";
    if (!reminderAt || task.status === "Completada" || task.deleted) return false;
    if (notified[task._id] === reminderAt) return false;

    const reminderTime = new Date(reminderAt).getTime();
    return !Number.isNaN(reminderTime) && reminderTime <= now;
  });
}

async function sendDueRemindersWithWebPush(notified: Record<string, string>) {
  if (!navigator.onLine) return false;

  try {
    const { data } = await api.post("/notifications/send-due");
    const sent = Array.isArray(data?.sent) ? data.sent : [];

    for (const item of sent) {
      const taskId = typeof item?.taskId === "string" ? item.taskId : "";
      const reminderAt = typeof item?.reminderAt === "string" ? item.reminderAt : "";
      if (taskId && reminderAt) notified[taskId] = reminderAt;
    }

    if (sent.length) writeNotifiedReminders(notified);
    return sent.length > 0;
  } catch {
    return false;
  }
}

function nextReminderDelay(tasks: LocalTask[], notified: Record<string, string>) {
  const now = Date.now();
  let nextTime = Number.POSITIVE_INFINITY;

  for (const task of tasks) {
    const reminderAt = task.reminderAt ? String(task.reminderAt) : "";
    if (!reminderAt || task.status === "Completada" || task.deleted) continue;
    if (notified[task._id] === reminderAt) continue;

    const reminderTime = new Date(reminderAt).getTime();
    if (Number.isNaN(reminderTime) || reminderTime <= now) continue;

    nextTime = Math.min(nextTime, reminderTime);
  }

  if (!Number.isFinite(nextTime)) return null;
  return Math.min(Math.max(nextTime - now + 500, 1000), maxTimerDelay);
}

function ReminderWatcher() {
  useEffect(() => {
    let nextReminderTimer = 0;

    const clearNextReminderTimer = () => {
      if (!nextReminderTimer) return;
      window.clearTimeout(nextReminderTimer);
      nextReminderTimer = 0;
    };

    const scheduleNextReminder = async () => {
      clearNextReminderTimer();
      if (!localStorage.getItem("token") || currentNotificationPermission() !== "granted") return;

      const tasks = await getAllTasksLocal();
      const delay = nextReminderDelay(tasks, readNotifiedReminders());
      if (delay === null) return;

      nextReminderTimer = window.setTimeout(() => void runReminderCheck(), delay);
    };

    const notifyDueTasks = async () => {
      if (!localStorage.getItem("token") || currentNotificationPermission() !== "granted") return;

      const tasks = await getAllTasksLocal();
      const notified = readNotifiedReminders();
      const dueTasks = dueReminderTasks(tasks, notified);
      if (!dueTasks.length) return;

      await sendDueRemindersWithWebPush(notified);
    };

    const runReminderCheck = async () => {
      await notifyDueTasks();
      await scheduleNextReminder();
    };

    const notifyWhenVisible = () => {
      if (document.visibilityState === "visible") void runReminderCheck();
    };
    const notifyWhenTasksChange = () => void runReminderCheck();

    void runReminderCheck();
    const interval = window.setInterval(() => void runReminderCheck(), 30000);
    window.addEventListener("focus", notifyWhenVisible);
    window.addEventListener(remindersChangedEvent, notifyWhenTasksChange);
    document.addEventListener("visibilitychange", notifyWhenVisible);

    return () => {
      window.clearInterval(interval);
      clearNextReminderTimer();
      window.removeEventListener("focus", notifyWhenVisible);
      window.removeEventListener(remindersChangedEvent, notifyWhenTasksChange);
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
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <Notifications />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
