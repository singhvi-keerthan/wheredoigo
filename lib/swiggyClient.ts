"use client";

import type { SwiggyRestaurant, SwiggySlot, SwiggyBooking, UserCoords } from "./swiggy";
import { ownerToken } from "./sync/client";

export type { SwiggyRestaurant, SwiggySlot, SwiggyBooking, UserCoords };

// Swiggy tools all take the user's coordinates, and the same pair has to travel
// search → slots → book unchanged. Bengaluru's city centre is the fallback when
// the browser won't give up a position.
// Swiggy Dineout is a restaurant-booking API scoped to a city, so unlike the
// rest of the app this one really does need a concrete fallback.
export const FALLBACK_COORDS: UserCoords = { lat: 12.972, lng: 77.61 };

// Directions for a Swiggy card — the sibling of format.ts's Place-based
// directionsUrl, which a not-yet-saved Swiggy row has no Place for.
// Live rows have no coordinates — Swiggy doesn't
// publish them — so the destination is the name and locality, which Google Maps
// resolves as happily as a coordinate pair. Falls back to real coordinates when
// there are any, which is the mock rows and any future Swiggy that ships them.
export function swiggyDirectionsUrl(r: SwiggyRestaurant): string {
  const destination =
    r.lat != null && r.lng != null
      ? `${r.lat},${r.lng}`
      : [r.name, r.area].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

// The access token lasts 5 days, and renewing it is a chore someone has to run
// (`npm run swiggy:refresh`) — nothing in the request path renews it — so
// "reconnect" is a normal state the UI has to be able to say out loud.
// `owner_only` is not a failure to retry — it is the honest answer that Swiggy
// runs on Keerthan's single consent and this device is not his. See
// lib/swiggy-gate.ts for why that is a contract position, not a policy choice.
// `swiggy_busy` is a 429: Swiggy, or the app's own per-minute meter, said stop.
// Also not a failure to retry — retrying is what makes it worse.
export type SwiggyError =
  | "swiggy_reauth"
  | "swiggy_unavailable"
  | "fetch_failed"
  | "owner_only"
  | "swiggy_busy";

// When Swiggy (or the server's own meter) said stop, it said for how long. Held
// here so the NEXT thing the deck does — a lens change, the details call for
// the top card — waits it out instead of being one more request during the
// back-off. Answered locally as `swiggy_busy`, with no fetch at all.
let busyUntil = 0;

export function swiggyBusyFor(): number {
  return Math.max(0, Math.ceil((busyUntil - Date.now()) / 1000));
}

async function post<T>(path: string, body: unknown): Promise<{ data: T | null; error?: SwiggyError }> {
  if (swiggyBusyFor() > 0) return { data: null, error: "swiggy_busy" };
  try {
    // The owner key proves which library is asking. The route compares it
    // against PUBLIC_OWNER_HASH server-side; an unconnected device sends
    // nothing and is refused, which is intended.
    const own = ownerToken();
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(own ? { Authorization: `Bearer ${own}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.status === 429) {
      const wait = Number(data?.retryAfter) || Number(res.headers.get("retry-after")) || 60;
      busyUntil = Math.max(busyUntil, Date.now() + wait * 1000);
      return { data, error: "swiggy_busy" };
    }
    if (data?.error) return { data, error: data.error as SwiggyError };
    return { data };
  } catch {
    return { data: null, error: "fetch_failed" };
  }
}

export async function searchDineout(query: {
  // Swiggy-shaped terms, one concept each — see lib/swiggyTerms.ts.
  terms: string[];
  // Evidence searches for a loosely tagged vibe — same file.
  facets?: string[];
  area?: string;
  areaLat?: number;
  areaLng?: number;
  lat?: number;
  lng?: number;
}): Promise<{
  results: SwiggyRestaurant[];
  error?: SwiggyError;
  // What Swiggy offered that nothing could be built from. Returned by the route
  // and thrown away here until now, which is why an empty deck could never tell
  // "Swiggy had nothing" apart from "we parsed none of what it sent".
  dropped: number;
  // The terms actually searched, so the deck can name them when it comes back
  // empty instead of blaming the user's filter.
  searched: string[];
  // The concept terms the server TRIED, failed ones included — what the deck
  // ranks coverage against.
  attempted: string[];
}> {
  const { data, error } = await post<{
    results?: SwiggyRestaurant[];
    dropped?: number;
    searched?: string[];
    attempted?: string[];
  }>("/api/swiggy/search", query);
  return {
    results: data?.results ?? [],
    error,
    dropped: data?.dropped ?? 0,
    searched: data?.searched ?? query.terms,
    attempted: data?.attempted ?? query.terms,
  };
}

export async function getSlots(
  restaurantId: string,
  opts: { lat?: number; lng?: number; date?: string; guestCount?: number } = {}
): Promise<{ results: SwiggySlot[]; error?: SwiggyError }> {
  const { data, error } = await post<{ results?: SwiggySlot[] }>("/api/swiggy/slots", {
    restaurantId,
    ...opts,
  });
  return { results: data?.results ?? [], error };
}

export async function getDineoutDetails(
  restaurant: SwiggyRestaurant,
  opts: { lat?: number; lng?: number } = {}
): Promise<{ restaurant: SwiggyRestaurant | null; error?: SwiggyError }> {
  const { data, error } = await post<{ restaurant?: SwiggyRestaurant }>("/api/swiggy/details", {
    restaurant,
    ...opts,
  });
  return { restaurant: data?.restaurant ?? null, error };
}

export async function bookTable(
  restaurantId: string,
  slot: SwiggySlot,
  guestCount: number,
  coords: UserCoords
): Promise<{ booking: SwiggyBooking | null; error?: SwiggyError }> {
  const { data, error } = await post<SwiggyBooking>("/api/swiggy/book", {
    restaurantId,
    slot: { slotId: slot.slotId, itemId: slot.itemId, reservationTime: slot.reservationTime },
    guestCount,
    lat: coords.lat,
    lng: coords.lng,
  });
  if (error) return { booking: null, error };
  return { booking: data };
}
