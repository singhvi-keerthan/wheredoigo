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

// A map centre is only "where you are looking" when the view is tight enough to
// be about ONE place. Fitting the map to a library spread across cities lands
// the centre on their midpoint — Bengaluru + Jaipur fits at ~zoom 5 and centres
// on 18.6N 76.7E, open country in Maharashtra. That is the very centroid this
// module refuses to compute, arriving through the back door, so the zoom gate is
// what actually enforces the rule above.
//
// 10 is comfortably tighter than any multi-city fit and looser than the app's
// own city view (DEFAULT_VIEW is 12.2, and pins stop being dots at 12). A view
// wider than this records nothing rather than overwriting a good centre: the
// last place you actually looked at beats a continent, and no bias at all beats
// a wrong one.
const MIN_BIAS_ZOOM = 10;

export function noteMapCenter(c: Coords, zoom: number) {
  if (zoom < MIN_BIAS_ZOOM) return;
  lastCenter = c;
}

// `undefined` is a valid answer and means "send no locationBias".
export function searchBias(): Coords | undefined {
  return lastFix ?? lastCenter ?? undefined;
}

// Safari does not implement navigator.permissions.query() for geolocation — it
// rejects — so the permission gate in MapView can never learn that location is
// already allowed, and an iPhone (this app's main device) would get no GPS at
// all. We still refuse to prompt on startup, so the only honest signal left is
// memory: the user granted us a position once, through an explicit action they
// asked for. That fact is worth persisting, and it is not sensitive — it
// records THAT permission exists, never where anyone was.
const GRANT_KEY = "wheredoigokeerthan.geoGranted.v1";

// Remembering the grant is only half of it: MapView reads that memory once, at
// mount, so without a nudge the very session that granted location would still
// show no "you are here" until a reload — the fix would only ever work the
// second time you opened the app.
const GRANT_EVENT = "wheredoigokeerthan:geo-granted";

export function noteGeoGranted() {
  try {
    localStorage.setItem(GRANT_KEY, "1");
  } catch {
    /* private mode — we just fall back to no passive GPS */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(GRANT_EVENT));
}

// Returns its own unsubscribe, so a caller can wire this straight into an effect.
export function onGeoGranted(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(GRANT_EVENT, fn);
  return () => window.removeEventListener(GRANT_EVENT, fn);
}

export function geoEverGranted(): boolean {
  try {
    return localStorage.getItem(GRANT_KEY) === "1";
  } catch {
    return false;
  }
}

// ---- location status, shared -----------------------------------------------
//
// MapView owns the geolocation watch, but it is not the only thing that needs to
// know how that watch is doing. Without location the map cannot open where you
// are, "Pin where I am" cannot work, and Swiggy has no coordinates to search
// from — so the app has to be able to SAY that, out loud, instead of quietly
// rendering a map of nowhere in particular. This is the one place that fact
// lives, so the map and the prompt can never disagree about it.
//
//   locating    — the watch is running and has not produced a fix yet
//   granted     — we have a position
//   denied      — the person said no, or said no once in the past. The browser
//                 will not ask again; only Settings can undo it.
//   unavailable — no geolocation API, or the fix failed/timed out. Retryable.
export type GeoStatus = "locating" | "granted" | "denied" | "unavailable";

let geoStatus: GeoStatus = "locating";
const geoListeners = new Set<() => void>();

export function noteGeoStatus(s: GeoStatus) {
  if (s === geoStatus) return;
  geoStatus = s;
  geoListeners.forEach((l) => l());
}

export function getGeoStatus(): GeoStatus {
  return geoStatus;
}

export function subscribeGeoStatus(cb: () => void): () => void {
  geoListeners.add(cb);
  return () => geoListeners.delete(cb);
}

// Ask again, from a user gesture.
//
// Worth being precise about what this can and cannot do: where the state is
// still "prompt", this is what makes the browser show its dialog, and it works.
// Where the person has already refused, NOTHING in a page can re-open that
// dialog — the only route back is the browser's own settings, which is why the
// nudge explains that case instead of offering a button that would do nothing.
export function requestLocation(): void {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    noteGeoStatus("unavailable");
    return;
  }
  noteGeoStatus("locating");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      noteGpsFix({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      noteGeoStatus("granted");
      // Tells MapView's watch to start now rather than on the next reload.
      noteGeoGranted();
    },
    (err) => {
      noteGeoStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
    },
    { enableHighAccuracy: true, timeout: 20_000 }
  );
}
