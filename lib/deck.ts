import type { Place } from "./types";
import type { SwiggyRestaurant } from "./swiggy";
import {
  areaMatches,
  rankPlaces,
  FALLBACK_REASON,
  UNRATED_SAVED_SCORE,
  type DecideQuery,
} from "./decide";
import { distanceKm } from "./geo";
import { leadRating } from "./format";
import {
  newSwipeAffinity,
  newSwipeAttributeKeys,
  PER_PERSON,
  type NewSwipeMemory,
} from "./swipeMemory";

// The swipe deck's source is the FIRST filter the user picks — before any
// cuisine lens. "saved" ranks your own map (the full DecideQuery vocabulary);
// "new" is Swiggy Dineout's catalog (cuisine + the standard area/budget/rating
// filters — see newMatches; Swiggy records carry no type/staple/vibe/hours
// signal, so only the tag half of the lens can't bite there); "both"
// alternates the two, best of each first — see zipper.
export type DeckSource = "saved" | "new" | "both";

// Where you are, when the deck may trust it — a GPS fix or a map view tight
// enough to be about one place (biasContext in lib/bias.ts). Never the
// Bengaluru fallback SwipeMode hands Swiggy's tools: that is plumbing, and a
// deck scored from it would demote Jaipur while you stand in Jaipur.
export type DeckAnchor = { lat: number; lng: number; source: "gps" | "map" };

// Half the standard filters DO bite on a Swiggy record. It carries no type,
// staple, vibe or opening hours — that's why the tag lens is saved-only — but
// it carries a locality, a rating and a cost for two, which is exactly what
// "area / budget / rated 4+" ask about. Applied here so those three chips mean
// the same thing on both halves of a Both deck instead of quietly filtering
// your own map and letting Swiggy's through untouched.
//
// Cuisine is deliberately absent: it's the Swiggy SEARCH term (entityType
// CUISINE), so the pool is already narrowed upstream, and re-filtering here on
// Swiggy's own much larger cuisine vocabulary would empty decks on a spelling
// mismatch rather than tighten them.

function newMatches(r: SwiggyRestaurant, q: DecideQuery): boolean {
  // Ask's geocoded centroid has no counterpart here (Swiggy hands back a
  // locality, and a radius gate on the deck would disagree with rankPlaces on
  // the same query), so the name is what both sides use.
  if (q.area && !areaMatches(r.area, q.area)) return false;

  // Unknown cost stays in, matching the saved side: a place with no price on it
  // is not KNOWN to be over your cap.
  if (q.maxBudget != null && r.priceForTwo != null && r.priceForTwo / PER_PERSON > q.maxBudget) {
    return false;
  }

  // Unrated is out, also matching the saved side: not known to clear the bar.
  if (q.minRating != null && (r.rating == null || r.rating < q.minRating)) return false;

  return true;
}

// One card, normalised over the two sources so the deck engine is source-blind.
// `kind` discriminates the action a swipe takes (a "new" right-swipe saves a
// fresh Place; a "saved" one is a no-op confirm — see SwipeDeck).
// `distanceKm` is on a saved card only when the deck had an anchor to measure
// from — the card shows it then, and shows the locality alone otherwise.
// `score` is the deck's own number on both halves (the two are NOT on one
// scale — see zipper); it is for tests and never for the card.
export type DeckCard =
  | { key: string; kind: "saved"; place: Place; score: number; reasons: string[]; distanceKm?: number }
  | { key: string; kind: "new"; r: SwiggyRestaurant; score: number; reasons: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const display = (s: string) => s.replace(/-/g, " ");

function termMatches(have: string, want: string): boolean {
  const h = norm(have);
  const w = norm(want);
  return h !== "" && w !== "" && (h.includes(w) || w.includes(h));
}

function hasCuisine(r: SwiggyRestaurant, values?: string[]): boolean {
  return Boolean(values?.some((want) => r.cuisines.some((have) => termMatches(have, want))));
}

function newText(r: SwiggyRestaurant): string {
  return [
    r.name,
    r.area,
    r.address,
    ...r.cuisines,
    r.description ?? "",
    ...(r.highlights ?? []),
    ...(r.offers ?? []),
  ]
    .join(" ")
    .toLowerCase();
}

function addReason(reasons: string[], reason: string): void {
  if (reasons.length >= 3 || reasons.includes(reason)) return;
  reasons.push(reason);
}

// A Swiggy result that's clearly already on your map. Dropped from New/Both so
// the deck never offers a "new" card for a place you already have. Kept local
// to avoid pulling the "use client" store into this pure module.
//
// Two rules, because a Swiggy row may or may not have a position. With one it's
// same-ish name within ~120m — what findDuplicate uses. Live Swiggy rows have
// none (Swiggy doesn't publish restaurant coordinates; one is looked up from
// Google at save time), so there the locality stands in for the proximity gate:
// same name in the same area is the same restaurant. That's looser and can let
// a duplicate through — the alternative is geocoding every card just to dedupe
// the ones you'd never save.
function alreadySaved(r: SwiggyRestaurant, places: Place[]): boolean {
  const rn = norm(r.name);
  // Within 120m a 5-character prefix is safe — two restaurants that close with
  // names starting the same way are the same restaurant. Without coordinates it
  // is NOT: "The Black Pearl" and "The Bluebop Cafe" share "thebl", and in the
  // same locality that prefix rule would silently hide a genuinely new place.
  // So the coordinate-less path demands one name to contain the other whole.
  const prefixName = (p: Place) => norm(p.name) === rn || norm(p.name).includes(rn.slice(0, 5));
  const wholeName = (p: Place) => {
    const pn = norm(p.name);
    return pn === rn || pn.includes(rn) || rn.includes(pn);
  };
  // Blank on either side means the locality can't gate anything — a prose
  // fallback row can carry area:"" and Place.area is optional. Standing the
  // whole check down there would re-offer a place already on your map, so the
  // name alone decides, and it has to match exactly. Otherwise areaMatches
  // rules, spelling tolerance included: "Indira Nagar" (Google's sublocality)
  // and "Indiranagar" (Swiggy's prose) are the same neighbourhood.
  const sameArea = (p: Place) => {
    if (!p.area?.trim() || !r.area.trim()) return norm(p.name) === rn;
    return areaMatches(p.area, r.area);
  };
  return places.some((p) => {
    if (r.lat == null || r.lng == null) return sameArea(p) && wholeName(p);
    const near = Math.abs(p.lat - r.lat) < 0.0011 && Math.abs(p.lng - r.lng) < 0.0011;
    return near && prefixName(p);
  });
}

// ---- New cards -------------------------------------------------------------
//
// A New card's score is a POSITION, not a point sum. Swiggy already ranked
// these rows — its relevance for the term, searched at your coordinates — and
// that order is the only location-aware signal a row carries before the
// details call (no coordinates, no distance; see SwiggyRestaurant). So the
// provider's index is the backbone, and everything local is a bounded nudge
// measured in positions: a rating moves a card a few places, an exact ask two,
// your swipe history one. What none of it can do is what the old point sum
// did — let a cheap, well-photographed 3.7★ eleven kilometres out beat a 4.5★
// down the road on cheapness, media and one prior swipe (that fixture scored
// 61 to 41; it now scores -1 to +1, the right way round).
//
// Nothing scores for being cheap (budget is a hard filter when asked and
// otherwise not a virtue), for photos or an offer (completeness is not
// quality), for a random draw, or for being unrated — that was +24, "a soft
// 3.0"; it is a penalty now, because no one has said the place is any good.

function ratingAdjustment(rating: number | null): number {
  if (rating == null) return -6;
  if (rating >= 4.5) return 2;
  if (rating >= 4.2) return 1;
  if (rating >= 4.0) return 0;
  if (rating >= 3.7) return -2;
  return -5;
}

// Two net-positive swipes on the same cuisine or locality before a card may
// name your history as its reason. One swipe is a data point, not a taste,
// and a price band is too coarse to be one at all. The score still moves by
// up to a position on any evidence; this gates only what the card SAYS.
function matchesYourSwipes(memory: NewSwipeMemory, r: SwiggyRestaurant): boolean {
  return newSwipeAttributeKeys(r).some(
    (key) => (key.startsWith("cuisine:") || key.startsWith("area:")) && (memory[key] ?? 0) >= 2
  );
}

function rankNew(
  r: SwiggyRestaurant,
  providerIndex: number,
  q: DecideQuery,
  memory: NewSwipeMemory
): Extract<DeckCard, { kind: "new" }> {
  const reasons: string[] = [];
  let score = -providerIndex;

  // Named, not scored: the area is a filter (newMatches) and the cuisine is
  // the search term, so both are already true of every card in the pool.
  if (q.area && areaMatches(r.area, q.area)) addReason(reasons, `Near ${q.area}`);
  const cuisineHit = q.cuisines?.find((wanted) => r.cuisines.some((have) => termMatches(have, wanted)));
  if (cuisineHit) addReason(reasons, `${display(cuisineHit)} match`);

  if (q.keywords?.length) {
    const hay = newText(r);
    if (q.keywords.some((kw) => kw.length >= 3 && hay.includes(kw.toLowerCase()))) {
      score += 2;
      addReason(reasons, "Matches your ask");
    }
  }

  if (q.maxBudget != null && r.priceForTwo != null && r.priceForTwo / PER_PERSON <= q.maxBudget) {
    addReason(reasons, `Under ₹${q.maxBudget.toLocaleString("en-IN")}/head`);
  }

  score += ratingAdjustment(r.rating);
  if (r.rating != null && r.rating >= (q.minRating ?? 4.2)) {
    addReason(reasons, `${r.rating.toFixed(1)} on Swiggy`);
  }

  score += Math.max(-1, Math.min(1, newSwipeAffinity(memory, r)));
  if (matchesYourSwipes(memory, r)) addReason(reasons, "Matches your swipes");

  if (reasons.length === 0) addReason(reasons, "New on Swiggy");
  return { key: `new:${r.id}`, kind: "new", r, score, reasons };
}

// ---- Saved cards -----------------------------------------------------------
//
// Swipe-only corrections to the saved ranker's score. rankPlaces is shared
// with Ask, the lens count and the map's pin membership, so what is true only
// of a deck — you are choosing somewhere to go NOW, from where you are — is
// applied here, after it, and never inside it.
//
// Distance is a penalty, not a gate: a cross-city pin (-40) falls behind
// anything viable nearby but is still in the deck, at the back, and a place
// you love a few kilometres out keeps its lead over a middling one next door.
// An explicit area (query.areaCenter) is rankPlaces' own business — it gates at
// 4km and pays proximity inside — so the deck adds nothing on top of it.

const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);

// Past this it is another city, and the penalty stops scaling.
const CROSS_CITY_KM = 25;
const CROSS_CITY_PENALTY = 40;

function distancePenalty(km: number): number {
  if (km <= 2) return 0;
  if (km <= 5) return lerp(km, 2, 5, 0, 4);
  if (km <= 10) return lerp(km, 5, 10, 4, 12);
  if (km <= CROSS_CITY_KM) return lerp(km, 10, CROSS_CITY_KM, 12, 24);
  return CROSS_CITY_PENALTY;
}

// An approximate pin (Place.approxLocation) sits where the Swiggy search ran
// from, or at its locality's centroid — right about the city, wrong about the
// street. Measured from your own position it reads "0 m" for a place that
// could be anywhere in town, so it gets no fine-grained penalty and shows no
// distance. It still takes the cross-city tier: the seed WAS the city Swiggy
// searched, and a Bengaluru find must not lead a Jaipur deck just because its
// pin is a guess.
function savedDistancePenalty(km: number, approx: boolean): number {
  if (!approx) return distancePenalty(km);
  return km > CROSS_CITY_KM ? CROSS_CITY_PENALTY : 0;
}

function rankSaved(
  places: Place[],
  query: DecideQuery,
  seed: number,
  anchor: DeckAnchor | undefined
): Extract<DeckCard, { kind: "saved" }>[] {
  return rankPlaces(places, query, seed, { varietyWeight: 0 })
    .map((r) => {
      const approx = r.place.approxLocation === true;
      const measured = anchor ? distanceKm(anchor, r.place) : undefined;
      // What the card may show: a real pin's distance, never a guessed one's.
      const km = approx ? undefined : measured;
      const unrated = leadRating(r.place).value == null;
      let score = r.score;
      // "Unrated" is not a soft 3.5 here — a deck position is a claim about
      // quality. Watchlist, favourite, your own rating, recency and whatever
      // the lens matched all still count.
      if (unrated) score -= UNRATED_SAVED_SCORE;
      if (measured != null && !query.areaCenter) score -= savedDistancePenalty(measured, approx);
      // Nor does an unrated card get the ranker's "A solid shout" — that is
      // an endorsement, and beside "Unrated" it would be an invented one. With
      // nothing left the card falls back to its cuisine chips, which claim
      // nothing.
      const reasons = unrated ? r.reasons.filter((x) => x !== FALLBACK_REASON) : r.reasons;
      return { r, score, km, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ r, score, km, reasons }) => ({
      key: `saved:${r.place.id}`,
      kind: "saved" as const,
      place: r.place,
      score,
      reasons,
      ...(km != null ? { distanceKm: km } : {}),
    }));
}

// "Both" alternates the two sources' own orders — saved leads, because it is
// the half with your own evidence in it — rather than comparing their scores.
// The scales share a rating term and nothing else (watchlist alone is a flat
// +14 on one side), so a raw joint sort would just be saved-first in disguise.
function zipper<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

// Materialise the ordered deck for the current lens. Excludes the session
// `seen` set (left-dismissed or already-decided cards) so nothing resurfaces on
// a "start over" within the session. The order is a function of the lens and
// nothing else: `seed` still reaches rankPlaces for its signature's sake, but
// with the variety term at zero it changes nothing, so a card's position is
// the same on every run and the seen set is what "start over" resets.
export function buildDeck(opts: {
  source: DeckSource;
  places: Place[];
  query: DecideQuery;
  swiggy: SwiggyRestaurant[];
  seed: number;
  seen: Set<string>;
  newMemory?: NewSwipeMemory;
  anchor?: DeckAnchor;
}): DeckCard[] {
  const { source, places, query, swiggy, seed, seen, newMemory = {}, anchor } = opts;
  const unseen = (c: DeckCard) => !seen.has(c.key);

  const savedCards: DeckCard[] =
    source === "new" ? [] : rankSaved(places, query, seed, anchor).filter(unseen);

  // The provider index is the row's place in what search returned, BEFORE the
  // filters below — a row the lens drops still stood between its neighbours in
  // Swiggy's judgment, and the gap it leaves is part of that judgment.
  const newCards: DeckCard[] =
    source === "saved"
      ? []
      : swiggy
          .map((r, providerIndex) => ({ r, providerIndex }))
          .filter(({ r }) => !alreadySaved(r, places) && newMatches(r, query))
          .filter(({ r }) => !hasCuisine(r, query.excludeCuisines))
          .map(({ r, providerIndex }) => rankNew(r, providerIndex, query, newMemory))
          .sort((a, b) => b.score - a.score)
          .filter(unseen);

  if (source === "both") return zipper(savedCards, newCards);
  return source === "new" ? newCards : savedCards;
}
