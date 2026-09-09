"use client";

// Reads every place this device might still be holding that the map is not
// showing, and every photo that no longer belongs to anything.
//
// Written after 2026-09-06, when a session's worth of entries — Legacy Brewing
// Company among them — never reached the server and were not on the phone
// either. The server side was provably clean: 34 rows, one owner, zero
// tombstones, and 45 blobs every one of which a surviving record referenced.
// Nothing had been deleted; it had never arrived. Which leaves exactly one
// place a copy could still exist, and no way to look at it.
//
// The store already writes such a copy and never reads it back. On a parse
// failure read() moves the raw string aside as `<key>.corrupt.<ms>` and starts
// empty — a real backup, invisible to the UI, unreachable without devtools, on
// a phone. Photo bytes are a second copy: they live in IndexedDB keyed by photo
// id, and commit() only removes them when it sees the place lose the photo. A
// record that vanished without a commit leaves its photos behind, orphaned but
// intact.
//
// So this module looks in four places and reports what it finds. It reads only
// — nothing here writes, migrates, or deletes. restorePlaces() in lib/store.ts
// is the separate, explicit step.

import type { Place } from "./types";

const PREFIX = "wheredoigokeerthan.";
const LEGACY_PREFIX = "imhungry."; // pre-rename keys, deliberately left behind by lib/migrate.ts
const PLACES_SUFFIX = "places.v1";
const DIRTY_KEY = `${PREFIX}sync.dirty`;

const DB_NAMES = ["wheredoigokeerthan", "imhungry"] as const;
const PHOTO_STORE = "photos";

export type StoreKind = "live" | "corrupt" | "legacy" | "legacy-corrupt";

export interface FoundStore {
  key: string; // the localStorage key it came from
  kind: StoreKind;
  savedAt: string | null; // ISO, decoded from a `.corrupt.<ms>` suffix
  places: Place[];
  bytes: number;
  salvaged: boolean; // true when the value did NOT parse and was recovered object-by-object
}

export interface OrphanPhoto {
  id: string;
  dataUrl: string;
  db: string;
  bytes: number;
}

export interface RecoveryReport {
  stores: FoundStore[];
  /** Places present in some store but absent from the live library — the actual find. */
  missing: Place[];
  /** Sync ids queued for push whose record exists nowhere. Proof a record was lost, not merely unsynced. */
  danglingDirty: string[];
  photos: {
    total: number;
    orphans: OrphanPhoto[];
  };
  /** Set when something stopped this scan reading a surface, rather than reading it and finding nothing. */
  errors: string[];
}

// ---- localStorage ----------------------------------------------------------

// A place, minimally. Deliberately the same four fields importData() checks, so
// a record this accepts is a record the app already considers well-formed.
function looksLikePlace(v: unknown): v is Place {
  const p = v as Partial<Place> | null;
  return (
    !!p &&
    typeof p === "object" &&
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.lat === "number" &&
    typeof p.lng === "number"
  );
}

// Pull whole objects out of a JSON array that does not parse.
//
// The failure this exists for is a truncated write: localStorage refused
// mid-string, or the tab died partway through setItem, leaving `[{...},{...},{`
// on disk. JSON.parse rejects the whole thing, so read() files it under
// `.corrupt.` and the ninety-nine intact records go down with the broken
// hundredth. Walking the string and parsing each top-level object on its own
// gets all but the one that was actually cut.
//
// Quote and escape state are tracked because a brace inside a name ("Bunco
// {HSR}") or an escaped quote would otherwise end an object early and turn one
// good record into two unparseable halves.
export function salvagePlaces(raw: string): Place[] {
  const out: Place[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          const parsed: unknown = JSON.parse(raw.slice(start, i + 1));
          if (looksLikePlace(parsed)) out.push(parsed);
        } catch {
          /* one unsalvageable object — the others are still worth having */
        }
        start = -1;
      }
      if (depth < 0) depth = 0; // a stray closer; resynchronise rather than give up
    }
  }
  return out;
}

function classify(key: string): { kind: StoreKind; savedAt: string | null } | null {
  const legacy = key.startsWith(LEGACY_PREFIX);
  const prefix = legacy ? LEGACY_PREFIX : PREFIX;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (rest === PLACES_SUFFIX) return { kind: legacy ? "legacy" : "live", savedAt: null };
  if (!rest.startsWith(`${PLACES_SUFFIX}.corrupt.`)) return null;
  // read() names these with Date.now(), so the suffix is when the store went
  // unreadable — which is the closest thing to a timestamp the backup has.
  const ms = Number(rest.slice(`${PLACES_SUFFIX}.corrupt.`.length));
  return {
    kind: legacy ? "legacy-corrupt" : "corrupt",
    savedAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
  };
}

function scanLocalStorage(errors: string[]): FoundStore[] {
  const stores: FoundStore[] = [];
  let keys: string[];
  try {
    keys = Object.keys(window.localStorage);
  } catch (e) {
    errors.push(`localStorage unreadable: ${String(e)}`);
    return stores;
  }

  for (const key of keys) {
    const c = classify(key);
    if (!c) continue;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      errors.push(`could not read ${key}`);
      continue;
    }
    if (!raw) continue;

    let places: Place[];
    let salvaged = false;
    try {
      const parsed: unknown = JSON.parse(raw);
      places = Array.isArray(parsed) ? parsed.filter(looksLikePlace) : [];
    } catch {
      places = salvagePlaces(raw);
      salvaged = true;
    }
    stores.push({ key, kind: c.kind, savedAt: c.savedAt, places, bytes: raw.length, salvaged });
  }

  // Live first, then most recently orphaned — the newest corrupt copy is the
  // one most likely to hold the session that went missing.
  return stores.sort((a, b) => {
    if (a.kind === "live" && b.kind !== "live") return -1;
    if (b.kind === "live" && a.kind !== "live") return 1;
    return (b.savedAt ?? "").localeCompare(a.savedAt ?? "");
  });
}

function readDirty(errors: string[]): string[] {
  try {
    const raw = window.localStorage.getItem(DIRTY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch (e) {
    errors.push(`sync queue unreadable: ${String(e)}`);
    return [];
  }
}

// ---- IndexedDB -------------------------------------------------------------

// Open a database ONLY if it already exists.
//
// Opening by name creates an empty one as a side effect, and lib/photoStore.ts
// treats the legacy DB's existence as meaningful — its first-open migration
// deletes a legacy DB it had to create. A diagnostic that conjures the thing it
// is looking for would poison exactly the evidence it came to collect.
async function openExisting(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (typeof indexedDB.databases === "function") {
    try {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === name)) return null;
    } catch {
      /* fall through — the open below still refuses to upgrade */
    }
  }
  return new Promise((resolve) => {
    // No version: an open without one never triggers onupgradeneeded on an
    // existing DB, and for a DB that does not exist we catch the creation and
    // undo it.
    const req = indexedDB.open(name);
    let created = false;
    req.onupgradeneeded = () => {
      created = true;
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (created) {
        db.close();
        indexedDB.deleteDatabase(name);
        resolve(null);
        return;
      }
      resolve(db);
    };
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function scanPhotos(errors: string[]): Promise<Map<string, { dataUrl: string; db: string }>> {
  const found = new Map<string, { dataUrl: string; db: string }>();
  for (const name of DB_NAMES) {
    const db = await openExisting(name);
    if (!db) continue;
    try {
      if (!db.objectStoreNames.contains(PHOTO_STORE)) continue;
      const store = db.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE);
      const [keys, values] = await Promise.all([
        idbRequest(store.getAllKeys()),
        idbRequest(store.getAll()),
      ]);
      keys.forEach((k, i) => {
        const id = String(k);
        // The current DB wins a tie: photoStore copies legacy photos forward on
        // first open, so the same id in both is one photo, not two.
        if (!found.has(id)) found.set(id, { dataUrl: String(values[i]), db: name });
      });
    } catch (e) {
      errors.push(`photo store "${name}" unreadable: ${String(e)}`);
    } finally {
      db.close();
    }
  }
  return found;
}

// ---- the scan --------------------------------------------------------------

/**
 * Read every surface this device could still be holding a lost record in.
 * Read-only: nothing here writes, migrates or deletes.
 *
 * `live` is the library as the app currently sees it — passed in rather than
 * read here so the report is measured against exactly what is on screen.
 */
export async function scanForLostData(live: Place[]): Promise<RecoveryReport> {
  const errors: string[] = [];
  const stores = scanLocalStorage(errors);
  const dirty = readDirty(errors);
  const photos = await scanPhotos(errors);

  const liveIds = new Set(live.map((p) => p.id));

  // Everything any store holds that the map does not. Deduped by id, newest
  // copy of a duplicate kept — two stores can hold the same place at different
  // ages, and the later edit is the one worth offering back.
  const byId = new Map<string, Place>();
  for (const store of stores) {
    for (const p of store.places) {
      if (liveIds.has(p.id)) continue;
      const seen = byId.get(p.id);
      const ts = (x: Place) => x.updatedAt ?? x.createdAt ?? "";
      if (!seen || ts(p) > ts(seen)) byId.set(p.id, p);
    }
  }
  const missing = Array.from(byId.values()).sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? "")
  );

  // A queued id with no record anywhere is the loss itself, in the app's own
  // bookkeeping: something was added, marked for push, and then disappeared
  // before it went up. push() filters the queue against the records it can see,
  // so these never send and never clear — they sit in the pending count forever
  // with nothing behind them.
  const knownIds = new Set([...liveIds, ...byId.keys()]);
  const danglingDirty = dirty.filter((id) => !knownIds.has(id));

  // Photos belonging to no record the device can see — live or recovered.
  // These are the bytes themselves, and they outlive their place because
  // commit() only deletes a photo it watched a place lose.
  const referenced = new Set<string>();
  for (const p of [...live, ...byId.values()]) for (const ph of p.photos ?? []) referenced.add(ph.id);
  const orphans: OrphanPhoto[] = [];
  photos.forEach((v, id) => {
    if (referenced.has(id)) return;
    orphans.push({ id, dataUrl: v.dataUrl, db: v.db, bytes: v.dataUrl.length });
  });

  return {
    stores,
    missing,
    danglingDirty,
    photos: { total: photos.size, orphans },
    errors,
  };
}

// A found place plus whatever photo bytes this device still has for it, so a
// restore brings the pictures back with the record rather than a set of empty
// frames. Bytes come from IndexedDB, which is where the store keeps them.
export async function hydratePhotos(places: Place[]): Promise<Place[]> {
  if (!places.length) return places;
  const errors: string[] = [];
  const photos = await scanPhotos(errors);
  if (!photos.size) return places;
  return places.map((p) => {
    if (!p.photos?.length) return p;
    return {
      ...p,
      photos: p.photos.map((ph) =>
        ph.dataUrl || !photos.has(ph.id) ? ph : { ...ph, dataUrl: photos.get(ph.id)!.dataUrl }
      ),
    };
  });
}
