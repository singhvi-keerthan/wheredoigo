// Capture helpers. Full Google search/enrichment activates when a Places API
// key is added; until then capture = search existing + manual add + coords from
// a pasted Maps link/text (parsed locally, no API needed).

export function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

// Pull lat,lng out of pasted text or a Google Maps URL (@lat,lng / q=lat,lng /
// "lat,lng"). Short maps.app.goo.gl links can't be resolved without the API.
export function parseLocation(text: string): { lat: number; lng: number } | null {
  const at = text.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (at) return { lat: +at[1], lng: +at[2] };
  const q = text.match(/[?&](?:q|query|ll|center)=(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (q) return { lat: +q[1], lng: +q[2] };
  const bare = text.trim().match(/^(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)$/);
  if (bare) return { lat: +bare[1], lng: +bare[2] };
  return null;
}
