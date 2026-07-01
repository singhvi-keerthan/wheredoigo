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
