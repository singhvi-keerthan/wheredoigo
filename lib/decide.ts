import type { Place, TagNamespace, RatingDimension } from "./types";
import { isOpenNow } from "./types";
import { leadRating } from "./format";
import { distanceKm } from "./geo";

// ---------------------------------------------------------------------------
// Decide mode — "help me pick where to go tonight."
//
// Rule-based and deterministic given (places, query, seed). NO proximity in the
// logic by design. A query can be built from intent chips/toggles, or parsed
// from free text by the optional Gemini layer (/api/decide) — either way it
// lands here as a structured DecideQuery and the ranking stays local + honest.
// ---------------------------------------------------------------------------

export interface DecideQuery {
  intent?: string; // freeform label, for display only
  lifecycle?: "any" | "watchlist" | "visited" | "favorites";
  types?: string[]; // tag values from the "type" namespace
  cuisines?: string[];
  staples?: string[]; // "pizza", "dosa" — the specific-dish ask
  occasions?: string[];
  vibes?: string[];
  practical?: string[];
  // Hard negatives — "no bars", "not italian", "nothing too fancy". A place is
  // dropped entirely if it carries any excluded tag value. Kept namespace-parallel
  // to the positive fields so the model (and sanitizer) can mirror them 1:1.
  excludeTypes?: string[];
  excludeCuisines?: string[];
  excludeStaples?: string[];
  excludeOccasions?: string[];
  excludeVibes?: string[];
  excludePractical?: string[];
  maxBudget?: number | null; // per person (₹)
  // The standard "rated 4.0+" floor. Hard, and it reads your rating first —
  // same lead-rating rule the cards use. A place with no rating at all is not
  // KNOWN to clear the bar, so it's out; that's what the chip promises.
  minRating?: number | null;
  openNow?: boolean;
  // "near jayanagar" — the neighbourhood name, and the geocoded centroid the
  // client attaches before ranking. Two ways in, one field: Ask geocodes, so it
  // arrives with a centroid and gates by distance (beyond ~4km is a different
  // plan; closer floats higher). The area chip picks a locality that is already
  // in your places, so it arrives WITHOUT a centroid and gates by that name —
  // no round trip, and every option it offers is guaranteed to match something.
  area?: string;
  areaCenter?: { lat: number; lng: number };
  // Quality asks ("great ambiance", "good value") → rank places rated high on
  // these private sub-dimensions UP. Soft: never hides a place, just floats the
  // strong ones. Values are RatingDimension keys.
  boostRatings?: string[];
  // Distinctive free-text terms (a dish, a source like "insta", a descriptor)
  // that the controlled tags don't capture — matched against your own notes/name
  // on each place, so "the pizza place from insta" finds the one you noted that
  // about. From Gemini, or the keyword fallback.
  keywords?: string[];
}

export interface Ranked {
  place: Place;
  score: number;
  reasons: string[];
}

export const EMPTY_QUERY: DecideQuery = { lifecycle: "any" };

// Rough ₹/person per Google price level (Bengaluru-calibrated). Used ONLY as a
// budget-cap fallback when your own logged spend is unknown.
const PRICE_LEVEL_EST: Record<number, number> = { 0: 0, 1: 300, 2: 800, 3: 1500, 4: 2500 };

const AREA_MAX_KM = 4;

// Name-matched area. Two things make this looser than string equality.
//
// Localities nest ("Jayanagar" / "Jayanagar 4th Block"), so containment either
// way is a match; exact equality would make half the chips return nothing.
//
// And people spell them differently. Google says "Indira Nagar", Swiggy's prose
// says "Indiranagar", you'd type "Indra Nagar" — one place, three spellings, and
// nobody should have to guess which one our records happen to hold. So the
// comparison first strips everything that isn't a letter or digit (that alone
// kills spacing, case, hyphens and periods), and only if that fails does it
// allow a few character edits, which covers a dropped or doubled letter.
//
// Exported because the Swiggy half of the deck filters on the same rule
// (lib/deck.ts) and the two must not drift.
const normArea = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Words that name a KIND of locality rather than the locality. When two names
// end in the same one, it's shared boilerplate and the difference lives entirely
// in what's left — so "HSR Layout" vs "HBR Layout" is really "hsr" vs "hbr", and
// gets judged on that, not on the 6 identical characters trailing it. Without
// this they sit one edit apart and merge, and they are two different parts of
// Bengaluru. Same for "RT Nagar" / "RR Nagar".
const GENERIC = ["nagar", "layout", "colony", "town", "extension", "puram", "halli"];

// The edit budget, scaled to the shorter name. Short names get none, because on
// a 3-character name a single edit is most of the word: "HSR" and "HAL" are two
// apart and unrelated. Capped so long names don't become a free-for-all.
const editBudget = (len: number) => Math.min(2, Math.floor(len / 5));

// Edit distance between `needle` and the closest substring of `hay` (Sellers'
// free-start/free-end variant), so a misspelling still matches inside a longer
// nested name — "indranagar" against "indiranagar 1st stage". Area names run to
// a few dozen characters, so the full table is cheaper than being clever.
function approxContains(hay: string, needle: string, max: number): boolean {
  const n = hay.length;
  const m = needle.length;
  if (m === 0 || n === 0 || m > n + max) return false;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  const row = new Array<number>(m + 1);
  let best = m;
  for (let i = 1; i <= n; i++) {
    row[0] = 0; // free start — the match may begin anywhere in `hay`
    for (let j = 1; j <= m; j++) {
      const cost = hay.charCodeAt(i - 1) === needle.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    if (row[m] < best) best = row[m]; // free end — and it may stop anywhere
    prev = row.slice();
  }
  return best <= max;
}

export function areaMatches(placeArea: string | undefined, asked: string): boolean {
  if (!placeArea) return false;
  let a = normArea(placeArea);
  let b = normArea(asked);
  if (!a || !b) return false;
  // Spelled the same (allowing for nesting): done, no fuzz needed.
  if (a.includes(b) || b.includes(a)) return true;

  // Drop the shared generic word before measuring, so the budget is spent on the
  // part that actually names the place. Only when both carry the SAME one, and
  // never down to nothing.
  const shared = GENERIC.find((g) => a.endsWith(g) && b.endsWith(g));
  if (shared) {
    const [ta, tb] = [a.slice(0, -shared.length), b.slice(0, -shared.length)];
    if (ta && tb) {
      if (ta.includes(tb) || tb.includes(ta)) return true;
      [a, b] = [ta, tb];
    }
  }

  const [hay, needle] = a.length >= b.length ? [a, b] : [b, a];
  return approxContains(hay, needle, editBudget(needle.length));
}

// Seeded RNG (mulberry32) so "Another" is reproducible per seed but varies
// across presses — the variety is intentional, not random per render.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tagValues(p: Place, ns: TagNamespace): string[] {
  return p.tags.filter((t) => t.namespace === ns).map((t) => t.value);
}

// null = no preference set; true = matches one; false = preference set, no match.
function preference(p: Place, ns: TagNamespace, wanted?: string[]): boolean | null {
  if (!wanted || wanted.length === 0) return null;
  const have = tagValues(p, ns);
  return wanted.some((w) => have.includes(w));
}

const PREFS: { ns: TagNamespace; key: keyof DecideQuery }[] = [
  { ns: "type", key: "types" },
  { ns: "cuisine", key: "cuisines" },
  { ns: "staple", key: "staples" },
  { ns: "occasion", key: "occasions" },
  { ns: "vibe", key: "vibes" },
  { ns: "practical", key: "practical" },
];

const EXCLUDES: { ns: TagNamespace; key: keyof DecideQuery }[] = [
  { ns: "type", key: "excludeTypes" },
  { ns: "cuisine", key: "excludeCuisines" },
  { ns: "staple", key: "excludeStaples" },
  { ns: "occasion", key: "excludeOccasions" },
  { ns: "vibe", key: "excludeVibes" },
  { ns: "practical", key: "excludePractical" },
];

// A place is excluded when it carries any tag value the query said to avoid.
// The positive mirror of isExcluded, and deliberately NOT inside rankPlaces.
//
// rankPlaces gates on lifecycle, budget, rating, area and hard negatives, and
// treats cuisine/type/staple/occasion/vibe as SCORE. That is right for a deck:
// a weak match still deals, just later, and you can keep swiping. It is useless
// on a map, where order is invisible — asking for "italian" there and getting
// every pin back, silently reordered, reads as a broken control.
//
// So the map gates on the facets it asked for and the deck goes on ranking
// them. Same tag semantics as isExcluded (same namespaces, same tagValues), so
// "italian" cannot come to mean one thing on one surface and another elsewhere.
// Only namespaces the ask actually named are gated; keywords stay soft, because
// a hard gate on a free-text term would empty the map on any unusual word.
const POSITIVES: { ns: TagNamespace; key: keyof DecideQuery }[] = [
  { ns: "type", key: "types" },
  { ns: "cuisine", key: "cuisines" },
  { ns: "staple", key: "staples" },
  { ns: "occasion", key: "occasions" },
  { ns: "vibe", key: "vibes" },
  { ns: "practical", key: "practical" },
];

export function matchesAskedFacets(p: Place, query: DecideQuery): boolean {
  for (const { ns, key } of POSITIVES) {
    const want = query[key] as string[] | undefined;
    if (!want || !want.length) continue; // not asked for → not a constraint
    if (!tagValues(p, ns).some((v) => want.includes(v))) return false;
  }
  return true;
}

function isExcluded(p: Place, query: DecideQuery): boolean {
  for (const { ns, key } of EXCLUDES) {
    const avoid = query[key] as string[] | undefined;
    if (avoid && avoid.length && tagValues(p, ns).some((v) => avoid.includes(v))) {
      return true;
    }
  }
  return false;
}

export function rankPlaces(
  places: Place[],
  query: DecideQuery,
  seed: number,
  now: Date = new Date()
): Ranked[] {
  const rand = mulberry32(seed);
  const out: Ranked[] = [];

  for (const p of places) {
    if (p.neverAgain) continue; // never surface a place you've written off

    // Lifecycle gate.
    if (query.lifecycle === "watchlist" && p.status !== "watchlist") continue;
    if (query.lifecycle === "visited" && p.status !== "visited") continue;
    if (query.lifecycle === "favorites" && !p.favorite) continue;

    // Hard negatives — "no bars", "not italian", "nothing too fancy".
    if (isExcluded(p, query)) continue;

    // Budget hard cap. Your logged spend when known; otherwise a rough estimate
    // from Google's price level — budget asks mostly target watchlist places,
    // which never have a logged spend, so without the estimate the cap would
    // no-op exactly where it matters.
    if (query.maxBudget != null) {
      const spend =
        p.myBudgetPerPerson ??
        (p.googlePriceLevel != null ? PRICE_LEVEL_EST[p.googlePriceLevel] ?? null : null);
      if (spend != null && spend > query.maxBudget) continue;
    }

    // Rating floor. Your rating leads once visited, exactly as it does on the
    // card — asking for 4.0+ shouldn't be answered with Google's opinion of a
    // place you've been to and scored yourself.
    if (query.minRating != null) {
      const lead = leadRating(p);
      if (lead.value == null || lead.value < query.minRating) continue;
    }

    // Area constraint. A geocoded centroid is the stronger signal and wins when
    // it's there: outside ~4km of the asked neighbourhood is a different plan,
    // inside, closer floats higher. A bare name falls back to the locality.
    let areaDist: number | null = null;
    if (query.areaCenter) {
      areaDist = distanceKm(query.areaCenter, p);
      if (areaDist > AREA_MAX_KM) continue;
    } else if (query.area) {
      if (!areaMatches(p.area, query.area)) continue;
    }

    // Open-now: exclude only when we KNOW the hours and it's shut.
    const open = isOpenNow(p.openingPeriods, now);
    if (query.openNow && open === false) continue;

    const reasons: string[] = [];
    let score = 0;

    // Rating leads (your rating once visited, else Google's).
    const r = leadRating(p);
    if (r.value != null) {
      score += r.value * 8;
      if (r.value >= 4.5) {
        reasons.push(r.mine ? `You rated it ${r.value.toFixed(1)}` : `${r.value.toFixed(1)} on Google`);
      }
    } else {
      score += 28; // unknown ≈ a soft 3.5
    }

    // Discovery bias — a going-out brain should nudge you somewhere new.
    if (p.status === "watchlist") {
      score += 14;
      reasons.push("On your watchlist");
    }
    if (p.favorite) {
      score += 12;
      reasons.push("A place you love");
    }

    // Novelty — cool off places you just went to; revive long-dormant ones.
    if (p.visits.length) {
      const last = Math.max(...p.visits.map((v) => +new Date(v.visitedOn)));
      const days = (now.getTime() - last) / 86_400_000;
      if (days < 21) score -= 14;
      else if (days > 120) {
        score += 6;
        reasons.push("Been a while");
      }
    }

    // Preference matches (soft but strong — set chips steer, don't hard-filter).
    for (const { ns, key } of PREFS) {
      const m = preference(p, ns, query[key] as string[] | undefined);
      if (m === true) {
        score += 18;
        const hit = (query[key] as string[]).find((w) => tagValues(p, ns).includes(w));
        if (hit && reasons.length < 3) reasons.push(`Good for ${hit}`);
      } else if (m === false) {
        score -= 10;
      }
    }

    // Quality boost — a place rated high on an asked dimension floats up. Soft
    // (additive), so nothing is filtered out; a small library still returns.
    if (query.boostRatings?.length && p.ratings) {
      for (const dim of query.boostRatings) {
        const v = p.ratings[dim as RatingDimension];
        if (typeof v === "number") {
          score += v * 6; // 5★ ≈ +30, on par with a strong preference match
          if (v >= 4 && reasons.length < 3) reasons.push(`Great ${dim}`);
        }
      }
    }

    // Note/keyword match — the most specific signal there is: it's literally the
    // reason you saved the place. Matched against your own note + the name +
    // Google's lowdown (so "pizza" finds a place whose research mentions it).
    if (query.keywords?.length) {
      const hay = `${p.notes} ${p.name} ${p.summary ?? ""}`.toLowerCase();
      let hits = 0;
      for (const kw of query.keywords) if (kw.length >= 3 && hay.includes(kw)) hits++;
      if (hits) {
        score += Math.min(hits, 3) * 15;
        if (reasons.length < 3) reasons.push("Matches your note");
      }
    }

    if (open === true) {
      score += 4;
      if (reasons.length < 3) reasons.push("Open now");
    }

    // Proximity bonus inside the asked area (max +24 at the centroid).
    if (areaDist != null) {
      score += (AREA_MAX_KM - areaDist) * 6;
      if (areaDist <= 2.5 && query.area && reasons.length < 3) {
        reasons.push(`Near ${query.area}`);
      }
    }

    // Variety — keeps "Another" lively without overpowering quality (~half a
    // rating star of noise; was 16, which let a 3★ outshuffle a 5★).
    score += rand() * 8;

    if (reasons.length === 0) reasons.push("A solid shout");
    out.push({ place: p, score, reasons: reasons.slice(0, 3) });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
