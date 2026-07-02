"use client";

import type { GooglePlace } from "./google";
import { isAreaResult } from "./geo";
import { addPhoto } from "./store";
import { DEFAULT_VIEW } from "./seed";

// Thin client wrappers around the server route handlers. Keep the response
// types aligned with GooglePlace so the UI maps once.
export type { GooglePlace };

const CITY = { lat: DEFAULT_VIEW.latitude, lng: DEFAULT_VIEW.longitude };

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
// result, biased to the home city). null when the name isn't an area.
export async function geocodeArea(
  name: string
): Promise<{ name: string; lat: number; lng: number } | null> {
  const { results } = await searchPlaces(name, CITY);
  const hit = results.find((r) => isAreaResult(r.googleTypes));
  return hit ? { name: hit.name, lat: hit.lat, lng: hit.lng } : null;
}

// Real places around a coordinate (the "pin where I am" picker).
export async function nearbyPlaces(
  lat: number,
  lng: number
): Promise<{ results: GooglePlace[]; error?: string }> {
  try {
    const res = await fetch("/api/places/nearby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng }),
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
