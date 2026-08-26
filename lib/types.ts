// Core domain types for the going-out second brain.

// Lifecycle is exclusive. `favorite` / `neverAgain` are independent flags (see DisplayState).
export type PlaceStatus = "watchlist" | "visited";

// Derived state used purely for pin color + label (priority order baked into displayState()).
export type DisplayState = "never_again" | "favorite" | "visited" | "watchlist";

export type CaptureSource = "search" | "paste" | "manual" | "swiggy";

// Tag namespaces — fixed so tags don't rot and filters stay obvious.
// `staple` = the specific dish/craving a place is your go-to for ("pizza",
// "dosa") — orthogonal to cuisine, so "just pizza" is a first-class ask.
export type TagNamespace =
  | "type"
  | "cuisine"
  | "staple"
  | "occasion"
  | "vibe"
  | "practical";

export interface Tag {
  namespace: TagNamespace;
  value: string;
}

// Sub-rating dimensions captured on a visit. The overall rating (place.myRating)
// is the ONLY one shown in the UI; the rest are private signal the assistant
// mines to answer quality-specific asks ("great ambiance", "good value").
export type RatingDimension = "food" | "experience" | "ambiance" | "service" | "value";
export const RATING_DIMENSIONS: RatingDimension[] = ["food", "experience", "ambiance", "service", "value"];
export const RATING_LABELS: Record<RatingDimension, string> = {
  food: "Food",
  experience: "Experience", // the non-food counterpart to `food` (see dimensionsFor)
  ambiance: "Ambiance",
  service: "Service",
  value: "Value", // value-for-money: 5 = great value, not "expensive"
};

// No place is asked every dimension. `food` only means something where you eat
// or drink; `experience` is its counterpart everywhere else — a museum has no
// food score, and inventing one would poison the assistant's "great food" ask.
// Both live in the union permanently: a place rated before the split keeps its
// `food` value untouched, so nothing migrates.
export const FOOD_DIMENSIONS: RatingDimension[] = ["food", "ambiance", "service", "value"];
export const NON_FOOD_DIMENSIONS: RatingDimension[] = ["experience", "ambiance", "service", "value"];

export interface Visit {
  id: string;
  visitedOn: string; // ISO date (yyyy-mm-dd)
  whoWith: string;
  notes: string; // dishes, what to order again, etc.
  rating: number | null; // optional per-visit rating
  createdAt: string;
}

export interface Photo {
  id: string;
  dataUrl: string; // resized data URL (own uploads) or remote URL (google)
  blobUrl?: string; // private Vercel Blob URL once uploaded — the sync handle for the bytes
  source: "mine" | "google";
  scope: "place" | "visit"; // place = general; visit = tied to one visit
  visitId: string | null; // set when scope === "visit"
  createdAt: string;
}

// Google opening hours (regularOpeningHours.periods). day: 0=Sun … 6=Sat.
// A missing `close` with open at 00:00 means open 24h.
export interface OpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface Place {
  id: string;
  googlePlaceId: string | null;
  name: string;
  address: string;
  area?: string; // neighbourhood / locality ("Jayanagar") — from Google, powers area search
  // City ("Bengaluru", "Jaipur") — written only by the Google path (save +
  // enrich), where addressComponents names it authoritatively. Absent on older
  // records and on Swiggy/manual saves; read via cityOf() in lib/city.ts, which
  // falls back to parsing `address`. Deliberately NOT backfilled by a migration:
  // mass-stamping updatedAt would beat newer remote records in the sync merge.
  city?: string;
  lat: number;
  lng: number;
  // True when lat/lng is NOT the place's own position. Swiggy publishes no
  // restaurant coordinates, so a swipe-saved find is stored at your position and
  // then moved to whatever Google can resolve for it — an exact match clears
  // this, falling back to the locality centroid (or failing outright) leaves it
  // set. The UI has to say so out loud: a pin you can't tell is a guess is worse
  // than a pin you know is one, because you'd drive to it.
  approxLocation?: boolean;
  status: PlaceStatus;
  favorite: boolean; // preference flag, overlays visited
  neverAgain: boolean; // preference flag, overlays visited

  myRating: number | null; // 0–5, set once visited — the ONE shown rating
  ratings?: Partial<Record<RatingDimension, number>>; // 1–5 per dimension; private, assistant-only
  googleRating: number | null; // cached reference
  myBudgetPerPerson: number | null; // your logged spend / person
  googlePriceLevel: number | null; // 0–4 ($ signs)

  notes: string;
  // The Instagram reel (or any link) the place came from — most saves start on a
  // reel, so this is the "go back and see why I saved it" handle. Optional.
  reelUrl?: string;
  tags: Tag[];
  photos: Photo[];
  visits: Visit[];

  googleTypes?: string[]; // raw Google place types, for enrichment/heuristics
  openingPeriods?: OpeningPeriod[]; // from Places details; powers open-now
  hoursText?: string[]; // human weekday descriptions (display only)
  summary?: string; // Google's editorial "lowdown" — cached reference, the
  // initial research the assistant reads on a not-yet-visited place

  source: CaptureSource;
  enrichedAt: string | null; // for the ~30-day refresh rule
  createdAt: string;
  // Sync bookkeeping (v2 cloud store). `updatedAt` drives per-record
  // last-write-wins across devices; absent on records written before sync
  // existed — treat a missing value as `createdAt`. `deletedAt` is a
  // soft-delete tombstone: hidden from every read, but kept and synced so a
  // deletion propagates instead of the place re-appearing on the next pull.
  updatedAt?: string;
  deletedAt?: string | null;
}

// The subjective tag namespaces a user hand-picks (type/cuisine come from Google).
export const TAG_OPTIONS: Record<TagNamespace, string[]> = {
  // Where you can go — NOT only where you can eat. Ordered food-first, then the
  // rest of a night/day out. Kept deliberately narrow: every value here becomes
  // a Browse group and a Decide filter chip, so a long tail of near-synonyms
  // makes both worse. (`outdoor` is intentionally absent — it already exists as
  // a vibe, and the near-duplicate confused both the parser and the model.)
  type: [
    "restaurant",
    "café",
    "bar",
    "dessert",
    "street-food",
    "museum",
    "landmark",
    "viewpoint",
    "park-garden",
    "activity",
    "theatre",
    "shopping",
  ],
  cuisine: [
    "italian",
    "south-indian",
    "north-indian",
    "japanese",
    "chinese",
    "thai",
    "mexican",
    "continental",
    "korean",
    "mughlai",
  ],
  // The "I just want ___" cravings — a place can carry several. Distinct from
  // cuisine (an italian place may be your pizza AND your pasta spot).
  staple: [
    "pizza",
    "pasta",
    "burger",
    "burrito",
    "tacos",
    "dosa",
    "biryani",
    "ramen",
    "sushi",
    "noodles",
    "sandwich",
    "momos",
    "wings",
    "shawarma",
  ],
  occasion: ["date", "family", "friends", "solo", "work", "celebration"],
  vibe: [
    "quiet",
    "lively",
    "romantic",
    "outdoor",
    "instagrammable",
    "cozy",
    "rooftop",
    "fine-dining",
  ],
  practical: [
    "groups",
    "vegetarian",
    "vegan-options",
    "reservation-needed",
    "pet-friendly",
    "late-night",
    "parking",
  ],
};

export const NAMESPACE_LABELS: Record<TagNamespace, string> = {
  type: "Type",
  cuisine: "Cuisine",
  staple: "Staple",
  occasion: "Occasion",
  vibe: "Vibe",
  practical: "Practical",
};

// The types where you actually eat or drink. Drives which questions the visit
// form asks and which tag namespaces it offers.
export const FOOD_TYPES = new Set(["restaurant", "café", "bar", "dessert", "street-food"]);

// Namespaces that only make sense somewhere you eat — a viewpoint has no
// cuisine and no staple dish.
export const FOOD_NAMESPACES = new Set<TagNamespace>(["cuisine", "staple"]);

// Is this somewhere you eat or drink? `some` rather than "the first type" on
// purpose: a museum with a café attached legitimately answers yes, and the
// forgiving direction keeps the food questions on anything ambiguous. An
// untyped place also answers yes — the library predates this vocabulary and was
// overwhelmingly restaurants, so old places keep asking what they always asked.
export function isFoodPlace(tags: Tag[]): boolean {
  const types = tags.filter((t) => t.namespace === "type");
  if (!types.length) return true;
  return types.some((t) => FOOD_TYPES.has(t.value));
}

// The sub-rating dimensions this place should be asked about.
export function dimensionsFor(tags: Tag[]): RatingDimension[] {
  return isFoodPlace(tags) ? FOOD_DIMENSIONS : NON_FOOD_DIMENSIONS;
}

// The tag namespaces this place should be offered, in display order.
export function namespacesFor(tags: Tag[]): TagNamespace[] {
  const all = Object.keys(TAG_OPTIONS) as TagNamespace[];
  return isFoodPlace(tags) ? all : all.filter((ns) => !FOOD_NAMESPACES.has(ns));
}

// Colors must mirror the --s-* CSS vars (these are used in non-CSS contexts).
export const DISPLAY_STATE_META: Record<
  DisplayState,
  { label: string; color: string }
> = {
  never_again: { label: "Skip", color: "oklch(0.60 0.02 265)" },
  favorite: { label: "Favorite", color: "oklch(0.60 0.17 15)" },
  visited: { label: "Been", color: "oklch(0.62 0.13 150)" },
  watchlist: { label: "Watchlist", color: "oklch(0.72 0.14 78)" },
};

// Pin color / label resolves status + flags by priority.
export function displayState(p: {
  status: PlaceStatus;
  favorite: boolean;
  neverAgain: boolean;
}): DisplayState {
  if (p.neverAgain) return "never_again";
  if (p.favorite) return "favorite";
  return p.status; // "visited" | "watchlist"
}

export type OpenState = "open" | "closing_soon" | "closed";

// Is the place open at `now`, and what are the hours of the relevant window —
// the one it's in right now if open, or the one it opens into next if closed?
// Returns null when hours are unknown (so callers can treat "unknown"
// differently from "closed"). Times are in the place's local timezone; for a
// single-city personal map that matches the device. "closing_soon" = closes
// within the hour — a distinct state so the UI can flag it before it just
// goes red. `close: null` means genuinely open around the clock (not just
// "closes after midnight").
export function openStatus(
  periods: OpeningPeriod[] | undefined,
  now: Date = new Date()
): {
  state: OpenState;
  open: { hour: number; minute: number };
  close: { hour: number; minute: number } | null;
} | null {
  if (!periods || periods.length === 0) return null;
  // Open 24h: one period, opens day 0 at 00:00, no close.
  if (
    periods.length === 1 &&
    !periods[0].close &&
    periods[0].open.hour === 0 &&
    periods[0].open.minute === 0
  ) {
    return { state: "open", open: periods[0].open, close: null };
  }
  const WEEK = 7 * 1440;
  const mow = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  for (const p of periods) {
    if (!p.close) continue;
    const start = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let end = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (end <= start) end += WEEK; // wraps past midnight / into next week
    let m = mow;
    if (m < start) m += WEEK; // normalise forward of the window start
    if (m >= start && m < end) {
      return { state: end - m <= 60 ? "closing_soon" : "open", open: p.open, close: p.close };
    }
  }
  // Not open in any period — find the soonest upcoming window.
  let soonest: OpeningPeriod | null = null;
  let soonestDelta = Infinity;
  for (const p of periods) {
    const start = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let delta = start - mow;
    if (delta < 0) delta += WEEK;
    if (delta < soonestDelta) {
      soonestDelta = delta;
      soonest = p;
    }
  }
  return soonest ? { state: "closed", open: soonest.open, close: soonest.close ?? null } : null;
}

// Is the place open at `now`? Returns null when hours are unknown.
export function isOpenNow(
  periods: OpeningPeriod[] | undefined,
  now: Date = new Date()
): boolean | null {
  const status = openStatus(periods, now);
  return status ? status.state !== "closed" : null;
}
