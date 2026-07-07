"use client";

import { useEffect } from "react";
import { startSync } from "@/lib/sync/client";

// Starts the sync engine once on app load: if this device has a connected
// passphrase, it pulls on load + refocus and pushes local changes. No-op until
// a passphrase is connected (from the Menu). Mounted in the root layout.
export default function SyncBoot() {
  useEffect(() => {
    startSync();
  }, []);
  return null;
}
