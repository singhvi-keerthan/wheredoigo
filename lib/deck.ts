import type { Place } from "./types";
import type { SwiggyRestaurant } from "./swiggy";
import {
  areaMatches,
  rankPlaces,
  FALLBACK_REASON,
  UNRATED_SAVED_SCORE,
  type DecideQuery,
} from "./decide";
import { distanceKm, parseDistanceKm } from "./geo";
import { leadRating } from "./format";
import { hasWord } from "./words";
import { facetsFor } from "./swiggyTerms";
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
  | { key: string; kind: "new"; r: SwiggyRestaurant; score: number; reasons: string[]; distanceKm?: number };

// The locality to browse when the lens names none. Swiggy's search answers a
// locality with that locality — measured 2026-09-14 at the Bengaluru centre,
// "Ashok Nagar" returned 30 rows, 28 rated, none farther than 2.4km — where
// its old placeholder, "restaurants", answered with the 30 places NAMED
// Restaurant, a third of them unrated. Your own map already knows which
// locality you are standing in: it is the area your nearest saved pins carry.
// Pins whose position is a guess (approxLocation) are skipped — their area is
// real but their position is not. Nothing within 3km → no locality, and the
// search falls back to its broad term (DEFAULT_SEARCH_TERM).
export function nearbyArea(places: Place[], at: { lat: number; lng: number }): string | undefined {
  const NEAR_KM = 3;
  const votes = new Map<string, { n: number; nearest: number }>();
  for (const p of places) {
    if (!p.area?.trim() || p.approxLocation || p.deletedAt) continue;
    const km = distanceKm(at, p);
    if (km > NEAR_KM) continue;
    const v = votes.get(p.area) ?? { n: 0, nearest: Infinity };
    votes.set(p.area, { n: v.n + 1, nearest: Math.min(v.nearest, km) });
  }
  let best: { area: string; n: number; nearest: number } | null = null;
  for (const [area, v] of votes) {
    if (!best || v.n > best.n || (v.n === best.n && v.nearest < best.nearest)) best = { area, ...v };
  }
  return best?.area;
}

// A deck freezes its ranking for the session, but photo bytes do not arrive on
// that schedule: localStorage yields the records first, then IndexedDB (or the
// sync download) fills each Photo.dataUrl. Refresh only that display payload so
// a Saved card can gain or lose pictures without changing its place in the
// stack, its reasons, or any swipe state held by SwipeMode.
export function refreshSavedCardPhotos(deck: DeckCard[], places: Place[]): DeckCard[] {
  const latest = new Map(places.map((place) => [place.id, place]));
  let changed = false;
  const refreshed = deck.map((card) => {
    if (card.kind !== "saved") return card;
    const place = latest.get(card.place.id);
    if (!place || place.photos === card.place.photos) return card;
    changed = true;
    return { ...card, place: { ...card.place, photos: place.photos } };
  });
  return changed ? refreshed : deck;
}

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

// A row's evidence for one of the terms Swiggy was asked: that term's own
// search returned it (matchedTerms — provenance kept through the merge), or
// the row says so itself in its cuisines, name or highlights. The second is
// what lets a row the LOCALITY top-up found into a "Desserts" deck at all: it
// is there because it is in Jayanagar, and it stays only if it is a dessert
// place too.
// Only the fields that SAY what a place is — never its address, description
// or offers, where "bar" in a happy-hour deal would qualify a row as a bar.
function evidenceText(r: SwiggyRestaurant): string {
  return [r.name, r.area, ...r.cuisines, ...(r.highlights ?? [])].join(" ").toLowerCase();
}

function evidences(r: SwiggyRestaurant, term: string): boolean {
  const t = term.toLowerCase();
  if (r.matchedTerms?.some((m) => m.toLowerCase() === t)) return true;
  return hasWord(evidenceText(r), t);
}

// "Fine Dining" the search term becomes "Fine dining" the reason.
function facetLabel(facet: string): string {
  return facet.charAt(0).toUpperCase() + facet.slice(1).toLowerCase();
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
// A New card scores the way a saved one does — its rating, less how far it is
// — because a Swiggy row turns out to carry exactly those two things: a
// rating, and a distance string from the coordinates the search ran at ("5.4
// km", "13.9 km"), on every row of the batched render. Measured 2026-09-14 on
// the live catalogue; no details call needed. (Search ORDER, which the version
// before this one leaned on, turned out to be a name match for the old default
// term, and is trusted for nothing now beyond breaking ties.)
//
//   score = rating × 8              unrated → 0: no synthetic quality
//         − distancePenalty(km)     the saved deck's own table; a row with no
//                                   readable distance is charged the pool's
//                                   median, never nothing
//         + 15 on a keyword hit     the most specific thing you asked for
//         ± up to 4 on swipe history   half a star, however strong the memory
//
// Nothing scores for being cheap (budget is a hard filter when asked and
// otherwise not a virtue), for photos or an offer (completeness is not
// quality), or for a random draw. The reproduced failure — a cheap,
// well-photographed 3.7★ eleven kilometres out with one matching swipe over a
// 4.5★ down the road — now scores 20.8 against 36: the right way round, by a
// margin no nudge can close.

const KEYWORD_POINTS = 15;
const SWIPE_POINTS = 4;

// Two net-positive swipes on the same cuisine or locality before a card may
// name your history as its reason. One swipe is a data point, not a taste,
// and a price band is too coarse to be one at all. The score still moves by
// up to half a star on any evidence; this gates only what the card SAYS.
function matchesYourSwipes(memory: NewSwipeMemory, r: SwiggyRestaurant): boolean {
  return newSwipeAttributeKeys(r).some(
    (key) => (key.startsWith("cuisine:") || key.startsWith("area:")) && (memory[key] ?? 0) >= 2
  );
}

// The upper-middle element on an even count — a distance a real row in the
// pool actually has, rather than an average of two. Only ever a stand-in
// penalty for a row Swiggy sent without a distance; nothing else reads it.
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rankNew(
  r: SwiggyRestaurant,
  q: DecideQuery,
  memory: NewSwipeMemory,
  fallbackKm: number | undefined,
  terms: string[],
  hit: string[],
  facet: string[] = []
): Extract<DeckCard, { kind: "new" }> {
  const reasons: string[] = [];
  // What the ask was, said first — on every card, so a bar in a romantic deck
  // at least says why it is there. A full match names the terms; a partial one
  // names what is UNCONFIRMED — not "not": the Rooftop search simply did not
  // list it, and its own text did not say North Indian either.
  if (terms.length >= 1) {
    const missing = terms.filter((t) => !hit.includes(t));
    addReason(reasons, missing.length === 0 ? terms.join(" + ") : `${missing.join(" & ")} unconfirmed`);
  }
  // Then the facets that confirmed it (lib/swiggyTerms.ts) — the evidence the
  // ask's own tag could not give.
  for (const f of facet) addReason(reasons, facetLabel(f));
  let score = (r.rating ?? 0) * 8;

  const km = parseDistanceKm(r.distance);
  const charged = km ?? fallbackKm;
  if (charged != null) score -= distancePenalty(charged);

  // Named, not scored: the area is a filter (newMatches) and the cuisine is
  // the search term, so both are already true of every card in the pool.
  if (q.area && areaMatches(r.area, q.area)) addReason(reasons, `Near ${q.area}`);
  const cuisineHit = q.cuisines?.find((wanted) => r.cuisines.some((have) => termMatches(have, wanted)));
  if (cuisineHit) addReason(reasons, `${display(cuisineHit)} match`);

  if (q.keywords?.length) {
    const hay = newText(r);
    // Whole words, the saved deck's own matcher: `includes` let "bar" score
    // Barbeque Nation, which was a nudge at 2 points and a decision at 15.
    if (q.keywords.some((kw) => kw.length >= 3 && hasWord(hay, kw.toLowerCase()))) {
      score += KEYWORD_POINTS;
      addReason(reasons, "Matches your ask");
    }
  }

  if (q.maxBudget != null && r.priceForTwo != null && r.priceForTwo / PER_PERSON <= q.maxBudget) {
    addReason(reasons, `Under ₹${q.maxBudget.toLocaleString("en-IN")}/head`);
  }

  if (r.rating != null && r.rating >= (q.minRating ?? 4.2)) {
    addReason(reasons, `${r.rating.toFixed(1)} on Swiggy`);
  }

  score += Math.max(-1, Math.min(1, newSwipeAffinity(memory, r))) * SWIPE_POINTS;
  if (matchesYourSwipes(memory, r)) addReason(reasons, "Matches your swipes");

  if (reasons.length === 0) addReason(reasons, "New on Swiggy");
  return { key: `new:${r.id}`, kind: "new", r, score, reasons, ...(km != null ? { distanceKm: km } : {}) };
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
  // The concept terms Swiggy was actually searched for (the plan's terms that
  // ran — never the locality). Empty on a browse, where every row is eligible.
  terms?: string[];
  // The facet searches that ran for those terms (lib/swiggyTerms.ts): evidence
  // that orders the eligible rows, never a condition of being one.
  facets?: string[];
}): DeckCard[] {
  const { source, places, query, swiggy, seed, seen, newMemory = {}, anchor } = opts;
  const terms = (opts.terms ?? []).filter(Boolean);
  const facets = (opts.facets ?? []).filter(Boolean);
  const { avoid } = facetsFor(terms);
  const unseen = (c: DeckCard) => !seen.has(c.key);

  const savedCards: DeckCard[] =
    source === "new" ? [] : rankSaved(places, query, seed, anchor).filter(unseen);

  // Search order survives only as the tie-break (the sort is stable). A row
  // Swiggy sent without a readable distance is charged the pool's median: on a
  // locality search that is a kilometre or two, on a concept search whatever
  // the page spans — either way not the free pass "no penalty" would be.
  const fallbackKm = median(
    swiggy.map((r) => parseDistanceKm(r.distance)).filter((d): d is number => d != null)
  );
  // Coverage of the asked terms comes BEFORE rating and distance: with terms
  // to check, a row that evidences none of them is not in the deck at all
  // (it is what the locality top-up swept in, and "in Jayanagar" is not "a
  // dessert place in Jayanagar"); a row that evidences all of them outranks
  // every row that evidences some, however well the partial one scores; the
  // partial ones follow, as the explicitly weaker fallback, each saying what
  // it did not confirm. On a browse there is nothing to cover.
  const newCards: DeckCard[] =
    source === "saved"
      ? []
      : swiggy
          .filter((r) => !alreadySaved(r, places) && newMatches(r, query))
          .filter((r) => !hasCuisine(r, query.excludeCuisines))
          .map((r) => ({
            r,
            hit: terms.filter((t) => evidences(r, t)),
            facet: facets.filter((f) => evidences(r, f)),
            avoided: avoid.length > 0 && r.cuisines.some((c) => avoid.includes(c.toLowerCase())),
          }))
          .filter(({ hit }) => terms.length === 0 || hit.length > 0)
          .map(({ r, hit, facet, avoided }) => ({
            card: rankNew(r, query, newMemory, fallbackKm, terms, hit, facet),
            // How many of the asked terms it did NOT evidence: 0 is a full
            // match; among partials, two of three confirmed beats one.
            tier: terms.length - hit.length,
            avoided,
            confirmed: facet.length,
          }))
          // Ask coverage first. Then what the ask's own tag could not say: a
          // row Swiggy tags with a cuisine the vibe avoids goes after every
          // other, and among the rest the rows a facet confirmed lead. Rating
          // and distance order only what is left equal.
          .sort(
            (a, b) =>
              a.tier - b.tier ||
              Number(a.avoided) - Number(b.avoided) ||
              b.confirmed - a.confirmed ||
              b.card.score - a.card.score
          )
          .map((x) => x.card)
          .filter(unseen);

  if (source === "both") return zipper(savedCards, newCards);
  return source === "new" ? newCards : savedCards;
}
