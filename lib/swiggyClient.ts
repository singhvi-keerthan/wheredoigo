"use client";

import type { SwiggyRestaurant, SwiggySlot, SwiggyBooking, UserCoords } from "./swiggy";

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
export type SwiggyError = "swiggy_reauth" | "swiggy_unavailable" | "fetch_failed";

async function post<T>(path: string, body: unknown): Promise<{ data: T | null; error?: SwiggyError }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data?.error) return { data, error: data.error as SwiggyError };
    return { data };
  } catch {
    return { data: null, error: "fetch_failed" };
  }
}

export async function searchDineout(query: {
  cuisine?: string;
  keyword?: string;
  lat?: number;
  lng?: number;
}): Promise<{ results: SwiggyRestaurant[]; error?: SwiggyError }> {
  const { data, error } = await post<{ results?: SwiggyRestaurant[] }>("/api/swiggy/search", query);
  return { results: data?.results ?? [], error };
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
