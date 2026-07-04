"use client";

import type { SwiggyRestaurant, SwiggySlot } from "./swiggy";

export type { SwiggyRestaurant, SwiggySlot };

export async function searchDineout(query: {
  cuisine?: string;
  keyword?: string;
}): Promise<{ results: SwiggyRestaurant[]; error?: string }> {
  try {
    const res = await fetch("/api/swiggy/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    const data = await res.json();
    return { results: data.results ?? [], error: data.error };
  } catch {
    return { results: [], error: "fetch_failed" };
  }
}

export async function getSlots(restaurantId: string): Promise<{ results: SwiggySlot[]; error?: string }> {
  try {
    const res = await fetch("/api/swiggy/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId }),
    });
    const data = await res.json();
    return { results: data.results ?? [], error: data.error };
  } catch {
    return { results: [], error: "fetch_failed" };
  }
}

export async function bookTable(
  restaurantId: string,
  slotId: string,
  partySize: number
): Promise<{ bookingId: string; confirmed: boolean } | null> {
  try {
    const res = await fetch("/api/swiggy/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, slotId, partySize }),
    });
    const data = await res.json();
    return data.error ? null : data;
  } catch {
    return null;
  }
}
