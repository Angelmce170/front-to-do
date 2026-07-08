import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, isSupported, onMessage, type Messaging } from "firebase/messaging";
import { api } from "./api";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const fcmTokenKey = "todo-pwa-fcm-token";

export function isFirebaseMessagingConfigured() {
  return Object.values(firebaseConfig).every(Boolean) && Boolean(vapidKey);
}

async function getMessagingInstance(): Promise<Messaging | null> {
  if (!isFirebaseMessagingConfigured()) return null;

  try {
    if (!(await isSupported())) return null;
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    return getMessaging(app);
  } catch {
    return null;
  }
}

async function getReadyRegistration() {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const current = await navigator.serviceWorker.getRegistration();
    if (!current) await navigator.serviceWorker.register("/service-worker.js");

    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export async function registerFcmToken() {
  if (!isFirebaseMessagingConfigured() || !("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }

  const messaging = await getMessagingInstance();
  const registration = await getReadyRegistration();
  if (!messaging || !registration) return false;

  try {
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });
    if (!token) return false;

    localStorage.setItem(fcmTokenKey, token);
    await api.post("/notifications/token", { token });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterFcmToken() {
  const token = localStorage.getItem(fcmTokenKey);
  localStorage.removeItem(fcmTokenKey);
  if (!token) return;

  try {
    await api.delete("/notifications/token", { data: { token } });
  } catch {
    // Si falla al salir, se limpiará cuando Firebase invalide el token.
  }
}

export async function listenForFirebaseMessages() {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => undefined;

  return onMessage(messaging, async (payload) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const data = payload.data || {};
    const title = data.title || payload.notification?.title || "Recordatorio";
    const body = data.body || payload.notification?.body || "Tienes una tarea pendiente.";
    const registration = await getReadyRegistration();
    const options: NotificationOptions = {
      body,
      badge: "/icons/icon-192x192.png",
      icon: data.icon || "/icons/icon-192x192.png",
      requireInteraction: true,
      tag: data.tag || data.taskId || "todo-reminder",
      data: { url: data.url || "/dashboard" },
    };

    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
  });
}
