"use client";

import { useEffect } from "react";

// Register the service worker in production only — keeps dev free of stale
// build caches. No-ops where service workers aren't supported.
//
// Auto-update: sw.js calls skipWaiting()+clients.claim(), so a freshly
// deployed worker activates and takes control on its own. We listen for that
// takeover and reload once, so the installed PWA picks up new builds without
// the user having to swipe it closed. update() is re-checked every time the
// app becomes visible again (iOS keeps PWAs frozen across days).
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let reloading = false;
    // A controller already present at load means this is an update, not the
    // first install — only then should a takeover trigger a reload.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.update();
        const onVisible = () => {
          if (document.visibilityState === "visible") reg.update();
        };
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {});
  }, []);
  return null;
}
