// Minimal service worker so "wheredoigokeerthan" installs as a PWA and the shell works
// offline. Network-first for navigations (always get the latest build),
// cache-first for static assets. Never touches /api or cross-origin (map tiles,
// Google) — those always hit the network.
const CACHE = "wheredoigokeerthan-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // map tiles / Google → network
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return r;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  e.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return r;
        })
    )
  );
});
