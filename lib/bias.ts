"use client";

// Where to bias a Google Places search, for an app whose pins are no longer all
// in one city.
//
// Cheapest honest answer first:
//   1. the live GPS fix, if the browser has already given one up
//   2. the map's current centre — where you are actually looking
//   3. nothing at all, and let Google rank on the query alone
//
// Never a fixed city centre (the old behaviour: a 30km circle around Bengaluru,
// which pushed Jaipur results down), and deliberately never the centroid of
// your saved places — with pins in Bengaluru and Jaipur that midpoint lands in
// rural Maharashtra, and /api/places/search wraps whatever it is handed in a
// 30km circle. A bad bias is worse than none.

export type Coords = { lat: number; lng: number };

let lastFix: Coords | null = null;
let lastCenter: Coords | null = null;

// Fed by MapView's existing watchPosition — no extra permission prompt.
export function noteGpsFix(c: Coords | null) {
  lastFix = c;
}

export function noteMapCenter(c: Coords) {
  lastCenter = c;
}

// `undefined` is a valid answer and means "send no locationBias".
export function searchBias(): Coords | undefined {
  return lastFix ?? lastCenter ?? undefined;
}
