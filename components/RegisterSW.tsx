"use client";

import { useEffect } from "react";

// Register the service worker in production only — keeps dev free of stale
// build caches. No-ops where service workers aren't supported.
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
