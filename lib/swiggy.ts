// Server-only Swiggy Dineout integration. Two features ride on this: the swipe
// deck's "New" source (search) and NewCardDetail's book-a-table (slots + book).
//
// Real access is OAuth 2.1 + PKCE against mcp.swiggy.com/dineout via Builders
// Club. When SWIGGY_MCP_TOKEN is set every function below calls the real MCP
// tool; when it isn't, they return the same mock data they always did, so the
// app stays fully usable in dev and nothing regresses while the token is stale.
//
// Shapes here follow the published tool reference:
//   search_restaurants_dineout(query, entityType?, latitude, longitude)
//   render_restaurants_dineout(searches[{query,latitude,longitude,entityType?}], restaurantIds)
//   get_restaurant_details(restaurantId, latitude, longitude)
//   get_available_slots(restaurantId, date, latitude, longitude, guestCount?)
//   book_table(restaurantId, slotId, itemId, reservationTime, guestCount, lat, lng)
//
// IMPORTANT distinction the docs are firm about: the latitude/longitude passed
// to every tool is the *user's* location, not the restaurant's — it's echoed
// through search → details → slots → book unchanged. And the restaurant's own
// coordinates are NOT in any response: every field path of search, render and
// details was enumerated against the live server and the only lat/lng present
// is that same user echo, at the root. The map pin is bought from Google at
// save time instead — see fixSwiggyPosition in components/SwipeMode.tsx.

import {
  callSwiggyReply,
  callSwiggyTool,
  swiggyLive,
  SwiggyAuthError,
  SwiggyRateLimitError,
} from "./swiggyMcp";
import { areaMatches } from "./decide";

export { SwiggyAuthError, SwiggyRateLimitError, swiggyLive } from "./swiggyMcp";

export interface SwiggyRestaurant {
  id: string;
  name: string;
  cuisines: string[];
  area: string;
  address: string;
  // Swiggy Dineout does not publish restaurant coordinates — verified against
  // every field of search / render / details: the only lat/lng in a response is
  // the USER's, echoed back. So a live Swiggy card has no position, and one is
  // looked up from Google at save time (SwipeMode.saveNew). Mock rows keep real
  // coordinates so the no-token path still exercises the map shape.
  lat: number | null;
  lng: number | null;
  rating: number | null;
  priceForTwo: number | null;
  photo: string | null; // absolute URL, resolved from Swiggy's bare image id
  photos?: string[]; // gallery URLs, first one mirrors photo when present
  description?: string | null;
  highlights?: string[];
  offers?: string[];
  distance?: string | null;
  // The search terms whose own results included this row — provenance kept
  // through the fan-out merge, so the deck can tell a row both "Rooftop" and
  // "North Indian" returned from one only one of them did, and a row a concept
  // term returned from one the locality top-up swept in. Absent on a row no
  // search listed (a render-only record).
  matchedTerms?: string[];
}

// A bookable slot. book_table needs slotId + itemId + reservationTime together,
// so the card can't just carry a display label like the mock used to.
export interface SwiggySlot {
  slotId: number;
  itemId: string;
  reservationTime: number; // unix seconds, straight from the slot
  displayTime: string; // "7:30 PM"
  groupName: string | null; // slotGroupName — breakfast / lunch / dinner
}

export interface SwiggyBooking {
  orderId: string | null;
  status: string; // "CONFIRMED" | "PENDING_PAYMENT" | …
  confirmed: boolean;
  restaurantName: string | null;
  guestCount: number | null;
  upiIntentUrl: string | null; // only on paid UPI deals — see bookTable
}

export interface UserCoords {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ *
 * Coercion helpers
 *
 * The reference documents which fields exist but not a full example
 * payload, so every read below is tolerant about spelling and type
 * (number vs "₹1,800", string[] vs "North Indian, Chinese"). Anything
 * genuinely missing stays null rather than being invented.
 * ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function pick(o: Rec, ...keys: string[]): unknown {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStr(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  return null;
}

// "₹1,800 for two" → 1800
function asMoney(v: unknown): number | null {
  const n = asNum(v);
  if (n != null) return n;
  if (typeof v === "string") {
    const digits = v.replace(/[^\d]/g, "");
    return digits ? Number(digits) : null;
  }
  return null;
}

// Ratings arrive as 4.4, "4.4", or { value: 4.4, count: 1203 }.
function asRating(v: unknown): number | null {
  if (isRec(v)) return asNum(pick(v, "value", "rating", "aggregate_rating"));
  return asNum(v);
}

// Normalised to the app's own cuisine tag vocabulary ("north-indian"), so a
// swipe-saved Swiggy find filters identically to a hand-tagged place.
function asCuisines(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out = raw
    .map((c) => String(c).trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
  return [...new Set(out)];
}

// Swiggy serves media off a Cloudinary-backed CDN and its payloads carry a bare
// image id far more often than a full URL — verified against live swiggy.com,
// which renders them as
//   media-assets.swiggy.com/swiggy/image/upload/<transforms>/<id>
// The reference page never documents an image field at all, so this reads every
// plausible spelling and passes an already-absolute URL straight through.
const MEDIA_BASE =
  process.env.SWIGGY_MEDIA_BASE ?? "https://media-assets.swiggy.com/swiggy/image/upload";
const MEDIA_TRANSFORMS = "fl_lossy,f_auto,q_auto,w_800";
// Two gates on how much of Swiggy's quota one lens change may spend. The
// agreement names rate limits, request quotas, payload sizes and concurrency
// (Cl. 4(viii)) but numbers none of them, and a Cl. 4 breach is an immediate-
// termination trigger — so the default is ONE search per lens change, the call
// count this app has always shipped. Both flags stay off until Swiggy answers
// with figures in writing.
//   SWIGGY_WIDE_SEARCH       — a search per concept term, in parallel, plus the
//                              locality top-up. Up to 5x the calls (and the
//                              concurrency is itself one of the named limits).
//   SWIGGY_EXTRA_SEARCH_PAGE — a second page of the first search. One more call.
const WIDE_SEARCH = process.env.SWIGGY_WIDE_SEARCH === "1";
const EXTRA_SEARCH_PAGE = process.env.SWIGGY_EXTRA_SEARCH_PAGE === "1";

function imageUrl(v: unknown): string | null {
  const raw = asStr(v);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  return `${MEDIA_BASE}/${MEDIA_TRANSFORMS}/${raw.replace(/^\/+/, "")}`;
}

const IMAGE_KEYS = [
  "cloudinaryImageId",
  "imageId",
  "image_id",
  "imageUrl",
  "image",
  "photo",
  "thumbnail",
  "banner",
  "bannerImage",
  "headerImage",
  "coverImage",
  "media",
];

const GALLERY_KEYS = ["images", "photos", "gallery", "mediaFiles", "imageGallery"];

function uniq(values: string[], limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const clean = v.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

function photosOf(o: Rec): string[] {
  const urls: string[] = [];
  for (const key of IMAGE_KEYS) {
    const v = o[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isRec(item)) urls.push(...photosOf(item));
        else {
          const url = imageUrl(item);
          if (url) urls.push(url);
        }
      }
      continue;
    }
    if (isRec(v)) urls.push(...photosOf(v));
    else {
      const url = imageUrl(v);
      if (url) urls.push(url);
    }
  }

  // Some payloads nest the media, or hand back a gallery array.
  for (const key of GALLERY_KEYS) {
    const v = o[key];
    if (Array.isArray(v) && v.length > 0) {
      for (const item of v) {
        if (isRec(item)) urls.push(...photosOf(item));
        else {
          const url = imageUrl(item);
          if (url) urls.push(url);
        }
      }
    } else if (isRec(v)) {
      urls.push(...photosOf(v));
    }
  }
  return uniq(urls);
}

function cleanText(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  return s.replace(/\s+/g, " ").trim() || null;
}

function textList(v: unknown, limit = 6): string[] {
  const out: string[] = [];
  const read = (item: unknown) => {
    if (out.length >= limit) return;
    if (typeof item === "string" || typeof item === "number") {
      const text = cleanText(item);
      if (text && text.length <= 140) out.push(text);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) read(child);
      return;
    }
    if (!isRec(item)) return;
    const text = cleanText(
      pick(
        item,
        "label",
        "title",
        "name",
        "text",
        "displayText",
        "offerText",
        "discountText",
        "description",
        "subtitle"
      )
    );
    if (text && text.length <= 140) out.push(text);
  };
  read(v);
  return uniq(out, limit);
}

function descriptionOf(o: Rec): string | null {
  for (const key of ["description", "restaurantDescription", "about", "summary", "tagline", "subtitle"]) {
    const text = cleanText(o[key]);
    if (text && text.length > 12) return text;
  }
  return null;
}

function textListOf(o: Rec, keys: string[], limit = 6): string[] {
  const out: string[] = [];
  for (const key of keys) {
    out.push(...textList(o[key], limit));
    if (out.length >= limit) break;
  }
  return uniq(out, limit);
}

function restaurantRecord(data: unknown): Rec {
  if (!isRec(data)) return {};
  for (const key of ["restaurant", "restaurantInfo", "restaurantDetails", "details", "item"]) {
    const v = data[key];
    if (isRec(v)) return v;
  }
  const list = listOf(data);
  if (list.length > 0) return list[0];
  return data;
}

export function mergeRestaurantDetails(base: SwiggyRestaurant, detail: unknown): SwiggyRestaurant {
  const d = restaurantRecord(payload(detail));
  const parsed = toRestaurant({ ...d, id: pick(d, "id", "restaurantId", "resId", "restaurant_id") ?? base.id, name: pick(d, "name", "restaurantName", "restaurant_name") ?? base.name });
  const photos = uniq([
    ...(parsed?.photos ?? []),
    ...(parsed?.photo ? [parsed.photo] : []),
    ...(base.photos ?? []),
    ...(base.photo ? [base.photo] : []),
  ]);
  return {
    ...base,
    ...(parsed ?? {}),
    id: base.id,
    // Coordinates come from `base` and ONLY from base. get_restaurant_details
    // TAKES latitude/longitude as input ("use same as search" — the user's
    // position), so anything coordinate-shaped in its answer is an echo of
    // where the phone is, not where the restaurant is. Swiggy publishes no
    // restaurant coordinates at all (see SwiggyRestaurant), which is why
    // saveNew treats non-null lat/lng as "exact, no lookup needed": it stores
    // the pin as-is, clears `approxLocation`, and skips fixSwiggyPosition. Let
    // the echo through and a card enriched before the swipe is saved at YOUR
    // location, marked confidently correct, with nothing left to fix it.
    lat: base.lat,
    lng: base.lng,
    name: parsed?.name ?? base.name,
    cuisines: (parsed?.cuisines.length ? parsed.cuisines : base.cuisines) ?? [],
    area: parsed?.area || base.area,
    address: parsed?.address || base.address,
    rating: parsed?.rating ?? base.rating,
    priceForTwo: parsed?.priceForTwo ?? base.priceForTwo,
    photo: photos[0] ?? parsed?.photo ?? base.photo,
    photos,
    description: parsed?.description ?? base.description ?? descriptionOf(d),
    highlights: uniq([...(parsed?.highlights ?? []), ...(base.highlights ?? [])], 6),
    offers: uniq([...(parsed?.offers ?? []), ...(base.offers ?? [])], 6),
    distance: parsed?.distance ?? base.distance ?? cleanText(pick(d, "distance", "distanceString", "distanceText")),
  };
}

function withDetails(o: Rec, base: Omit<SwiggyRestaurant, "photo">): SwiggyRestaurant {
  const photos = photosOf(o);
  return {
    ...base,
    photo: photos[0] ?? null,
    photos,
    description: descriptionOf(o),
    highlights: textListOf(o, ["highlights", "facilities", "amenities", "features", "badges", "labels"], 6),
    offers: textListOf(o, ["offers", "coupons", "deals", "discounts", "dineoutOffers"], 6),
    distance: cleanText(pick(o, "distance", "distanceString", "distanceText")),
  };
}

function mockPhotos(i: number): string[] {
  const photos: string[] = [];
  for (let n = 0; n < 3; n += 1) {
    const url = mockPhoto((i + n) % MOCK_IMAGE_IDS.length);
    if (url) photos.push(url);
  }
  return photos;
}

function enrichMock(r: SwiggyRestaurant, i = 0): SwiggyRestaurant {
  return {
    ...r,
    photos: r.photos?.length ? r.photos : mockPhotos(i),
    photo: r.photo ?? mockPhotos(i)[0] ?? null,
    description: r.description ?? `${r.name} is a Swiggy Dineout option around ${r.area || "Bengaluru"}.`,
    highlights: r.highlights?.length ? r.highlights : ["Table booking", "Dineout listing"],
    offers: r.offers?.length ? r.offers : ["Dineout offers may apply"],
    distance: r.distance ?? null,
  };
}

export async function getDineoutRestaurantDetails(
  base: SwiggyRestaurant,
  opts: { lat?: number; lng?: number } = {}
): Promise<SwiggyRestaurant> {
  if (!swiggyLive()) {
    const idx = MOCK_RESTAURANTS.findIndex((r) => r.id === base.id);
    return enrichMock(base, Math.max(0, idx));
  }

  const data = await callSwiggyTool<Rec>("get_restaurant_details", {
    restaurantId: base.id,
    latitude: opts.lat ?? 12.972,
    longitude: opts.lng ?? 77.61,
  });
  return mergeRestaurantDetails(base, data);
}

// The restaurant's own position, wherever it happens to live in the payload.
function coordsOf(o: Rec): { lat: number; lng: number } | null {
  const direct = {
    lat: asNum(pick(o, "latitude", "lat")),
    lng: asNum(pick(o, "longitude", "lng", "long", "lon")),
  };
  if (direct.lat != null && direct.lng != null) return { lat: direct.lat, lng: direct.lng };

  for (const key of ["coordinates", "coords", "geo", "location", "address"]) {
    const nested = o[key];
    if (isRec(nested)) {
      const found = coordsOf(nested);
      if (found) return found;
    }
  }
  return null;
}

// Swiggy wraps tool payloads as { success, data, message } — except
// get_available_slots, which the docs call out as root-level.
function payload(res: unknown): unknown {
  if (!isRec(res)) return res;
  if (res.success === false) {
    const err = res.error;
    const message = isRec(err) ? asStr(err.message) : asStr(err);
    throw new Error(message || "swiggy_error");
  }
  return res.data !== undefined ? res.data : res;
}

// Restaurants can be returned bare, or under any of the usual collection keys.
function listOf(data: unknown): Rec[] {
  if (Array.isArray(data)) return data.filter(isRec);
  if (!isRec(data)) return [];
  for (const key of ["restaurants", "results", "cards", "items", "list"]) {
    const v = data[key];
    if (Array.isArray(v)) return v.filter(isRec);
  }
  return [];
}

// YYYY-MM-DD in IST. Vercel runs UTC, so a plain toISOString() would hand
// Swiggy yesterday's date for every booking made after 5:30am IST.
export function todayInIndia(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/* ------------------------------------------------------------------ *
 * Mock data — used whenever SWIGGY_MCP_TOKEN is absent
 * ------------------------------------------------------------------ */

// Stand-in photos: real Dineout image ids, passed through the same imageUrl()
// resolver the live path uses. Generic stock photos made the mock deck look
// wrong (dark landscapes on a restaurant card), and using genuine ids means the
// no-token path exercises the exact production URL shape instead of faking it.
// If an id ever rots, the card's onError falls back to the initial.
const MOCK_IMAGE_IDS = [
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/10/24/0be497f5-fd05-4e3e-9d9e-d235ce7a376a_image1ff14cf89047641bfaba68e6d84ccbadd.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/10/24/943359f5-ca18-4059-b8c5-d96d54017f57_image1049f8418eef2041bca93baa13b2f38cbe.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/10/24/9901c486-29fe-46a2-976d-4f5dc618eae9_image8acca01d5881c481a9548ebd1818df12d.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/10/24/c62bce32-a7b8-46d8-800b-7ee59ba84114_image2be7594d5b34446ac9171f7bbbf270eeb.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/11/11/0c5b4b3a-6b0b-45da-8ecd-cca99ab1a18a_image5bc49e59b8460406cbc1e6a30ac427d51.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/11/11/29865eee-126b-4ec6-a48e-c8c76207ae67_image39c4f3abb54ef4f61ac4ca9a5765d49b5.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/11/11/7b707545-6bd4-4e94-8582-5c3a5184df79_image18490f285733e444a093174c8856584d94.JPG",
  "DINEOUT_ALL_RESTAURANTS/IMAGES/RESTAURANT_IMAGE_SERVICE/2025/11/11/a838fae3-2953-4d61-9360-041548239a16_image1751c1948b0c0e494fa7f4241f0e18c0ae.JPG",
];

const mockPhoto = (i: number) => imageUrl(MOCK_IMAGE_IDS[i]);

const MOCK_RESTAURANTS: SwiggyRestaurant[] = [
  { id: "sw-1", name: "Copper & Char", cuisines: ["north-indian", "mughlai"], area: "Indiranagar", address: "100 Feet Road, Indiranagar, Bengaluru", lat: 12.9719, lng: 77.6412, rating: 4.4, priceForTwo: 1800, photo: mockPhoto(0) },
  { id: "sw-2", name: "Coastal Curry House", cuisines: ["south-indian"], area: "Koramangala", address: "5th Block, Koramangala, Bengaluru", lat: 12.9352, lng: 77.6146, rating: 4.2, priceForTwo: 1200, photo: mockPhoto(1) },
  { id: "sw-3", name: "Nonna's Table", cuisines: ["italian"], area: "Indiranagar", address: "12th Main, Indiranagar, Bengaluru", lat: 12.978, lng: 77.6389, rating: 4.5, priceForTwo: 2200, photo: mockPhoto(2) },
  { id: "sw-4", name: "Szechuan Street", cuisines: ["chinese"], area: "HSR Layout", address: "27th Main, HSR Layout, Bengaluru", lat: 12.9121, lng: 77.6446, rating: 4.0, priceForTwo: 1400, photo: mockPhoto(3) },
  { id: "sw-5", name: "The Bengaluru Brewery", cuisines: ["continental"], area: "Church Street", address: "Church Street, Bengaluru", lat: 12.9757, lng: 77.6068, rating: 4.3, priceForTwo: 2000, photo: mockPhoto(4) },
  { id: "sw-6", name: "Bangkok Lane", cuisines: ["thai"], area: "Jayanagar", address: "4th Block, Jayanagar, Bengaluru", lat: 12.9254, lng: 77.5836, rating: 4.1, priceForTwo: 1600, photo: mockPhoto(5) },
  { id: "sw-7", name: "Seoul Kitchen", cuisines: ["korean"], area: "Koramangala", address: "6th Block, Koramangala, Bengaluru", lat: 12.9345, lng: 77.6224, rating: 4.3, priceForTwo: 1900, photo: mockPhoto(6) },
  { id: "sw-8", name: "Casa Mexicana", cuisines: ["mexican"], area: "Whitefield", address: "ITPL Main Road, Whitefield, Bengaluru", lat: 12.9698, lng: 77.7499, rating: 4.0, priceForTwo: 1500, photo: mockPhoto(7) },
];

// Mirrors the live shape: the area gates, then an OR across the concept terms —
// which is what merging several one-term searches amounts to. Keyed on `terms`
// because `cuisine`/`keyword` no longer exist; while it still read those, dev
// mode silently ignored the whole lens and reported terms it never applied.
function mockSearch(query: { terms?: string[]; area?: string }): {
  results: SwiggyRestaurant[];
  used: string[];
  attempted: string[];
} {
  let results = MOCK_RESTAURANTS;
  if (query.area) {
    results = results.filter((r) => areaMatches(r.area, query.area!));
  }
  const terms = (query.terms ?? []).filter(
    (t) => t && t.toLowerCase() !== DEFAULT_SEARCH_TERM.toLowerCase()
  );
  const used: string[] = [];
  if (terms.length) {
    const hit = (r: SwiggyRestaurant, t: string) => {
      const kw = t.toLowerCase();
      return (
        r.name.toLowerCase().includes(kw) ||
        r.cuisines.some((c) => c.includes(kw)) ||
        r.area.toLowerCase().includes(kw)
      );
    };
    const narrowed = results.filter((r) => terms.some((t) => hit(r, t)));
    // A term the mock catalogue can't answer leaves the pool alone rather than
    // emptying it — eight fixtures cannot cover the real vocabulary.
    if (narrowed.length) {
      // The live path's provenance, in the same shape: the terms this row hit.
      results = narrowed.map((r) => ({ ...r, matchedTerms: terms.filter((t) => hit(r, t)) }));
      used.push(...terms);
    }
  }
  return { results, used, attempted: terms };
}

// Mock slots mirror the real shape (ids + reservationTime), not just a label,
// so the booking path exercises the same code with or without a token.
function mockSlots(restaurantId: string): SwiggySlot[] {
  const base = Math.floor(Date.parse(`${todayInIndia()}T19:00:00+05:30`) / 1000);
  return ["7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM"].map((displayTime, i) => ({
    slotId: 9000 + i,
    itemId: `${restaurantId}-mock${i}`,
    reservationTime: base + i * 1800,
    displayTime,
    groupName: "Dinner",
  }));
}

/* ------------------------------------------------------------------ *
 * Tool bindings
 * ------------------------------------------------------------------ */

function toRestaurant(o: Rec): SwiggyRestaurant | null {
  const id = asStr(pick(o, "id", "restaurantId", "resId", "restaurant_id"));
  const name = asStr(pick(o, "name", "restaurantName", "restaurant_name"));
  // An id and a name are the whole floor: without them the card can't be shown
  // or booked. Coordinates used to be required too, back when they were assumed
  // to be in the payload — they never are, so requiring them dropped every row.
  if (!id || !name) return null;
  // Kept anyway: costs nothing, and the day Swiggy starts sending real
  // restaurant coordinates the save-time Google lookup stops being needed.
  const coords = coordsOf(o);

  const area = asStr(pick(o, "locality", "area", "subLocality", "neighbourhood")) ?? "";
  // get_restaurant_details prefixes the address with the distance FROM THE USER
  // ("13.6 km • A11, Block A, Kr Road…") — it changes depending on where you
  // ask from, so it isn't part of the address and must not be stored as one.
  const address = asStr(pick(o, "address", "fullAddress", "addressLine"))?.replace(
    /^\s*[\d.]+\s*(?:km|m)\s*[•·]\s*/i,
    ""
  );
  return withDetails(o, {
    id,
    name,
    cuisines: asCuisines(pick(o, "cuisines", "cuisine", "cuisineList")),
    area,
    address: address || area,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    // Swiggy sends `{ value: "0", count: 0 }` for a restaurant nobody has rated,
    // not a null. Left as 0 it renders as "0★", which reads as a terrible
    // restaurant rather than an unrated one — and the rating filter drops both
    // alike, so nothing is lost by normalising it here.
    rating: asRating(pick(o, "rating", "avgRating", "ratingValue")) || null,
    priceForTwo: asMoney(pick(o, "costForTwo", "priceForTwo", "costForTwoString", "cft")),
  });
}

// One row of search_restaurants_dineout's prose list, e.g.
//   8. Divina - Eden Park Restaurants —  | 4.0★ |  | Jayanagar (ID: 200005)
// The columns between the dash and the id are pipe-separated and any of them
// may be blank, so this reads them positionally-tolerantly rather than assuming
// a fixed arity. The name is GREEDY on purpose: "Toit — Brewpub — | 4.5★ | …"
// is a real shape, and a lazy match would silently truncate it to "Toit" — a
// wrong name then flows into dedupe, Directions and the Google lookup.
const SEARCH_ROW = /^\s*\d+\.\s+(.*)\s+—\s*([^—]*?)\s*\(ID:\s*(\d+)\)\s*$/;

export type SearchRow = { id: string; name: string; rating: number | null; area: string };

export function parseSearchRows(text: string): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const line of text.split("\n")) {
    const m = SEARCH_ROW.exec(line);
    if (!m) continue;
    const cols = m[2].split("|").map((c) => c.trim());
    const star = cols.find((c) => c.endsWith("★"));
    rows.push({
      id: m[3],
      name: m[1].trim(),
      rating: star ? asNum(star.replace("★", "")) : null,
      // The locality is the last column — but only the last NON-RATING one. A
      // row that omits the locality would otherwise hand "4.1★" straight to the
      // area filter, the dedupe check and the saved Place.area.
      area: [...cols].reverse().find((c) => c !== "" && !c.endsWith("★")) ?? "",
    });
  }
  return rows;
}

// A card built from the prose row alone. Fewer fields — no photo, no cost, no
// cuisines — but a name, an area and a rating is still something the user can
// act on, which beats an empty deck when the second call is what failed.
function fromSearchRow(row: SearchRow): SwiggyRestaurant {
  return {
    id: row.id,
    name: row.name,
    cuisines: [],
    area: row.area,
    address: row.area,
    lat: null,
    lng: null,
    // Same unrated-is-not-zero rule toRestaurant applies — the prose prints a
    // ratingless restaurant as "0★", and a 0 here would render as "0.0" on the
    // card and persist as googleRating: 0 onto your map when you save it.
    rating: row.rating || null,
    priceForTwo: null,
    photo: null,
  };
}

// render_restaurants_dineout — the structured twin of the search prose, and the
// tool search itself tells you to call next. It takes the ids in the order they
// should be shown plus the searches that produced them, and returns all of them
// as real data in ONE call. That's two Swiggy calls per deck load instead of
// one-per-restaurant, which matters while the agreement's rate limits are
// stated only as categories with no numbers.
// Swiggy's own caps on this call, and both are hard errors rather than
// truncations: "restaurantIds must contain at most 50 ids" is what a
// multi-term deck hits first (two 30-row searches is 60), and `searches` is
// capped at 5. Deduping comes before the slice so the 50 spent are 50 distinct
// restaurants — the same id routinely comes back from more than one term.
const RENDER_MAX_IDS = 50;
const RENDER_MAX_SEARCHES = 5;

async function renderRestaurants(ids: string[], searches: Record<string, unknown>[]): Promise<Rec[]> {
  const unique = [...new Set(ids)].slice(0, RENDER_MAX_IDS);
  if (unique.length === 0 || searches.length === 0) return [];
  try {
    return listOf(
      payload(
        await callSwiggyTool<Rec>("render_restaurants_dineout", {
          searches: searches.slice(0, RENDER_MAX_SEARCHES),
          restaurantIds: unique,
        })
      )
    );
  } catch (err) {
    if (err instanceof SwiggyAuthError) throw err; // reconnect must reach the UI
    if (err instanceof SwiggyRateLimitError) throw err; // and so must "stop for now"
    console.warn("[swiggy] render_restaurants_dineout failed; falling back to the prose rows", err);
    return [];
  }
}

function nextOffset(text: string): number | null {
  const m = /offset=(\d+)/i.exec(text);
  if (!m) return null;
  const offset = Number(m[1]);
  return Number.isFinite(offset) ? offset : null;
}

// One search_restaurants_dineout call, both envelopes kept. Named because the
// fan-out below has to hold an array of them through Promise.allSettled.
export interface SearchPage {
  search: Record<string, unknown>;
  raw: Rec[];
  rows: SearchRow[];
  text: string;
  data: Rec | null;
}

async function searchPage(search: Record<string, unknown>): Promise<SearchPage> {
  const { data, text } = await callSwiggyReply<Rec>("search_restaurants_dineout", search);
  const raw = listOf(payload(data ?? {}));
  return {
    search,
    raw,
    rows: raw.length > 0 ? [] : parseSearchRows(text),
    text,
    data,
  };
}

// The ids one page listed, in its own order, whichever envelope it filled.
function pageIds(page: SearchPage): string[] {
  return page.raw.length > 0
    ? page.raw.map((o) => asStr(pick(o, "id", "restaurantId", "resId", "restaurant_id")) ?? "")
    : page.rows.map((row) => row.id);
}

// The ids in the order search listed them, page by page.
function providerIdOrder(pages: SearchPage[]): string[] {
  return pages.flatMap(pageIds);
}

// Which search returned each id — the fan-out's provenance. Keyed on the
// page's own `query`, so the extra page of a term counts for that term and the
// locality top-up counts for the locality.
function termHits(pages: SearchPage[]): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const page of pages) {
    const term = typeof page.search.query === "string" ? page.search.query : "";
    if (!term) continue;
    for (const id of pageIds(page)) {
      if (!id) continue;
      const list = hits.get(id) ?? [];
      if (!list.includes(term)) list.push(term);
      hits.set(id, list);
    }
  }
  return hits;
}

function inProviderOrder(results: SwiggyRestaurant[], order: string[]): SwiggyRestaurant[] {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (id && !rank.has(id)) rank.set(id, i);
  });
  return results
    .map((r, i) => ({ r, at: rank.get(r.id) ?? order.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.r);
}

function uniqRestaurants(results: SwiggyRestaurant[]): SwiggyRestaurant[] {
  const seen = new Set<string>();
  const out: SwiggyRestaurant[] = [];
  for (const r of results) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export interface DineoutSearchQuery {
  // Already-resolved Swiggy terms, most specific first. Built from the
  // structured ask by lib/swiggyTerms.ts — never raw user words.
  terms: string[];
  // The locality name. Used as its own search term when the concept searches
  // do not cover it, and as the client-side gate either way.
  area?: string;
  // The geocoded centre of `area` when Ask found one. Concept searches run
  // here rather than at the user's position, which is what makes a concept
  // term return anything near the place that was asked about.
  areaLat?: number;
  areaLng?: number;
  // The user's own position — the fallback centre, and the pair that has to
  // travel unchanged to slots and booking.
  lat?: number;
  lng?: number;
}

export async function searchDineoutRestaurants(
  query: DineoutSearchQuery
): Promise<{
  results: SwiggyRestaurant[];
  dropped: number;
  // The terms that answered, and the concept terms that were TRIED — a term
  // whose call failed is in the second and not the first, and the deck ranks
  // coverage against what was tried, or a failed "Rooftop" would turn every
  // "Bar" row into a full match with nothing left unconfirmed.
  searched: string[];
  attempted: string[];
}> {
  if (!swiggyLive()) {
    const mock = mockSearch(query);
    return { results: mock.results, dropped: 0, searched: mock.used, attempted: mock.attempted };
  }

  const user: UserCoords = { lat: query.lat ?? 12.972, lng: query.lng ?? 77.61 };
  const area = query.area?.trim();
  // Search where the ask pointed, not where the phone is.
  const centre: UserCoords =
    query.areaLat != null && query.areaLng != null
      ? { lat: query.areaLat, lng: query.areaLng }
      : user;

  const terms = query.terms.map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0 && area) terms.push(area);
  if (terms.length === 0) terms.push(DEFAULT_SEARCH_TERM);

  // Narrow (the default): the most specific term only — one call, one page of
  // the documented 30-row maximum. Wide: one search per concept, in parallel —
  // render_restaurants_dineout accepts up to 5 searches and resolves ids across
  // all of them, so that is the shape the tool was built for. Either way it is
  // a TERM, never a sentence: "rooftop friends in Indiranagar" measurably
  // returns 0 rows where "rooftop" returns 30, and the coordinates below carry
  // the location the sentence used to.
  const used = WIDE_SEARCH ? terms.slice(0, 4) : terms.slice(0, 1);
  // allSettled, not all: with a fan-out, `all` means one flaky term rejects the
  // whole set, the route turns that into a 502, and the deck says "reconnect
  // Swiggy" while discarding three perfectly good pages. A reauth still has to
  // reach the UI, and a total failure still has to surface — but a partial one
  // is just a smaller deck.
  const settled = await Promise.allSettled(
    used.map((term) => searchPage(buildSearchArgs({ term }, centre)))
  );
  const authFailure = settled.find(
    (r) => r.status === "rejected" && r.reason instanceof SwiggyAuthError
  );
  if (authFailure && authFailure.status === "rejected") throw authFailure.reason;
  // Swiggy said stop on ANY term: that is the whole answer, however many pages
  // came back — and it outranks "every term failed" below, or a transport
  // error on the first term would turn a throttle on the second into a 502
  // with no Retry-After. Rendering the pages that did come back is another
  // request during the back-off, and a 200 would have the deck fetch details
  // for every card straight after. The client must hear "busy", with the wait.
  const throttled = settled.find(
    (r) => r.status === "rejected" && r.reason instanceof SwiggyRateLimitError
  );
  if (throttled?.status === "rejected") throw throttled.reason;
  const firstFailure = settled.find((r) => r.status === "rejected");
  if (firstFailure?.status === "rejected" && !settled.some((r) => r.status === "fulfilled")) {
    throw firstFailure.reason; // every term failed — that IS the outage
  }
  const pages = settled
    .filter((r): r is PromiseFulfilledResult<SearchPage> => r.status === "fulfilled")
    .map((r) => r.value);
  const searched = used.filter((_, i) => settled[i].status === "fulfilled");

  // The two searches below are OPTIONAL widenings of an answer we already have.
  // A bare `await` on either put them outside the partial-failure handling
  // above: one flaky top-up rejected the whole call, the route turned that into
  // a 502, and the deck said "Swiggy didn't answer" while discarding pages that
  // had already come back fine. A reauth still has to surface — that is a state
  // the user must act on — but nothing else here is worth losing results over.
  const optionalPage = async (args: Record<string, unknown>): Promise<SearchPage | null> => {
    try {
      return await searchPage(args);
    } catch (err) {
      if (err instanceof SwiggyAuthError) throw err;
      if (err instanceof SwiggyRateLimitError) throw err;
      console.warn("[swiggy] optional follow-up search failed; keeping the pages we have", err);
      return null;
    }
  };

  // Did the concepts actually land near the area that was asked for? If not,
  // the locality earns a search of its own — the difference between an empty
  // deck and a usable one on "biryani near koramangala". It is still a call, so
  // it spends the same wide budget the fan-out does; narrow leans on `centre`
  // (the geocoded area, when Ask found one) to aim the single search instead.
  if (WIDE_SEARCH && area) {
    // Counted over BOTH envelopes. `page.rows` is the prose fallback and
    // searchPage leaves it empty whenever structuredContent was filled, so
    // reading only that would make inArea permanently 0 the day Swiggy starts
    // filling it — firing the top-up unconditionally, which is the opposite of
    // deciding from the result.
    const inArea = pages
      .flatMap((page: SearchPage) => [
        ...page.rows.map((row) => row.area),
        ...page.raw.map((o) => toRestaurant(o)?.area ?? ""),
      ])
      .filter((a) => a && areaMatches(a, area)).length;
    if (inArea < AREA_TOPUP_BELOW && !used.some((t) => areaMatches(t, area))) {
      const topUp = await optionalPage(buildSearchArgs({ term: area }, centre));
      if (topUp) {
        searched.push(area);
        pages.push(topUp);
      }
    }
  }

  const offset = EXTRA_SEARCH_PAGE ? nextOffset(pages[0]?.text ?? "") : null;
  if (offset != null && pages[0]) {
    const next = await optionalPage({ ...pages[0].search, offset });
    if (next) pages.push(next);
  }

  // The original bug was an unreadable answer being reported as an empty deck.
  // If Swiggy reflows the sentence, parseSearchRows returns nothing and this
  // would do exactly that again — one layer down. So when the prose itself says
  // it found restaurants, or still carries ids we failed to read, fail loudly:
  // the route turns that into a 502 the UI can actually say something about.
  for (const page of pages) {
    const claimed = /Found\s+(\d+)\s+restaurant/i.exec(page.text);
    const shouldHaveRows = (claimed ? Number(claimed[1]) > 0 : false) || page.text.includes("(ID:");
    if (page.data === null && page.rows.length === 0 && shouldHaveRows) {
      console.error(`[swiggy] search prose parsed to zero rows — format changed? ${page.text.slice(0, 200)}`);
      throw new Error("swiggy_unparsable_search");
    }
  }

  const rows = pages.flatMap((page) => page.rows);
  let raw = pages.flatMap((page) => page.raw);
  if (rows.length > 0) {
    raw = [...raw, ...(await renderRestaurants(rows.map((r) => r.id), pages.map((page) => page.search)))];
  }

  let results = uniqRestaurants(
    raw
      .map((o) => toRestaurant(o))
      .filter((r): r is SwiggyRestaurant => r !== null)
  );

  // Render can answer for only SOME of the ids, and toRestaurant drops anything
  // with no id or name. Backfill those from the prose row instead of losing
  // them — search already gave us a name, a rating and a locality for every one
  // — and instead of the all-or-nothing fallback this used to do, which threw
  // away nine good structured rows because the tenth was missing.
  const covered = new Set(results.map((r) => r.id));
  const missing = rows.filter((row) => !covered.has(row.id));
  if (missing.length > 0) {
    console.warn(
      `[swiggy] ${missing.length}/${rows.length} rows had no structured record; using their prose`
    );
    results = uniqRestaurants([...results, ...missing.map(fromSearchRow)]);
  }

  // Search's own order is the one ranking this app gets before a details call
  // that was made at the user's coordinates — Swiggy's relevance for the term
  // near where they are, which is why the deck leans on it. Nothing above
  // preserved it: structured pages came first regardless of page order, and
  // render_restaurants_dineout answers in whatever order it likes. Put every
  // record back where its search listed it; records search never listed keep
  // their response order, after.
  results = inProviderOrder(results, providerIdOrder(pages));

  // Keep which search listed each row. Merging without this is what let a row
  // the locality top-up swept in stand as an answer to the concept term.
  const hits = termHits(pages);
  results = results.map((r) => {
    const matched = hits.get(r.id);
    return matched ? { ...r, matchedTerms: matched } : r;
  });

  // What search offered but nothing could turn into a card. Counted against the
  // prose rows when there are any, since that's the real denominator.
  // Deduped denominator: `rows` is flattened across every search, so the same
  // restaurant coming back from two terms counted as a DROP under a fan-out.
  const offered = new Set(rows.map((r) => r.id)).size || raw.length;
  const dropped = Math.max(0, offered - results.length);

  if (dropped > 0) {
    console.warn(`[swiggy] dropped ${dropped}/${offered} results with no id or name`);
  }
  return { results, dropped, searched, attempted: used };
}

// The tool's default page is 10 and its cap is 30. Nothing used to send this at
// all, so the deck drew from 10 candidates and then filtered them — on a query
// where Swiggy's own prose said "Found 38 restaurant(s) ... 28 more available".
export const SEARCH_LIMIT = 30;

// ONE search. One term, no location words, and the coordinates carry the place.
//
// The old version built a sentence — `${keyword} in ${area}` out of a
// stopword-stripped bag of the user's words — which is the shape
// search_restaurants_dineout documents as wrong ("One term, not a sentence"),
// and which measurably returns nothing: "rooftop friends in Indiranagar" → 0
// rows, while "rooftop" → 30.
//
// `entityType` is gone with it. The doc calls it "rarely needed ... set this
// only to force a specific interpretation of an ambiguous term", and the
// condition that used to set it (`!keyword && !area && cuisine`) could
// essentially never be true once a keyword existed — which was every typed ask.
// The term a lens-less deck browses with, when no locality is known either.
// It used to be "restaurants", which this catalogue answers as a NAME match:
// measured 2026-09-14 at the Bengaluru centre, all 30 rows were places called
// "…Restaurant(s)", 11 of them unrated, none with a cuisine or a price.
// "Dinner" at the same point returned 30 rows, 21 rated, every one with a
// distance, median 4.4km. A locality name does better still (28 of 30 rated,
// median 1.4km) — so the client sends the locality your nearest saved pins
// stand in whenever it can (see nearbyArea in lib/deck.ts), and this is the
// floor under that.
export const DEFAULT_SEARCH_TERM = "Dinner";

export function buildSearchArgs(
  query: { term: string; offset?: number; limit?: number },
  user: UserCoords
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    query: query.term.trim() || DEFAULT_SEARCH_TERM,
    latitude: user.lat,
    longitude: user.lng,
    limit: query.limit ?? SEARCH_LIMIT,
  };
  if (query.offset != null) args.offset = query.offset;
  return args;
}

// Below this many in-area results, a concept search has not really answered an
// area ask and the locality gets a search of its own as a top-up. Measured:
// `query="bar"` at Indiranagar's coordinates returns 30 rows with 2 in
// Indiranagar, while `query="Indiranagar"` returns 28 rows with 28 in it. One
// shape wins on relevance, the other on coverage, and which you need depends on
// what the concept search actually came back with — so it is decided from the
// result, not guessed up front.
const AREA_TOPUP_BELOW = 5;

export async function getAvailableSlots(
  restaurantId: string,
  opts: { lat?: number; lng?: number; date?: string; guestCount?: number } = {}
): Promise<SwiggySlot[]> {
  if (!swiggyLive()) return mockSlots(restaurantId);

  // Slots come back at the root of the response, not under `data` — the
  // reference calls this out explicitly ("access response.slots directly").
  //
  // And when there are no tables for the date, Swiggy answers in prose ("No
  // bookable slots for 2026-08-26. Do not retry this tool for the same date.")
  // with an empty structuredContent and NO isError. That is an empty list, not
  // a failure — so this reads the reply rather than the structured-or-throw
  // wrapper, which would turn a normal sold-out evening into a 502.
  const { data: res } = await callSwiggyReply<Rec>("get_available_slots", {
    restaurantId,
    date: opts.date ?? todayInIndia(),
    latitude: opts.lat ?? 12.972,
    longitude: opts.lng ?? 77.61,
    ...(opts.guestCount ? { guestCount: opts.guestCount } : {}),
  });

  if (isRec(res) && res.success === false) {
    throw new Error(asStr(res.error) || "swiggy_slots_error");
  }

  const rawSlots = Array.isArray(res?.slots) ? res.slots.filter(isRec) : [];

  return rawSlots
    .map((s): SwiggySlot | null => {
      // book_table wants the slotId off the *deal*, not the slot — a slot is a
      // time, a deal is the bookable ticket at that time. Fall back to the
      // slot's own ids when a slot carries no deals.
      const deals = Array.isArray(s.deals) ? s.deals.filter(isRec) : [];
      const deal = deals[0];

      const slotId = asNum(deal ? pick(deal, "slotId", "slot_id") : undefined) ?? asNum(pick(s, "slotId", "slot_id"));
      const itemId = asStr(deal ? pick(deal, "itemId", "item_id") : undefined) ?? asStr(pick(s, "itemId", "item_id"));
      const reservationTime = asNum(pick(s, "reservationTime", "reservation_time"));
      const displayTime = asStr(pick(s, "displayTime", "display_time", "dateStr"));

      if (slotId == null || !itemId || reservationTime == null || !displayTime) return null;
      return {
        slotId,
        itemId,
        reservationTime,
        displayTime,
        groupName: asStr(pick(s, "slotGroupName", "groupName")),
      };
    })
    .filter((s): s is SwiggySlot => s !== null);
}

// Free reservations only — the app has no payment surface, so paymentMethod and
// cartKey are deliberately never sent. If Swiggy answers PENDING_PAYMENT the
// slot turned out to be a paid UPI prebook deal; that comes back as
// confirmed:false with the intent URL, and the UI hands the user off rather
// than claiming a table it doesn't have.
export async function bookTable(
  restaurantId: string,
  slot: { slotId: number; itemId: string; reservationTime: number },
  guestCount: number,
  user: UserCoords
): Promise<SwiggyBooking> {
  const guests = Math.min(20, Math.max(1, Math.round(guestCount) || 2));

  if (!swiggyLive()) {
    return {
      orderId: `mock-${restaurantId}-${slot.slotId}-${guests}`,
      status: "CONFIRMED",
      confirmed: true,
      restaurantName: null,
      guestCount: guests,
      upiIntentUrl: null,
    };
  }

  const data = payload(
    await callSwiggyTool("book_table", {
      restaurantId,
      slotId: slot.slotId,
      itemId: slot.itemId,
      reservationTime: slot.reservationTime,
      guestCount: guests,
      latitude: user.lat,
      longitude: user.lng,
    })
  );

  const d = isRec(data) ? data : {};
  const status = asStr(pick(d, "status")) ?? "UNKNOWN";
  return {
    orderId: asStr(pick(d, "orderId", "order_id")),
    status,
    confirmed: status === "CONFIRMED",
    restaurantName: asStr(pick(d, "restaurantName")),
    guestCount: asNum(pick(d, "guestCount")) ?? guests,
    upiIntentUrl: asStr(pick(d, "upiIntentUrl", "upi_intent_url")),
  };
}
