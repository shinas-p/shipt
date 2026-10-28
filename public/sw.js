/**
 * ShipT Mart — Progressive Web App & Web Push Service Worker
 *
 * Scope: /
 * Capabilities:
 * 1. Web Push Notification delivery when all website tabs are closed.
 * 2. Safe notification click handling with window focusing / deep-linking.
 * 3. Static asset caching for PWA installability with strict exclusion of:
 *    - Authenticated /admin routes
 *    - Supabase API and auth endpoints
 *    - Customer checkout, payment, and order records
 * 4. Offline fallback page (/offline.html) for navigation requests without connection.
 */

const CACHE_NAME = "shipt-static-v1";
const OFFLINE_URL = "/offline.html";

// Static assets safe to cache for instant PWA loading
const STATIC_PRECACHE = [
  OFFLINE_URL,
  "/site.webmanifest",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/apple-touch-icon.png",
];

// URLs that must NEVER be stored in the service worker cache
function isCacheExcluded(url) {
  const path = url.pathname;
  return (
    path.startsWith("/admin") ||
    path.startsWith("/auth") ||
    path.startsWith("/account") ||
    path.startsWith("/checkout") ||
    path.startsWith("/order") ||
    url.hostname.includes("supabase.co") ||
    url.searchParams.has("token") ||
    url.searchParams.has("guest_token") ||
    url.pathname.includes("/api/") ||
    url.pathname.includes("/functions/")
  );
}

// 1. Install Event: Pre-cache offline page & core static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn("[ShipT SW] Pre-caching warning:", err);
      })
  );
});

// 2. Activate Event: Clean up outdated caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

// 3. Fetch Event: Safe Network-First Strategy with Offline Fallback
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests from same origin (or whitelisted static origins)
  if (req.method !== "GET") {
    return;
  }

  // Strictly skip all sensitive routes, APIs, admin views, and auth
  if (isCacheExcluded(url)) {
    return;
  }

  // Handle HTML document navigations: Network first -> Offline fallback page
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedFallback = await cache.match(OFFLINE_URL);
        return (
          cachedFallback ||
          new Response("Offline. Please reconnect to access ShipT Mart.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      })
    );
    return;
  }

  // Static assets (images, fonts, manifest): Cache first with network fallback
  if (
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".jpg") ||
      url.pathname.endsWith(".ico") ||
      url.pathname.endsWith(".webmanifest") ||
      url.pathname.endsWith(".svg"))
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
            }
            return response;
          })
          .catch(() => cached);
      })
    );
  }
});

// 4. Web Push Event: Deliver Notifications When Tabs Are Closed
self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = {
        title: "ShipT Mart Alert",
        body: event.data.text() || "You have a new store notification.",
      };
    }
  } else {
    payload = {
      title: "ShipT Mart Alert",
      body: "New order or store update.",
    };
  }

  const title = payload.title || "ShipT Mart";
  const options = {
    body: payload.body || "New store update",
    icon: payload.icon || "/android-chrome-192x192.png",
    badge: payload.badge || "/favicon-32x32.png",
    tag: payload.tag || `shipt-push-${Date.now()}`,
    data: payload.data || { url: "/admin" },
    vibrate: [200, 100, 200],
    requireInteraction: payload.requireInteraction ?? false,
    actions: payload.actions || [
      { action: "open", title: "View Order" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 5. Notification Click Event: Safe Deep-Linking & Window Focusing
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") {
    return;
  }

  const targetPath = event.notification.data?.url || "/admin";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // 1. If a tab on same origin already has this target, focus it
        for (const client of windowClients) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        // 2. If any admin tab is open, navigate and focus
        for (const client of windowClients) {
          if (client.url.includes("/admin") && "navigate" in client && "focus" in client) {
            return client.navigate(targetUrl).then((c) => c.focus());
          }
        }
        // 3. Otherwise open new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
