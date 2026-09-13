const SOURCE = String.raw`// Minimal service worker so "wheredoigokeerthan" installs as a PWA and the shell works
// offline. Network-first for navigations (always get the latest build),
// cache-first for static assets. Never touches /api or cross-origin (map tiles,
// Google) — those always hit the network.
const REVISION = __DEPLOYMENT_REVISION__;
const CACHE = "wheredoigokeerthan-" + REVISION;
// "/" is the share view and "/app" is the app; both are real navigations that
// have to work offline, and before the move only one of them existed.
//
// "/icon.svg" used to be in this list and does not exist — it 404s, and there
// is no such file anywhere in the repo. That one dead entry meant this worker
// NEVER INSTALLED: cache.addAll() rejects the whole batch if a single request
// fails, so install's waitUntil rejected, skipWaiting() never ran, and every
// cache-version bump since was a fix that could not land. The offline shell was
// not degraded, it was absent.
const SHELL = ["/", "/app", "/manifest.webmanifest", "/icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // Individually, not addAll(). Precaching is an optimisation; installing is
      // not. One asset that 404s should cost us that asset's offline copy, not
      // the entire service worker — which is exactly what it cost before, in
      // silence, for as long as the list held a name that wasn't there.
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
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
          // A navigation FetchEvent has redirect mode "manual", so /go (a 308)
          // resolves to an opaqueredirect response that cache.put rejects.
          // Without the catch that is an unhandled rejection in the worker on
          // every hit of an old link. The redirect itself is unaffected.
          const copy = r.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(request, copy))
            .catch(() => {});
          return r;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            // Offline and this exact url was never cached. Fall back WITHIN the
            // half of the app the person was in: an /app navigation must not
            // land on the share view, which is a different library (Keerthan's)
            // and cannot write anything.
            return caches.match(url.pathname.startsWith("/app") ? "/app" : "/");
          })
        )
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
`;

type DeploymentEnv = {
  VERCEL_DEPLOYMENT_ID?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  [key: string]: string | undefined;
};

export function deploymentRevision(env: DeploymentEnv = process.env): string {
  return env.VERCEL_DEPLOYMENT_ID ?? env.VERCEL_GIT_COMMIT_SHA ?? "development";
}

export function serviceWorkerScript(revision: string): string {
  return SOURCE.replace("__DEPLOYMENT_REVISION__", JSON.stringify(revision));
}
