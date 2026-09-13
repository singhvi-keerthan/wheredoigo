// Great-circle distance between two lat/lng points, in kilometres (haversine).
// Used by search's "around {area}" mode to rank saved places by proximity to a
// geocoded neighbourhood centroid.
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Swiggy quotes distance as prose — "5.4 km", "13.9 km away", "850 m", and on
// the details call as an address prefix ("13.6 km • A11, Block A"). The number
// is from the coordinates the search ran at, which is what the deck ranks on.
// Anything unreadable is null, never 0: "we don't know" must not score as
// "right here".
export function parseDistanceKm(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(km|m)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[2].toLowerCase() === "m" ? n / 1000 : n;
}

// Google place `types` that mean the result is a NEIGHBOURHOOD — so "jayanagar"
// switches into the ~2.5km radius view while "pizza" (a POI) does not. Kept to
// neighbourhood granularity ONLY: city/state/district levels (locality,
// administrative_area_*) would centre the radius on a huge region's centroid and
// wrongly return "nothing nearby", so a query like "bengaluru" stays text mode.
export const AREA_TYPES = new Set([
  "sublocality_level_1",
  "sublocality_level_2",
  "sublocality",
  "neighborhood",
]);

export function isAreaResult(types: string[] | undefined): boolean {
  return !!types?.some((t) => AREA_TYPES.has(t));
}
