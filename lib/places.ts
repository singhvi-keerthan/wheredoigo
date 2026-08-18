"use client";

import type { GooglePlace } from "./google";
import { isAreaResult } from "./geo";
import { addPhoto, updatePlace, getPlace } from "./store";
import { searchBias } from "./bias";

// Thin client wrappers around the server route handlers. Keep the response
// types aligned with GooglePlace so the UI maps once.
export type { GooglePlace };

export async function searchPlaces(
  query: string,
  center?: { lat: number; lng: number },
  signal?: AbortSignal
): Promise<{ results: GooglePlace[]; error?: string }> {
  try {
    const res = await fetch("/api/places/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, ...(center ?? {}) }),
      signal,
    });
    const data = await res.json();
    return { results: data.results ?? [], error: data.error };
  } catch {
    return { results: [], error: "fetch_failed" };
  }
}

export async function getPlaceDetails(
  placeId: string
): Promise<GooglePlace | null> {
  try {
    const res = await fetch(
      `/api/places/details?placeId=${encodeURIComponent(placeId)}`
    );
    const data = await res.json();
    return data.result ?? null;
  } catch {
    return null;
  }
}

// Geocode a neighbourhood name to a centroid (first area-typed text-search
// result, biased to where you are). null when the name isn't an area.
export async function geocodeArea(
  name: string
): Promise<{ name: string; lat: number; lng: number } | null> {
  const { results } = await searchPlaces(name, searchBias());
  const hit = results.find((r) => isAreaResult(r.googleTypes));
  return hit ? { name: hit.name, lat: hit.lat, lng: hit.lng } : null;
}

// Real places around a coordinate (the "pin where I am" picker). `accuracy`
// (meters, from the GPS fix) widens the search circle to match — a tight 120m
// radius against a poor fix (WiFi/cell-based, common on the first fix indoors
// or right after moving) reliably misses the real place and surfaces an
// unrelated neighbourhood instead.
export async function nearbyPlaces(
  lat: number,
  lng: number,
  accuracy?: number
): Promise<{ results: GooglePlace[]; error?: string }> {
  try {
    const res = await fetch("/api/places/nearby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, accuracy }),
    });
    const data = await res.json();
    return { results: data.results ?? [], error: data.error };
  } catch {
    return { results: [], error: "fetch_failed" };
  }
}

// Expand a shared Maps link (maps.app.goo.gl etc.) server-side into whatever it
// carries — a place name and/or coordinates.
export async function resolveMapsLink(
  url: string
): Promise<{ name: string | null; lat: number | null; lng: number | null; error?: string }> {
  try {
    const res = await fetch("/api/places/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return await res.json();
  } catch {
    return { name: null, lat: null, lng: null, error: "fetch_failed" };
  }
}

// Enrich-once from Google's fuller record (Place Details): refresh rating /
// price / hours / area, pull the editorial "lowdown", and attach a cover photo
// if you don't already have one. Google-derived fields are a cached reference —
// this never touches your own rating/notes/photos. Fire-and-forget; a miss just
// leaves the last-known values in place. Called on save and on a stale re-open.
export async function enrichPlaceFromGoogle(placeId: string, googlePlaceId: string) {
  const g = await getPlaceDetails(googlePlaceId);
  if (!g) return;
  updatePlace(placeId, {
    googleRating: g.googleRating,
    googlePriceLevel: g.googlePriceLevel,
    googleTypes: g.googleTypes,
    openingPeriods: g.openingPeriods,
    hoursText: g.hoursText,
    ...(g.area ? { area: g.area } : {}),
    ...(g.city ? { city: g.city } : {}),
    ...(g.summary ? { summary: g.summary } : {}),
    enrichedAt: new Date().toISOString(),
  });
  // Cover photo: only when Google returns one for this key AND you have no
  // Google photo yet (your own uploads always lead; this is the fallback).
  const p = getPlace(placeId);
  if (g.photoName && p && !p.photos.some((ph) => ph.source === "google")) {
    void attachGooglePhoto(placeId, g.photoName);
  }
}

// Pull the place's first Google photo once, at save time, and store it locally
// (source:"google"). Fire-and-forget — a miss just means no cover image.
export async function attachGooglePhoto(placeId: string, photoName: string | null) {
  if (!photoName) return;
  try {
    const res = await fetch(
      `/api/places/photo?name=${encodeURIComponent(photoName)}`
    );
    const data = await res.json();
    if (typeof data.dataUrl === "string" && data.dataUrl.startsWith("data:image/")) {
      addPhoto(placeId, { dataUrl: data.dataUrl, source: "google", scope: "place", visitId: null });
    }
  } catch {
    /* no photo — fine */
  }
}
