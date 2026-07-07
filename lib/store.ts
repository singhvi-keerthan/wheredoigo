"use client";

import { useSyncExternalStore } from "react";
import type { Photo, Place, Tag, TagNamespace, Visit } from "./types";
import { SEED_PLACES } from "./seed";
import { idbAvailable, idbDeletePhoto, idbGetAllPhotos, idbPutPhoto } from "./photoStore";

// ---------------------------------------------------------------------------
// Local-first store. Place records live in localStorage; photo bytes live in
// IndexedDB (lib/photoStore.ts) so photos can't blow the ~5MB localStorage
// quota. This module keeps a fully-hydrated in-memory mirror (photos carry
// their dataUrls) and notifies React via useSyncExternalStore. v2 swaps the
// persistence layer for Supabase without changing the call sites.
// ---------------------------------------------------------------------------

const KEY = "imhungry.places.v1";

let cache: Place[] | null = null;
const listeners = new Set<() => void>();
// Stable reference for the server/initial snapshot (must not be re-created per call).
const EMPTY: Place[] = [];

// Photo ids confirmed written to IndexedDB — only these are stripped from the
// localStorage copy, so a photo is never dropped from LS before IDB has it.
const idbStored = new Set<string>();
let initStarted = false;

// Surfaced in the UI (AppShell banner) — a silent persist failure is data loss.
let persistError: string | null = null;

function setPersistError(msg: string | null) {
  if (persistError === msg) return;
  persistError = msg;
  listeners.forEach((l) => l());
}

function notify() {
  listeners.forEach((l) => l());
}

// Untouched seed places (identical to the shipped fixtures) are dropped — real
// data only. A seed the user edited (visited, rated, tagged…) no longer
// stringify-matches its fixture and is kept.
function stripUntouchedSeeds(places: Place[]): { places: Place[]; dropped: boolean } {
  const fixtures = new Map(SEED_PLACES.map((s) => [s.id, JSON.stringify(s)]));
  const kept = places.filter(
    (p) => !p.id.startsWith("seed-") || fixtures.get(p.id) !== JSON.stringify(p)
  );
  return { places: kept, dropped: kept.length !== places.length };
}

function read(): Place[] {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;

  let dropped = false;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Place[];
        ({ places: cache, dropped } = stripUntouchedSeeds(parsed));
      } catch {
        // Corrupt store: preserve the raw string before showing anything else —
        // never let a parse failure silently eat the library.
        try {
          window.localStorage.setItem(`${KEY}.corrupt.${Date.now()}`, raw);
        } catch {
          /* best effort */
        }
        cache = [];
        setPersistError("Saved data couldn’t be read — a backup copy was kept. Export it before adding places.");
      }
    } else {
      cache = [];
    }
  } catch {
    cache = [];
  }

  scheduleInit(dropped);
  return cache;
}

// Async boot: hydrate photo dataUrls from IndexedDB, migrate any photos still
// embedded in localStorage into IDB, then persist the slimmed record set.
// Deferred out of read() so the sync render path never mutates storage.
function scheduleInit(persistNeeded: boolean) {
  if (initStarted) return;
  initStarted = true;
  setTimeout(async () => {
    let changed = persistNeeded;
    if (idbAvailable()) {
      try {
        const stored = await idbGetAllPhotos();
        stored.forEach((_v, k) => idbStored.add(k));

        const current = cache ?? [];
        let hydratedAny = false;
        const hydrated = current.map((p) => {
          if (!p.photos.length) return p;
          const photos = p.photos.map((ph) => {
            if (!ph.dataUrl && stored.has(ph.id)) {
              hydratedAny = true;
              return { ...ph, dataUrl: stored.get(ph.id)! };
            }
            return ph;
          });
          return photos === p.photos ? p : { ...p, photos };
        });

        // Migrate embedded photos (pre-IDB stores) into IDB. Only after a put
        // succeeds is the photo eligible for stripping from localStorage.
        for (const p of hydrated) {
          for (const ph of p.photos) {
            if (ph.dataUrl && !idbStored.has(ph.id)) {
              try {
                await idbPutPhoto(ph.id, ph.dataUrl);
                idbStored.add(ph.id);
                changed = true;
              } catch {
                /* stays embedded in LS — no data loss */
              }
            }
          }
        }

        if (hydratedAny) {
          cache = hydrated;
          notify();
        }
      } catch {
        /* IDB unavailable (private mode…) — records stay embedded in LS */
      }
    }
    if (changed) persistLS(cache ?? []);
  }, 0);
}

// Write records to localStorage with IDB-backed photo bytes stripped out.
function persistLS(places: Place[]) {
  try {
    const slim = places.map((p) =>
      p.photos.length
        ? { ...p, photos: p.photos.map((ph) => (idbStored.has(ph.id) ? { ...ph, dataUrl: "" } : ph)) }
        : p
    );
    window.localStorage.setItem(KEY, JSON.stringify(slim));
    setPersistError(null);
  } catch {
    setPersistError("Couldn’t save — device storage is full. Export a backup, then free up space.");
  }
}

function commit(next: Place[]) {
  const prev = cache ?? [];
  cache = next;
  notify();

  void (async () => {
    if (idbAvailable()) {
      // New photos → IDB first, then strip from the LS copy.
      for (const p of next) {
        for (const ph of p.photos) {
          if (ph.dataUrl && !idbStored.has(ph.id)) {
            try {
              await idbPutPhoto(ph.id, ph.dataUrl);
              idbStored.add(ph.id);
            } catch {
              /* stays embedded in LS */
            }
          }
        }
      }
      // Photos that disappeared → clean out of IDB.
      const nextIds = new Set(next.flatMap((p) => p.photos.map((ph) => ph.id)));
      for (const p of prev) {
        for (const ph of p.photos) {
          if (!nextIds.has(ph.id) && idbStored.has(ph.id)) {
            idbStored.delete(ph.id);
            idbDeletePhoto(ph.id).catch(() => {});
          }
        }
      }
    }
    persistLS(next);
  })();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// ---- React hooks ----------------------------------------------------------

export function usePlaces(): Place[] {
  return useSyncExternalStore(
    subscribe,
    () => read(),
    () => EMPTY // server snapshot: stable empty ref (client hydrates after mount)
  );
}

export function usePlace(id: string | null): Place | null {
  const places = usePlaces();
  return id ? places.find((p) => p.id === id) ?? null : null;
}

// Non-hook read of one place from the in-memory mirror — for async helpers
// (e.g. enrichment) that need the current record outside React render.
export function getPlace(id: string): Place | null {
  return read().find((p) => p.id === id) ?? null;
}

// Non-null when the last persist failed (storage full / unreadable store).
export function usePersistError(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => persistError,
    () => null
  );
}

// ---- Mutations ------------------------------------------------------------

export function addPlace(
  input: Omit<Place, "id" | "createdAt" | "visits" | "photos" | "favorite" | "neverAgain"> &
    Partial<Pick<Place, "favorite" | "neverAgain" | "visits" | "photos">>
): Place {
  const place: Place = {
    favorite: false,
    neverAgain: false,
    visits: [],
    photos: [],
    ...input,
    id: uid(),
    createdAt: new Date().toISOString(),
  };
  commit([place, ...read()]);
  return place;
}

export function updatePlace(id: string, patch: Partial<Place>) {
  commit(read().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

export function removePlace(id: string) {
  commit(read().filter((p) => p.id !== id));
}

export function toggleFavorite(id: string) {
  const p = read().find((x) => x.id === id);
  if (p) updatePlace(id, { favorite: !p.favorite });
}

export function toggleNeverAgain(id: string) {
  const p = read().find((x) => x.id === id);
  if (p) updatePlace(id, { neverAgain: !p.neverAgain });
}

export function setTags(id: string, tags: Tag[]) {
  updatePlace(id, { tags });
}

// Adding a visit is also the watchlist -> visited transition (append-only history).
export function addVisit(id: string, visit: Omit<Visit, "id" | "createdAt">): Visit | undefined {
  const p = read().find((x) => x.id === id);
  if (!p) return undefined;
  const v: Visit = { ...visit, id: uid(), createdAt: new Date().toISOString() };
  updatePlace(id, {
    status: "visited",
    visits: [v, ...p.visits],
    // Your rating tracks your latest take: a rated visit updates it.
    myRating: visit.rating ?? p.myRating,
  });
  return v; // caller can attach a visit-scoped photo to v.id
}

export function addPhoto(id: string, photo: Omit<Photo, "id" | "createdAt">) {
  const p = read().find((x) => x.id === id);
  if (!p) return;
  const ph: Photo = { ...photo, id: uid(), createdAt: new Date().toISOString() };
  updatePlace(id, { photos: [...p.photos, ph] });
}

export function removePhoto(placeId: string, photoId: string) {
  const p = read().find((x) => x.id === placeId);
  if (!p) return;
  updatePlace(placeId, { photos: p.photos.filter((ph) => ph.id !== photoId) });
}

// ---- Custom tags vocabulary ----------------------------------------------
// User-added tag values per namespace, merged with the fixed TAG_OPTIONS in the
// UI. Persisting them here makes a tag you invent on one place available on all.

type TagVocab = Record<TagNamespace, string[]>;
const TAG_KEY = "imhungry.tags.v1";
const EMPTY_VOCAB: TagVocab = { type: [], cuisine: [], staple: [], occasion: [], vibe: [], practical: [] };

let tagCache: TagVocab | null = null;
const tagListeners = new Set<() => void>();

function readTags(): TagVocab {
  if (tagCache) return tagCache;
  if (typeof window === "undefined") return (tagCache = EMPTY_VOCAB);
  try {
    const raw = window.localStorage.getItem(TAG_KEY);
    tagCache = raw ? { ...EMPTY_VOCAB, ...(JSON.parse(raw) as Partial<TagVocab>) } : EMPTY_VOCAB;
  } catch {
    tagCache = EMPTY_VOCAB;
  }
  return tagCache;
}

function commitTags(next: TagVocab) {
  tagCache = next;
  try {
    window.localStorage.setItem(TAG_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("im hungry: could not persist tags.", e);
  }
  tagListeners.forEach((l) => l());
}

function subscribeTags(listener: () => void) {
  tagListeners.add(listener);
  return () => tagListeners.delete(listener);
}

export function useCustomTags(): TagVocab {
  return useSyncExternalStore(subscribeTags, readTags, () => EMPTY_VOCAB);
}

// Add a custom value to a namespace (normalised, de-duped). Returns the stored value.
export function addCustomTag(ns: TagNamespace, raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!value) return value;
  const vocab = readTags();
  if (vocab[ns].includes(value)) return value;
  commitTags({ ...vocab, [ns]: [...vocab[ns], value] });
  return value;
}

// ---- Backup (export / import) ---------------------------------------------
// The v1 insurance policy: everything (records + photo dataUrls + custom tags)
// in one JSON file. Also the migration path to the v2 cloud store.

export interface BackupFile {
  app: "im-hungry";
  version: 1;
  exportedAt: string;
  places: Place[];
  tags: TagVocab;
}

export function exportData(): BackupFile {
  return {
    app: "im-hungry",
    version: 1,
    exportedAt: new Date().toISOString(),
    places: read(), // hydrated — photo dataUrls embedded in the file
    tags: readTags(),
  };
}

// Trigger the browser download of a backup file. Shared by the Backup menu
// and the quiet export shortcut tucked into the map's attribution disclosure.
// Returns the place count so the caller can toast it.
export function downloadBackup(): number {
  const data = exportData();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `im-hungry-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  return data.places.length;
}

// Replaces the current library. Throws with a readable message on bad input.
export function importData(text: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn’t valid JSON.");
  }
  const b = parsed as Partial<BackupFile>;
  if (!Array.isArray(b.places)) throw new Error("No places found in that file.");
  for (const p of b.places) {
    if (typeof p?.id !== "string" || typeof p?.name !== "string" || typeof p?.lat !== "number" || typeof p?.lng !== "number") {
      throw new Error("That file doesn’t look like an im hungry backup.");
    }
  }
  commit(b.places as Place[]);
  if (b.tags && typeof b.tags === "object") {
    commitTags({ ...EMPTY_VOCAB, ...(b.tags as Partial<TagVocab>) });
  }
  return b.places.length;
}

// ---- Duplicate guard ------------------------------------------------------

// Returns an existing place if the candidate looks like a dupe: same Google
// place id, or a close-by name match (name similarity alone is NOT enough —
// chains have many outlets, so a fuzzy hit also requires ~120m proximity, and
// a place with a DIFFERENT Google id is never a fuzzy match).
export function findDuplicate(
  candidate: {
    googlePlaceId?: string | null;
    name: string;
    lat: number;
    lng: number;
  },
  list: Place[] = read()
): Place | null {
  if (candidate.googlePlaceId) {
    const byId = list.find((p) => p.googlePlaceId === candidate.googlePlaceId);
    if (byId) return byId;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cn = norm(candidate.name);
  return (
    list.find((p) => {
      if (candidate.googlePlaceId && p.googlePlaceId && p.googlePlaceId !== candidate.googlePlaceId) {
        return false; // distinct Google places (e.g. two outlets of a chain)
      }
      const near =
        Math.abs(p.lat - candidate.lat) < 0.0011 &&
        Math.abs(p.lng - candidate.lng) < 0.0011; // ~120m
      if (!near) return false;
      return norm(p.name) === cn || norm(p.name).includes(cn.slice(0, 5));
    }) ?? null
  );
}
