const CACHE_NAME = "todo-pwa-cache-v5";
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }

        return clients.openWindow("/");
      })
  );
});
