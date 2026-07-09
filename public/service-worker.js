const CACHE_NAME = "todo-pwa-cache-v6";
const APP_SHELL = [
  "/",
  "/favicon.svg",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME && cacheName.startsWith("todo"))
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isAppFile =
    event.request.mode === "navigate" ||
    ["script", "style", "worker"].includes(event.request.destination);

  event.respondWith(
    isAppFile
      ? fetch(event.request)
          .then((response) => {
            if (response.ok) {
              const responseCopy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
            }

            return response;
          })
          .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
      : caches.match(event.request).then((cached) => {
          if (cached) return cached;

          return fetch(event.request)
            .then((response) => {
              if (response.ok) {
                const responseCopy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseCopy));
              }

              return response;
            })
            .catch(() => caches.match("/"));
        })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const data = payload.data || payload.notification || payload;
  const title = data.title || "Recordatorio";
  const body = data.body || "Tienes una tarea pendiente.";
  const url = data.url || "/dashboard";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      badge: "/icons/icon-192x192.png",
      icon: data.icon || "/icons/icon-192x192.png",
      requireInteraction: true,
      renotify: false,
      tag: data.tag || data.taskId || "todo-reminder",
      data: { url }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("navigate" in client && "focus" in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }

          if ("focus" in client) return client.focus();
        }

        return clients.openWindow(targetUrl);
      })
  );
});
