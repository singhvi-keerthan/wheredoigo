"use client";

import { useSyncExternalStore } from "react";
import type { Photo, Place, PlaceStatus, Tag, TagNamespace, Visit } from "./types";
import { SEED_PLACES } from "./seed";

// ---------------------------------------------------------------------------
// Local-first store. Source of truth is localStorage; this module keeps an
// in-memory mirror and notifies React via useSyncExternalStore. v2 swaps the
// persistence layer for Supabase without changing the call sites.
// ---------------------------------------------------------------------------

const KEY = "nightfall.places.v1";

let cache: Place[] | null = null;
const listeners = new Set<() => void>();
// Stable reference for the server/initial snapshot (must not be re-created per call).
const EMPTY: Place[] = [];

function read(): Place[] {
  if (cache) return cache;
  if (typeof window === "undefined") return (cache = []);
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      cache = JSON.parse(raw) as Place[];
    } else {
      cache = SEED_PLACES;
      window.localStorage.setItem(KEY, JSON.stringify(cache));
    }
  } catch {
    cache = SEED_PLACES;
  }
  return cache;
}

function commit(next: Place[]) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    // localStorage quota (photos are the usual culprit). Surface, don't crash.
    console.warn("Nightfall: could not persist — storage may be full.", e);
  }
  listeners.forEach((l) => l());
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

export function setStatus(id: string, status: PlaceStatus) {
  updatePlace(id, { status });
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
export function addVisit(id: string, visit: Omit<Visit, "id" | "createdAt">) {
  const p = read().find((x) => x.id === id);
  if (!p) return;
  const v: Visit = { ...visit, id: uid(), createdAt: new Date().toISOString() };
  updatePlace(id, {
    status: "visited",
    visits: [v, ...p.visits],
    // first rating becomes your rating if none set yet
    myRating: p.myRating ?? visit.rating ?? p.myRating,
  });
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
const TAG_KEY = "nightfall.tags.v1";
const EMPTY_VOCAB: TagVocab = { type: [], cuisine: [], occasion: [], vibe: [], practical: [] };

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
    console.warn("Nightfall: could not persist tags.", e);
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

// ---- Duplicate guard ------------------------------------------------------

// Returns an existing place if the candidate looks like a dupe (same google id,
// or close name + within ~120m). Used by capture before creating a new pin.
export function findDuplicate(candidate: {
  googlePlaceId?: string | null;
  name: string;
  lat: number;
  lng: number;
}): Place | null {
  const places = read();
  if (candidate.googlePlaceId) {
    const byId = places.find((p) => p.googlePlaceId === candidate.googlePlaceId);
    if (byId) return byId;
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cn = norm(candidate.name);
  return (
    places.find((p) => {
      const sameName = norm(p.name) === cn;
      const near =
        Math.abs(p.lat - candidate.lat) < 0.0011 &&
        Math.abs(p.lng - candidate.lng) < 0.0011; // ~120m
      return sameName || (near && norm(p.name).includes(cn.slice(0, 5)));
    }) ?? null
  );
}

export function resetToSeed() {
  commit(SEED_PLACES);
}
