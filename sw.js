const CACHE_NAME = "app-tracker-20260422-v53";

// Files to cache for offline fallback
const PRECACHE = [
  "/app-tracker/",
  "/app-tracker/index.html",
  "/app-tracker/pages/dashboard.html",
  "/app-tracker/pages/main-dashboard.html",
  "/app-tracker/pages/chat.html",
  "/app-tracker/pages/files.html",
  "/app-tracker/pages/notifications.html",
  "/app-tracker/pages/people.html",
  "/app-tracker/pages/profile.html",
  "/app-tracker/pages/space-settings.html",
  "/app-tracker/css/main.css",
  "/app-tracker/js/app.js",
  "/app-tracker/js/firebase.js",
  "/app-tracker/js/helpers.js",
  "/app-tracker/js/sidebar.js",
  "/app-tracker/js/chat.js",
  "/app-tracker/js/files.js",
  "/app-tracker/js/login.js",
  "/app-tracker/js/notify.js",
  "/app-tracker/js/storage.js",
  "/app-tracker/assets/logo.png",
  "/app-tracker/assets/icon-192.png",
  "/app-tracker/assets/icon-512.png",
  "/app-tracker/assets/icon.svg"
];

// Install — pre-cache all app shell files immediately
self.addEventListener("install", event => {
  self.skipWaiting(); // activate new SW immediately, no waiting
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)).catch(() => {})
  );
});

// Activate — clear old caches immediately, claim all clients
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // take over all open tabs immediately
  );
});

// Fetch — cache-first for app shell, network-first for data
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = event.request.url;

  // Never intercept Firebase, Google APIs, or CDN resources
  if (url.includes("firebase") || url.includes("googleapis") ||
      url.includes("gstatic") || url.includes("emailjs") ||
      url.includes("callmebot") || url.includes("chart.js") ||
      url.includes("cdnjs")) return;

  const isHtml    = url.includes(".html") || url.endsWith("/app-tracker/") || url.endsWith("/app-tracker");
  const isAppShell = PRECACHE.some(p => url.endsWith(p) || url.includes(p.replace("/app-tracker","")));

  if (isHtml) {
    // Network-first for HTML — always get fresh page so new JS deploys are picked up.
    // Falls back to cache if offline.
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else if (isAppShell) {
    // Cache-first for JS/CSS/assets — versioned by CACHE_NAME so safe to cache
    // Stale-while-revalidate: serve instantly from cache, update in background
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  } else {
    // Network-first for everything else
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
