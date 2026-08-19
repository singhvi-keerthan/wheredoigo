// Minimal service worker so "wheredoigokeerthan" installs as a PWA and the shell works
// offline. Network-first for navigations (always get the latest build),
// cache-first for static assets. Never touches /api or cross-origin (map tiles,
// Google) — those always hit the network.
const CACHE = "wheredoigokeerthan-v3";
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
    // Cache each navigation under its OWN url. This used to store every
    // navigation under "/", which was harmless with one page and wrong the
    // moment a second one existed: opening /go would overwrite the cached app
    // shell with the share view (and vice versa).
    e.respondWith(
      fetch(request)
        .then((r) => {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return r;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
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
