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

import { callSwiggyReply, callSwiggyTool, swiggyLive, SwiggyAuthError } from "./swiggyMcp";
import { areaMatches } from "./decide";

export { SwiggyAuthError, swiggyLive } from "./swiggyMcp";

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

function imageUrl(v: unknown): string | null {
  const raw = asStr(v);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  return `${MEDIA_BASE}/${MEDIA_TRANSFORMS}/${raw.replace(/^\/+/, "")}`;
}

function photoOf(o: Rec): string | null {
  const direct = imageUrl(
    pick(
      o,
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
      "media"
    )
  );
  if (direct) return direct;

  // Some payloads nest the media, or hand back a gallery array.
  for (const key of ["images", "photos", "gallery", "mediaFiles", "imageGallery"]) {
    const v = o[key];
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      const url = isRec(first) ? photoOf(first) : imageUrl(first);
      if (url) return url;
    }
  }
  return null;
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

function mockSearch(query: { cuisine?: string; keyword?: string; area?: string }): SwiggyRestaurant[] {
  let results = MOCK_RESTAURANTS;
  if (query.cuisine) {
    results = results.filter((r) => r.cuisines.includes(query.cuisine!));
  }
  if (query.area) {
    results = results.filter((r) => areaMatches(r.area, query.area!));
  }
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    results = results.filter(
      (r) =>
        r.name.toLowerCase().includes(kw) ||
        r.cuisines.some((c) => c.includes(kw)) ||
        r.area.toLowerCase().includes(kw)
    );
  }
  return results;
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
  return {
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
    photo: photoOf(o),
  };
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
async function renderRestaurants(ids: string[], search: Record<string, unknown>): Promise<Rec[]> {
  if (ids.length === 0) return [];
  try {
    return listOf(
      payload(
        await callSwiggyTool<Rec>("render_restaurants_dineout", {
          searches: [search],
          restaurantIds: ids,
        })
      )
    );
  } catch (err) {
    if (err instanceof SwiggyAuthError) throw err; // reconnect must reach the UI
    console.warn("[swiggy] render_restaurants_dineout failed; falling back to the prose rows", err);
    return [];
  }
}

export async function searchDineoutRestaurants(query: {
  cuisine?: string;
  keyword?: string;
  area?: string;
  lat?: number;
  lng?: number;
}): Promise<{ results: SwiggyRestaurant[]; dropped: number }> {
  if (!swiggyLive()) {
    return { results: mockSearch(query), dropped: 0 };
  }

  const user: UserCoords = { lat: query.lat ?? 12.972, lng: query.lng ?? 77.61 };
  const keyword = query.keyword?.trim();
  const cuisine = query.cuisine?.trim();
  const area = query.area?.trim();

  const args = buildSearchArgs({ keyword, cuisine, area }, user);

  // Search answers in PROSE — a numbered list with ids in parentheses — and
  // leaves structuredContent empty. See unwrapReply in swiggyMcp.ts.
  const { data, text } = await callSwiggyReply<Rec>("search_restaurants_dineout", args);

  // If Swiggy ever starts filling structuredContent on search, prefer it.
  let raw = listOf(payload(data ?? {}));
  const rows = raw.length > 0 ? [] : parseSearchRows(text);
  if (raw.length === 0) {
    raw = await renderRestaurants(rows.map((r) => r.id), args);
  }

  // The original bug was an unreadable answer being reported as an empty deck.
  // If Swiggy reflows the sentence, parseSearchRows returns nothing and this
  // would do exactly that again — one layer down. So when the prose itself says
  // it found restaurants, or still carries ids we failed to read, fail loudly:
  // the route turns that into a 502 the UI can actually say something about.
  const claimed = /Found\s+(\d+)\s+restaurant/i.exec(text);
  const shouldHaveRows = (claimed ? Number(claimed[1]) > 0 : false) || text.includes("(ID:");
  if (data === null && rows.length === 0 && shouldHaveRows) {
    console.error(`[swiggy] search prose parsed to zero rows — format changed? ${text.slice(0, 200)}`);
    throw new Error("swiggy_unparsable_search");
  }

  let results = raw
    .map((o) => toRestaurant(o))
    .filter((r): r is SwiggyRestaurant => r !== null);

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
    results = [...results, ...missing.map(fromSearchRow)];
  }

  // What search offered but nothing could turn into a card. Counted against the
  // prose rows when there are any, since that's the real denominator.
  const dropped = Math.max(0, (rows.length || raw.length) - results.length);

  // Keyword/area took the query slot, so apply the cuisine lens here.
  if ((keyword || area) && cuisine) {
    const c = cuisine.toLowerCase();
    const narrowed = results.filter((r) => r.cuisines.some((x) => x.includes(c)));
    if (narrowed.length > 0) results = narrowed;
  }

  if (dropped > 0) {
    console.warn(`[swiggy] dropped ${dropped}/${rows.length || raw.length} results with no id or name`);
  }
  return { results, dropped };
}

export function buildSearchArgs(
  query: { cuisine?: string; keyword?: string; area?: string },
  user: UserCoords
): Record<string, unknown> {
  const keyword = query.keyword?.trim();
  const cuisine = query.cuisine?.trim();
  const area = query.area?.trim();

  // The tool takes one free-text `query`. With no area, keep the documented
  // cuisine entityType path; with an area, the locality has to be inside the
  // Swiggy query itself or New mode only filters whatever the first nearby page
  // happened to return.
  let text = keyword || cuisine || "restaurants";
  if (area) {
    const base = keyword || (cuisine ? `${cuisine} restaurants` : "restaurants");
    text = `${base} in ${area}`;
  }

  const args: Record<string, unknown> = {
    query: text,
    latitude: user.lat,
    longitude: user.lng,
  };
  if (!keyword && !area && cuisine) args.entityType = "CUISINE";
  return args;
}

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
