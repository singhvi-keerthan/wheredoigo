import type { Place } from "./types";
import type { SwiggyRestaurant } from "./swiggy";
import { areaMatches, rankPlaces, type DecideQuery } from "./decide";
import { newSwipeAffinity, PER_PERSON, type NewSwipeMemory } from "./swipeMemory";

// The swipe deck's source is the FIRST filter the user picks — before any
// cuisine lens. "saved" ranks your own map (the full DecideQuery vocabulary);
// "new" is Swiggy Dineout's catalog (cuisine + the standard area/budget/rating
// filters — see newMatches; Swiggy records carry no type/staple/vibe/hours
// signal, so only the tag half of the lens can't bite there); "both"
// is your matches first, then new discovery.
export type DeckSource = "saved" | "new" | "both";

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

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
export type DeckCard =
  | { key: string; kind: "saved"; place: Place; reasons: string[] }
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

type RankedNewCard = Extract<DeckCard, { kind: "new" }> & { affinity: number };

function rankNew(
  r: SwiggyRestaurant,
  q: DecideQuery,
  rand: () => number,
  memory: NewSwipeMemory
): RankedNewCard {
  const reasons: string[] = [];
  let score = 0;
  const affinity = newSwipeAffinity(memory, r);

  if (q.area && areaMatches(r.area, q.area)) {
    score += 16;
    addReason(reasons, `Near ${q.area}`);
  }

  const cuisineHit = q.cuisines?.find((wanted) => r.cuisines.some((have) => termMatches(have, wanted)));
  if (cuisineHit) {
    score += 18;
    addReason(reasons, `${display(cuisineHit)} match`);
  }

  if (q.keywords?.length) {
    const hay = newText(r);
    const hits = q.keywords.filter((kw) => kw.length >= 3 && hay.includes(kw.toLowerCase())).length;
    if (hits > 0) {
      score += Math.min(hits, 3) * 12;
      addReason(reasons, "Matches your ask");
    }
  }

  if (q.maxBudget != null) {
    if (r.priceForTwo != null) {
      const perHead = r.priceForTwo / PER_PERSON;
      const spare = Math.max(0, q.maxBudget - perHead);
      score += 12 + Math.min(8, (spare / Math.max(q.maxBudget, 1)) * 8);
      addReason(reasons, `Under ₹${q.maxBudget.toLocaleString("en-IN")}/head`);
    } else {
      score += 4;
    }
  } else if (r.priceForTwo != null) {
    const perHead = r.priceForTwo / PER_PERSON;
    if (perHead <= 1000) score += 8;
    else if (perHead <= 1500) score += 5;
  }

  if (r.rating != null) {
    score += r.rating * 8;
    if (r.rating >= (q.minRating ?? 4.2)) addReason(reasons, `${r.rating.toFixed(1)} on Swiggy`);
  } else {
    score += 24; // unknown ~= a soft 3.0; visible, but not a quality lead
  }

  if (r.photo || r.photos?.length) score += 3;
  if (r.description || r.highlights?.length) score += 2;
  if (r.offers?.length) score += 1;

  const memoryScore = Math.max(-18, Math.min(18, affinity * 5));
  score += memoryScore;
  if (affinity >= 1) addReason(reasons, "Matches your swipes");

  // Same role as rankPlaces' variety term: enough exploration to avoid a dead
  // provider-order list, not enough to let weak matches jump strong ones.
  score += rand() * 6;

  if (reasons.length === 0) addReason(reasons, "New on Swiggy");
  return { key: `new:${r.id}`, kind: "new", r, score, reasons, affinity };
}

function toNewCard(card: RankedNewCard): Extract<DeckCard, { kind: "new" }> {
  return { key: card.key, kind: "new", r: card.r, score: card.score, reasons: card.reasons };
}

function withExplorationReserve(cards: RankedNewCard[]): Extract<DeckCard, { kind: "new" }>[] {
  const used = new Set<string>();
  const out: RankedNewCard[] = [];

  for (let slot = 0; slot < cards.length; slot += 1) {
    const reserve = (slot + 1) % 5 === 0;
    const pick =
      (reserve ? cards.find((c) => !used.has(c.key) && c.affinity <= 0) : null) ??
      cards.find((c) => !used.has(c.key));
    if (!pick) break;
    used.add(pick.key);
    out.push(pick);
  }

  return out.map(toNewCard);
}

// Materialise the ordered deck for the current lens. Excludes the session
// `seen` set (left-dismissed or already-decided cards) so nothing resurfaces on
// a reshuffle within the session. Saved order comes from the existing seeded
// ranker; New order is scored locally over the fields Swiggy actually returns.
export function buildDeck(opts: {
  source: DeckSource;
  places: Place[];
  query: DecideQuery;
  swiggy: SwiggyRestaurant[];
  seed: number;
  seen: Set<string>;
  newMemory?: NewSwipeMemory;
}): DeckCard[] {
  const { source, places, query, swiggy, seed, seen, newMemory = {} } = opts;

  const savedCards: DeckCard[] =
    source === "new"
      ? []
      : rankPlaces(places, query, seed).map((r) => ({
          key: `saved:${r.place.id}`,
          kind: "saved" as const,
          place: r.place,
          reasons: r.reasons,
        }));

  const newRand = mulberry32(seed);
  const newCards: DeckCard[] =
    source === "saved"
      ? []
      : withExplorationReserve(
          swiggy
            .filter((r) => !alreadySaved(r, places) && newMatches(r, query))
            .filter((r) => !hasCuisine(r, query.excludeCuisines))
            .map((r) => rankNew(r, query, newRand, newMemory))
            .sort((a, b) => b.score - a.score)
        );

  const merged =
    source === "both" ? [...savedCards, ...newCards] : source === "new" ? newCards : savedCards;

  return merged.filter((c) => !seen.has(c.key));
}
