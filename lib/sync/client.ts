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
  applyRemotePhoto,
  applyRemotePlaces,
  onLocalChange,
  setPhotoBlobUrl,
  snapshotForSync,
  type RemotePlaceRow,
} from "@/lib/store";
import { idbGetAllPhotos, idbPutPhoto } from "@/lib/photoStore";
import { normalizePhrase } from "@/lib/phrase";
import { accountSecret, normalizePhone } from "@/lib/account";

const OWNER_KEY = "wheredoigokeerthan.sync.owner"; // sha256(phrase) — the capability token
const CURSOR_KEY = "wheredoigokeerthan.sync.cursor"; // max updated_at pulled so far
const DIRTY_KEY = "wheredoigokeerthan.sync.dirty"; // ids changed locally but not yet pushed
// One full pull after the photo-handle merge shipped. Earlier clients advanced
// CURSOR_KEY after discarding remote blobUrls, so an ordinary incremental pull
// can never see those rows again.
const PHOTO_HANDLES_V2_KEY = "wheredoigokeerthan.sync.photoHandles.v2";

// The phrase itself, in plain text, on this device only.
//
// The original design refused to keep it ("the plaintext never persists"), and
// that is what made the feature so easy to get lost in: a phrase you cannot
// look up is a phrase you cannot use to set up your second device, and the app
// gave you exactly one chance to write it down. It buys no security either —
// anyone holding this unlocked phone can already read every place in the
// library the phrase protects, so withholding it defends nothing.
//
// It stays local. It is never sent anywhere, never synced, and never logged;
// only the hash leaves the device, exactly as before.
const PHRASE_KEY = "wheredoigokeerthan.sync.phrase";

// The phone number of a signed-in account, digits only, on this device only.
// Stored so the app can say WHICH account this is; the password is chosen by
// the person and is never stored, never sent, and never recoverable.
const ACCOUNT_KEY = "wheredoigokeerthan.sync.phone";

export type SyncState = "disabled" | "idle" | "syncing" | "error" | "offline";
export interface SyncStatus {
  connected: boolean;
  state: SyncState;
  lastSyncedAt: string | null;
  error: string | null;
  pending: number; // unpushed local changes
  // Queued ids whose record is not on this device any more.
  //
  // push() sends `dirty` filtered against the records it can actually see, so
  // an id with nothing behind it produces no row, is never accepted, and is
  // never cleared — it just sits in the queue inflating `pending` forever.
  // Every one of them is a place that was added and then lost before it went
  // up, and until this counter existed that was invisible: the app knew, and
  // said nothing. Surfaced, not silently dropped — /app/recover looks for what
  // is left of them.
  lost: number;
}

// ---- status (subscribable) -------------------------------------------------
let status: SyncStatus = {
  connected: false,
  state: "disabled",
  lastSyncedAt: null,
  error: null,
  pending: 0,
  lost: 0,
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
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// What shipped first: trim + NFKC, and nothing else. Case and inner spacing were
// part of the secret, so "Amber Pine" and "amber  pine" opened three different
// libraries. Kept, because every owner key already in the database was computed
// this way and PUBLIC_OWNER_HASH is one of them — see resolveOwner.
export async function hashPassphrase(passphrase: string): Promise<string> {
  return sha256Hex(passphrase.trim().normalize("NFKC"));
}

// The canonical hash for anything connected from here on: case-folded, inner
// whitespace collapsed. Someone reading six words off another phone's screen
// will capitalise the first one or double-tap a space, and that must not select
// a different library.
export async function hashPhrase(phrase: string): Promise<string> {
  return sha256Hex(normalizePhrase(phrase).normalize("NFKC"));
}

export interface PhraseProbe {
  owner: string;
  exists: boolean;
  places: number;
  updatedAt: string | null;
  legacy: boolean; // matched only under the pre-normalisation hash
  ambiguous: boolean; // BOTH hashes name real libraries
}

interface ProbeReply {
  exists: boolean;
  owner: string;
  places: number;
  updatedAt: string | null;
  ambiguous: boolean;
}

// Ask the server what a key opens, WITHOUT connecting to it. Counts only — the
// probe endpoint never returns records.
//
// `alt` sends a second candidate in the SAME request. A typed phrase has two
// possible hashes, and probing them separately cost two charges against the
// guessing budget per attempt — which meant the users the legacy fallback
// exists for could be locked out by their own recovery path.
async function probeOwner(primary: string, alt?: string): Promise<ProbeReply> {
  const qs = alt && alt !== primary ? `&alt=${encodeURIComponent(alt)}` : "";
  const res = await fetchT(`/api/sync?probe=1${qs}`, { headers: { Authorization: `Bearer ${primary}` } });
  if (!res.ok) throw new Error(`probe failed (${res.status})`);
  return (await res.json()) as ProbeReply;
}

// The owner key for a phone-and-password account. Disjoint from the phrase
// keyspace by construction — see lib/account.ts accountSecret.
export async function hashAccount(phone: string, password: string): Promise<string> {
  return sha256Hex(accountSecret(phone, password).normalize("NFKC"));
}

// What a phone-and-password opens, without connecting to it. Same contract as
// resolveOwner: the caller shows the answer and only then commits. There is no
// legacy variant to fall back to — accounts did not exist before this.
export async function resolveAccount(phone: string, password: string): Promise<PhraseProbe> {
  const candidate = await hashAccount(phone, password);
  const found = await probeOwner(candidate);
  return { ...found, owner: found.owner || candidate, legacy: false };
}

// Which owner key a typed phrase should use.
//
// Canonical first. If that opens nothing, try the legacy hash before concluding
// the phrase is new — otherwise everyone who connected before this change would
// be told their own phrase was unrecognised the next time they typed it on a
// new device, and would cheerfully "create" a second empty library beside the
// real one. A library found under the legacy hash keeps using it; re-keying its
// rows is not worth the risk of a half-finished migration.
export async function resolveOwner(phrase: string): Promise<PhraseProbe> {
  const canonical = await hashPhrase(phrase);
  const legacy = await hashPassphrase(phrase);
  const found = await probeOwner(canonical, legacy);
  const owner = found.exists ? found.owner : canonical;
  return { ...found, owner, legacy: found.exists && owner === legacy && legacy !== canonical };
}

// ---- push / pull -----------------------------------------------------------
// Strip base64 bytes only from own photos already in Blob (blobUrl set). Google
// photos keep their small remote URL; a not-yet-uploaded photo keeps its bytes
// so it's never lost in transit.
function stripPhotos(p: Place): Place {
  if (!p.photos.length) return p;
  return {
    ...p,
    photos: p.photos.map((ph) => (ph.source === "mine" && ph.blobUrl ? { ...ph, dataUrl: "" } : ph)),
  };
}

// fetch with a timeout so a stalled request can't freeze a whole sync.
function fetchT(input: string, init: RequestInit = {}, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// Must match LIMITS.rowsPerPush on the server. A batch over it is refused with
// a 413, and since `dirty` is only cleared on success, an oversized library
// would retry the same rejected batch forever — permanently unsyncable, with a
// red error and no way out. Chunking is what makes the server's cap a batch
// size instead of a library ceiling.
const PUSH_CHUNK = 500;

async function postBatch(rows: unknown[], extra: { phone?: string | null; alias?: string | null } = {}): Promise<void> {
  const res = await fetchT("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner}` },
    body: JSON.stringify({
      places: rows,
      ...(extra.phone ? { phone: extra.phone } : {}),
      ...(extra.alias ? { alias: extra.alias } : {}),
    }),
  });
  if (!res.ok) throw new Error(`push failed (${res.status})`);
}

async function push(): Promise<void> {
  if (!owner) return;
  if (!dirty.size) {
    // An empty queue cannot be holding anything lost. Without this the warning
    // would be sticky: cleared by nothing, it would outlive the condition it
    // describes and go on accusing the app of a loss that had been resolved.
    if (status.lost) setStatus({ lost: 0 });
    return;
  }
  const sending = new Set(dirty);
  const local = snapshotForSync();

  // Queued ids with no record behind them. Counted BEFORE the send, because
  // afterwards they are indistinguishable from ids that simply haven't landed
  // yet — and the difference matters: one is a request in flight, the other is
  // a place that no longer exists anywhere. They stay in the queue rather than
  // being quietly deleted, because the id is the last trace of what was lost.
  const known = new Set(local.map((p) => p.id));
  const lost = [...sending].filter((id) => !known.has(id));
  if (lost.length !== status.lost) setStatus({ lost: lost.length });

  const rows = local
    .filter((p) => sending.has(p.id))
    .map((p) => ({
      id: p.id,
      data: stripPhotos(p),
      updated_at: p.updatedAt ?? p.createdAt,
      deleted_at: p.deletedAt ?? null,
    }));

  // Clear each slice as it lands, not all of them at the end: a failure halfway
  // through a large first-run migration should keep the work already accepted
  // rather than re-sending it on the next attempt.
  for (let i = 0; i < rows.length; i += PUSH_CHUNK) {
    const slice = rows.slice(i, i + PUSH_CHUNK);
    await postBatch(slice, i === 0 ? { phone: lsGet(ACCOUNT_KEY) } : {});
    slice.forEach((r) => dirty.delete(r.id));
    saveDirty();
  }
}

// An empty push, which is how a device announces a library that has nothing in
// it yet. Without this a brand-new account would not exist server-side until
// its first place, and every sync until then would look like a wrong key.
async function registerRemote(alias?: string | null): Promise<void> {
  if (!owner) return;
  try {
    await postBatch([], { phone: lsGet(ACCOUNT_KEY), alias });
  } catch {
    /* the next sync registers it — never block connecting on this */
  }
}

async function pull(full = false): Promise<void> {
  if (!owner) return;
  const cursor = full ? null : lsGet(CURSOR_KEY);
  const res = await fetchT(cursor ? `/api/sync?since=${encodeURIComponent(cursor)}` : "/api/sync", {
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

// ---- photos (private Blob, proxied through /api/photo) --------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Upload own photos not yet in Blob; on success set blobUrl (which marks the
// record dirty, so the same sync's push carries it). Also the migration path —
// photos added before sync upload on the first connected run.
async function uploadPhotos(): Promise<void> {
  if (!owner) return;
  for (const p of snapshotForSync()) {
    for (const ph of p.photos) {
      if (ph.source !== "mine" || ph.blobUrl || !ph.dataUrl?.startsWith("data:")) continue;
      try {
        const res = await fetchT("/api/photo", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner}` },
          body: JSON.stringify({ id: ph.id, dataUrl: ph.dataUrl }),
        }, 30000);
        if (!res.ok) continue;
        const { url } = (await res.json()) as { url?: string };
        if (url) setPhotoBlobUrl(p.id, ph.id, url);
      } catch {
        /* leave for the next sync */
      }
    }
  }
}

// Fetch photos that synced in with a blobUrl but have no local bytes; cache to
// IDB and hydrate for display.
async function downloadPhotos(): Promise<void> {
  if (!owner) return;
  const have = await idbGetAllPhotos().catch(() => new Map<string, string>());
  for (const p of snapshotForSync()) {
    for (const ph of p.photos) {
      if (!ph.blobUrl || ph.dataUrl || have.has(ph.id)) continue;
      try {
        const res = await fetchT(`/api/photo?url=${encodeURIComponent(ph.blobUrl)}`, {
          headers: { Authorization: `Bearer ${owner}` },
        }, 30000);
        if (!res.ok) continue;
        const dataUrl = await blobToDataUrl(await res.blob());
        await idbPutPhoto(ph.id, dataUrl);
        applyRemotePhoto(ph.id, dataUrl);
      } catch {
        /* leave for the next sync */
      }
    }
  }
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
    // Repair first, before a stale dirty record can push its photo array back
    // over the server's Blob handles. The marker lands only after the complete
    // snapshot was applied; a failed request retries on the next sync.
    if (lsGet(PHOTO_HANDLES_V2_KEY) !== "1") {
      await pull(true);
      lsSet(PHOTO_HANDLES_V2_KEY, "1");
    }
    // Records first — fast, and the priority. Status flips to "Synced" here so a
    // large first-run photo migration can't keep the UI stuck on "Syncing…".
    await push();
    await pull();
    setStatus({ state: "idle", lastSyncedAt: new Date().toISOString(), error: null, pending: dirty.size });
    // Photos after, best-effort: a slow or failed photo never blocks records or
    // the status; failures just retry on the next sync.
    try {
      await uploadPhotos();
      await downloadPhotos();
    } catch {
      /* retry next sync */
    }
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

// Connect this device to an owner key already resolved by resolveOwner(): mark
// all local records for push (first-run migration), reset the pull cursor so we
// fetch the full remote library, then merge.
//
// Takes the resolved key rather than the phrase on purpose. The old connect()
// hashed whatever it was handed and reported success either way, so a typo
// selected an empty namespace, showed a green "Synced", and pushed the whole
// local library into it — into a stranger's library, if the typo collided with
// their phrase. Resolving and CONFIRMING is now the caller's job (see
// SyncSection), and this function can no longer be reached without it.
export async function connectAs(
  ownerKey: string,
  id: { phrase?: string; phone?: string; legacy?: boolean; recovery?: string }
): Promise<void> {
  owner = ownerKey;
  lsSet(OWNER_KEY, ownerKey);
  // Exactly one of these. A generated phrase is kept because nobody can be
  // expected to remember it; an account keeps only the phone, because the
  // password is the person's own and storing it would be storing a password.
  //
  // A LEGACY phrase is stored exactly as typed, not normalised. Its owner key
  // is sha256 of the raw string, so the normalised form hashes to something
  // else — showing that on "Show phrase for another device" would hand the next
  // device a phrase that opens nothing, and the "use it anyway" escape would
  // fork an empty library beside the real one. The precise bug this flow
  // exists to prevent.
  if (id.phrase) lsSet(PHRASE_KEY, id.legacy ? id.phrase.trim() : normalizePhrase(id.phrase));
  if (id.phone) lsSet(ACCOUNT_KEY, normalizePhone(id.phone));
  // An account's recovery phrase: a SECOND key registered against this same
  // owner, so forgetting the password is survivable. Kept locally too, because
  // it was generated here and nobody can be expected to have memorised it.
  if (id.recovery) lsSet(PHRASE_KEY, normalizePhrase(id.recovery));
  siteOwner = null; // a different key may be a different person — re-ask
  dirty = new Set(snapshotForSync().map((p) => p.id));
  saveDirty();
  lsDel(CURSOR_KEY);
  lsDel(PHOTO_HANDLES_V2_KEY);
  setStatus({ connected: true, state: "idle", pending: dirty.size, error: null });
  // Exist server-side even with nothing to push yet, and register the recovery
  // phrase in the same call that creates the library.
  await registerRemote(id.recovery ? await hashPhrase(id.recovery) : null);
  await sync();
}

// ---- "is this Keerthan's own device?" --------------------------------------
//
// Asked once per page load and cached, because the answer cannot change without
// a reconnect. Defaults to FALSE and only ever upgrades: the thing it gates is
// whether to draw Keerthan's face on the map, and a stranger seeing it for a
// moment while a fetch resolves is the one outcome worth designing against.
let siteOwner: boolean | null = null;
const siteOwnerListeners = new Set<() => void>();

export function useIsSiteOwner(): boolean {
  return useSyncExternalStore(
    (cb) => {
      siteOwnerListeners.add(cb);
      void resolveSiteOwner();
      return () => siteOwnerListeners.delete(cb);
    },
    () => siteOwner === true,
    () => false // server render: never the owner, so the generic marker is what hydrates
  );
}

let siteOwnerInFlight: Promise<void> | null = null;
function resolveSiteOwner(): Promise<void> {
  if (siteOwner !== null) return Promise.resolve();
  if (siteOwnerInFlight) return siteOwnerInFlight;
  const key = ownerToken();
  if (!key) {
    // No key at all — not connected, so certainly not the owner. Left as null
    // rather than false so connecting later re-asks.
    return Promise.resolve();
  }
  siteOwnerInFlight = fetchT("/api/me", { headers: { Authorization: `Bearer ${key}` } })
    .then((r) => (r.ok ? r.json() : { owner: false }))
    .then((body: { owner?: boolean }) => {
      siteOwner = Boolean(body.owner);
      siteOwnerListeners.forEach((l) => l());
    })
    .catch(() => {
      /* leave null so a later render retries */
    })
    .finally(() => {
      siteOwnerInFlight = null;
    });
  return siteOwnerInFlight;
}

// The phrase for this device, for showing the user when they set up another one.
export function savedPhrase(): string | null {
  return lsGet(PHRASE_KEY);
}

// The phone number this device is signed in as, or null when it was connected
// with a recovery phrase instead.
export function savedPhone(): string | null {
  return lsGet(ACCOUNT_KEY);
}

// The owner key this device is connected as, or null. Read by lib/swiggyClient
// to prove which library is calling — the Swiggy routes are Keerthan's alone.
//
// Falls back to localStorage because the module-level `owner` is only populated
// by startSync(), and a caller that runs before the boot component mounts would
// otherwise read null and be told it is not the owner.
export function ownerToken(): string | null {
  return owner ?? lsGet(OWNER_KEY);
}

// What the SERVER holds for this device's library — counts only, no records.
//
// For the recovery screen, which is otherwise entirely local: it reads
// localStorage and IndexedDB and makes no network call at all. That is the
// right design (the records that went missing were never on the server, so
// asking it re-answers a settled question) but it left the screen silent about
// the half of the system the person is most likely to be wondering about, and
// "did this actually look anywhere?" is a fair thing to wonder when a local
// scan finishes in a few milliseconds.
//
// Reuses the probe endpoint, which returns { exists, places, updatedAt } and
// never returns records. A real owner key is not charged against the
// anti-guessing budget — only lookups that match NOTHING are — so a library's
// own device can ask this freely.
export interface ServerSummary {
  places: number;
  updatedAt: string | null;
}

export async function serverSummary(): Promise<ServerSummary | null> {
  // ownerToken(), NOT the bare `owner`. The module-level variable is populated
  // by startSync(), which runs from SyncBoot — and the root layout renders
  // {children} BEFORE <SyncBoot />, so a page's own mount effect fires first.
  // Reading `owner` there is reading null, and this reported "not syncing on
  // this device" to an owner who is plainly syncing. Caught in a browser, not
  // by types: it fails silently and looks like a truthful answer, which is the
  // worst way for a diagnostic to be wrong.
  const key = ownerToken();
  if (!key) return null; // genuinely not syncing — nothing on a server to ask about
  const res = await fetchT(`/api/sync?probe=1`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`server check failed (${res.status})`);
  const body = (await res.json()) as ProbeReply;
  return { places: body.places ?? 0, updatedAt: body.updatedAt ?? null };
}

// Stop syncing on this device. Local data is untouched; server data remains.
export function disconnect(): void {
  owner = null;
  dirty = new Set();
  lsDel(OWNER_KEY);
  lsDel(CURSOR_KEY);
  lsDel(DIRTY_KEY);
  lsDel(PHOTO_HANDLES_V2_KEY);
  lsDel(PHRASE_KEY);
  lsDel(ACCOUNT_KEY);
  siteOwner = null;
  setStatus({ connected: false, state: "disabled", pending: 0, lost: 0, error: null, lastSyncedAt: null });
}
