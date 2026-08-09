"use client";

import type { SwiggyRestaurant, SwiggySlot, SwiggyBooking, UserCoords } from "./swiggy";

export type { SwiggyRestaurant, SwiggySlot, SwiggyBooking, UserCoords };

// Swiggy tools all take the user's coordinates, and the same pair has to travel
// search → slots → book unchanged. Bengaluru's city centre is the fallback when
// the browser won't give up a position — the same default the map opens on.
export const FALLBACK_COORDS: UserCoords = { lat: 12.972, lng: 77.61 };

// The access token lasts 5 days and Swiggy has no refresh flow in v1.0, so
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
