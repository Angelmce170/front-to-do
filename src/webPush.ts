import { api } from "./api";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

function arrayBufferToBase64Url(value: ArrayBuffer | null) {
  if (!value) return "";

  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function webPushConfigMessage() {
  return "No se pudo registrar este dispositivo. Revisa Web Push en el back.";
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

async function getPublicKey() {
  const { data } = await api.get("/notifications/public-key");
  return typeof data?.publicKey === "string" ? data.publicKey : "";
}

export async function registerWebPushSubscription() {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  if (!("PushManager" in window)) return false;

  try {
    const registration = await getReadyRegistration();
    const publicKey = await getPublicKey();
    if (!registration || !publicKey) return false;

    let subscription = await registration.pushManager.getSubscription();
    const currentKey = arrayBufferToBase64Url(subscription?.options.applicationServerKey ?? null);

    if (subscription && currentKey !== publicKey) {
      await api.delete("/notifications/subscription", { data: { endpoint: subscription.endpoint } }).catch(() => {});
      await subscription.unsubscribe();
      subscription = null;
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    await api.post("/notifications/subscription", {
      subscription: subscription.toJSON(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function unregisterWebPushSubscription() {
  try {
    const registration = await getReadyRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    await api.delete("/notifications/subscription", { data: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  } catch {
    // Si falla al salir, el back limpiará la suscripción cuando el navegador la invalide.
  }
}
