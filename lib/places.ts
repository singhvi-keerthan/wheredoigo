"use client";

import type { GooglePlace } from "./google";

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
