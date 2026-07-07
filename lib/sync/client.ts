"use client";

// Cross-device sync engine (records only; photo bytes are a later Blob phase).
//
// Local-first stays the source of truth: the app reads/writes localStorage +
// IndexedDB as before. This layer, when a passphrase is connected, mirrors
// place records to Neon via /api/sync — pushing local changes and pulling
// remote ones (last-write-wins by updatedAt). The passphrase is hashed here
// (Web Crypto) and only its sha256 is stored/sent; the plaintext never persists.

import { useSyncExternalStore } from "react";
import type { Place } from "@/lib/types";
import {
  applyRemotePlaces,
  onLocalChange,
  snapshotForSync,
  type RemotePlaceRow,
} from "@/lib/store";

const OWNER_KEY = "imhungry.sync.owner"; // sha256(passphrase) — the capability token
const CURSOR_KEY = "imhungry.sync.cursor"; // max updated_at pulled so far
const DIRTY_KEY = "imhungry.sync.dirty"; // ids changed locally but not yet pushed

export type SyncState = "disabled" | "idle" | "syncing" | "error" | "offline";
export interface SyncStatus {
  connected: boolean;
  state: SyncState;
  lastSyncedAt: string | null;
  error: string | null;
  pending: number; // unpushed local changes
}

// ---- status (subscribable) -------------------------------------------------
let status: SyncStatus = {
  connected: false,
  state: "disabled",
  lastSyncedAt: null,
  error: null,
  pending: 0,
};
const statusListeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((l) => l());
}
function subscribeStatus(cb: () => void) {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}
function getStatus() {
  return status;
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeStatus, getStatus, getStatus);
}

// ---- localStorage helpers --------------------------------------------------
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, val: string) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* quota / private mode — sync degrades, local data is unaffected */
  }
}
function lsDel(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

let owner: string | null = null;
let dirty = new Set<string>();

function loadDirty(): Set<string> {
  try {
    const raw = lsGet(DIRTY_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}
function saveDirty() {
  lsSet(DIRTY_KEY, JSON.stringify([...dirty]));
}

// ---- hashing ---------------------------------------------------------------
export async function hashPassphrase(passphrase: string): Promise<string> {
  const bytes = new TextEncoder().encode(passphrase.normalize("NFKC"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- push / pull -----------------------------------------------------------
function stripPhotos(p: Place): Place {
  return p.photos.length ? { ...p, photos: p.photos.map((ph) => ({ ...ph, dataUrl: "" })) } : p;
}

async function push(): Promise<void> {
  if (!owner || !dirty.size) return;
  const sending = new Set(dirty);
  const rows = snapshotForSync()
    .filter((p) => sending.has(p.id))
    .map((p) => ({
      id: p.id,
      data: stripPhotos(p),
      updated_at: p.updatedAt ?? p.createdAt,
      deleted_at: p.deletedAt ?? null,
    }));
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner}` },
    body: JSON.stringify({ places: rows }),
  });
  if (!res.ok) throw new Error(`push failed (${res.status})`);
  sending.forEach((id) => dirty.delete(id)); // clear only what we sent
  saveDirty();
}

async function pull(): Promise<void> {
  if (!owner) return;
  const cursor = lsGet(CURSOR_KEY);
  const res = await fetch(cursor ? `/api/sync?since=${encodeURIComponent(cursor)}` : "/api/sync", {
    headers: { Authorization: `Bearer ${owner}` },
  });
  if (!res.ok) throw new Error(`pull failed (${res.status})`);
  const body = (await res.json()) as { places?: RemotePlaceRow[] };
  const rows = body.places ?? [];
  if (!rows.length) return;
  applyRemotePlaces(rows);
  let max = cursor ?? "";
  for (const r of rows) if (r.updated_at > max) max = r.updated_at;
  if (max) lsSet(CURSOR_KEY, max);
}

// One sync = push local changes, then pull remote. Serialised: overlapping
// triggers coalesce into a single trailing run.
let running = false;
let queued = false;
export async function sync(): Promise<void> {
  if (!owner) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    setStatus({ state: "offline", pending: dirty.size });
    return;
  }
  if (running) {
    queued = true;
    return;
  }
  running = true;
  setStatus({ state: "syncing", error: null });
  try {
    await push();
    await pull();
    setStatus({ state: "idle", lastSyncedAt: new Date().toISOString(), error: null, pending: dirty.size });
  } catch (e) {
    setStatus({ state: "error", error: e instanceof Error ? e.message : "sync failed", pending: dirty.size });
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void sync();
    }
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
function scheduleSync(delay = 1500) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void sync();
  }, delay);
}

// ---- lifecycle -------------------------------------------------------------
let started = false;
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  owner = lsGet(OWNER_KEY);
  dirty = loadDirty();
  setStatus({ connected: !!owner, pending: dirty.size, state: owner ? "idle" : "disabled" });

  onLocalChange((ids) => {
    if (!owner) return;
    ids.forEach((id) => dirty.add(id));
    saveDirty();
    setStatus({ pending: dirty.size });
    scheduleSync();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
  window.addEventListener("online", () => void sync());

  if (owner) void sync();
}

// Connect this device: hash the passphrase, mark all local records for push
// (first-run migration), and reset the pull cursor so we fetch the full remote
// library, then merge. Any passphrase is valid — it simply selects a namespace.
export async function connect(passphrase: string): Promise<void> {
  const token = await hashPassphrase(passphrase.trim());
  owner = token;
  lsSet(OWNER_KEY, token);
  dirty = new Set(snapshotForSync().map((p) => p.id));
  saveDirty();
  lsDel(CURSOR_KEY);
  setStatus({ connected: true, state: "idle", pending: dirty.size, error: null });
  await sync();
}

// Stop syncing on this device. Local data is untouched; server data remains.
export function disconnect(): void {
  owner = null;
  dirty = new Set();
  lsDel(OWNER_KEY);
  lsDel(CURSOR_KEY);
  lsDel(DIRTY_KEY);
  setStatus({ connected: false, state: "disabled", pending: 0, error: null, lastSyncedAt: null });
}
