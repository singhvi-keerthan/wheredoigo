import { TAG_OPTIONS } from "./types";
import type { DecideQuery } from "./decide";
import { keywordsFromText, STOPWORDS } from "./decide-prompt";
import { knownAreaFromText } from "./areas";
import { wordHits } from "./words";

// Local keyword parse — fallback when the /api/decide model route is
// unavailable (no key, rate limit, outage).
// Mirrors the model's guardrails: negated terms ("no bars", "not italian") go
// to exclude fields rather than inverting into positives, and "tonight" is not
// open-now. Lives in lib (not the component) so the eval harness can grade it.

const NEG_BEFORE = /\b(no|not|non|without|avoid|skip|except|hate|dislike)\b[\s\w-]{0,12}$/;

// Words people actually type for a value they'd never spell out. `park-garden`
// is the only one the current vocabulary needs: "a park nearby" contains
// neither the hyphenated nor the spaced form, so without this it matched
// nothing at all. Aliases run through the same wordHits matcher as everything
// else, so "parking" still doesn't match `park` — the guard this module was
// built around stays intact.
const ALIASES: Record<string, string[]> = {
  "park-garden": ["park", "garden"],
};

// Split matched vocabulary into wanted vs avoided by looking for a negation word
// just before each hit. Scans EVERY occurrence: any negated mention excludes;
// any plain mention includes (a value can legitimately end up in both).
// Hyphenated values also match their spaced form, so "fine dining" still finds
// `fine-dining` and "street food" still finds `street-food`.
function classify(vals: string[], t: string): { inc: string[]; exc: string[] } {
  const inc: string[] = [];
  const exc: string[] = [];
  for (const v of vals) {
    const spaced = v.replace(/-/g, " ");
    const forms = [v, ...(spaced === v ? [] : [spaced]), ...(ALIASES[v] ?? [])];
    const hits = forms.flatMap((f) => wordHits(t, f));
    if (!hits.length) continue;
    let negated = false;
    let plain = false;
    for (const i of hits) {
      if (NEG_BEFORE.test(t.slice(Math.max(0, i - 16), i))) negated = true;
      else plain = true;
    }
    if (negated) exc.push(v);
    if (plain) inc.push(v);
  }
  return { inc, exc };
}

// Words that name a KIND of place rather than a place. "best pizza in town"
// used to parse to area:"town", and an area is a HARD gate — the map then kept
// only the places whose locality happens to contain "town" (Benson Town, Cooke
// Town, Frazer Town) and dropped everything else. A phrase that named no
// neighbourhood emptied the map. Same for "in the city" and "in the area".
//
// Kept separate from STOPWORDS because these are perfectly good keywords
// elsewhere; they are only meaningless as a LOCALITY.
const NON_AREA = new Set([
  "town",
  "city",
  "area",
  "areas",
  "neighbourhood",
  "neighborhood",
  "centre",
  "center",
  "mood",
  "general",
  "here",
  "walking distance",
  "distance",
  "range",
  "budget",
]);

// "near jayanagar" / "around koramangala" / "in indiranagar" → the bare area
// name (max 3 words, stopword-led captures dropped: "in the mood" is not a place).
function parseArea(t: string): string | undefined {
  const known = knownAreaFromText(t);
  if (known) return known;

  const m = t.match(
    /\b(?:near|around|in)\s+([a-z][a-z\s-]{2,40}?)(?=\s+(?:under|below|max|upto|up to|rated|rating|stars?|with|for|and|open|not|no|without)\b|[,.!?]|$)/
  );
  if (!m) return undefined;
  const words = m[1].trim().split(/\s+/).slice(0, 3);
  while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop();
  if (!words.length || STOPWORDS.has(words[0])) return undefined;
  const name = words.join(" ");
  // A capture that is ONLY generic locality words names nothing. "south city"
  // still passes, because "south" is not in the set.
  if (words.every((w) => NON_AREA.has(w)) || NON_AREA.has(name)) return undefined;
  return name;
}

function parseBudget(t: string): number | undefined {
  const m = t.match(/(?:under|below|max|upto|up to|<)\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/);
  if (!m) return undefined;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * (m[2] ? 1000 : 1));
}

function parseRating(t: string): number | undefined {
  const hits = [
    ...t.matchAll(/\b(?:rated|rating|stars?)\s*(?:above|over|at least)?\s*(\d(?:\.\d)?)\s*\+?\b/g),
    ...t.matchAll(/\b(\d(?:\.\d)?)\s*\+?\s*(?:stars?|rating)\b/g),
  ];
  for (const m of hits) {
    const value = Number(m[1]);
    if (value > 0 && value <= 5) return value;
  }
  return undefined;
}

export function parseFallback(text: string): DecideQuery {
  // Normalise the US spelling onto the vocabulary's British one ("theaters" →
  // "theatres", still a hit via the plural rule above).
  const t = text.toLowerCase().replace(/theater/g, "theatre");
  const q: DecideQuery = { intent: text.trim().slice(0, 40), lifecycle: "any" };

  const fields: { ns: keyof typeof TAG_OPTIONS; inc: keyof DecideQuery; exc: keyof DecideQuery }[] = [
    { ns: "type", inc: "types", exc: "excludeTypes" },
    { ns: "cuisine", inc: "cuisines", exc: "excludeCuisines" },
    { ns: "staple", inc: "staples", exc: "excludeStaples" },
    { ns: "occasion", inc: "occasions", exc: "excludeOccasions" },
    { ns: "vibe", inc: "vibes", exc: "excludeVibes" },
    { ns: "practical", inc: "practical", exc: "excludePractical" },
  ];
  for (const { ns, inc, exc } of fields) {
    const { inc: want, exc: avoid } = classify(TAG_OPTIONS[ns], t);
    if (want.length) (q[inc] as string[]) = want;
    if (avoid.length) (q[exc] as string[]) = avoid;
  }

  // Coarse cheap/fancy → the fine-dining vibe (no invented rupee number).
  if (/\bcheap|affordable|budget\b/.test(t)) (q.excludeVibes = [...(q.excludeVibes ?? []), "fine-dining"]);
  if (/\bfancy|splurge|upscale\b/.test(t)) (q.vibes = [...(q.vibes ?? []), "fine-dining"]);

  if (/\bnew\b|never been|haven't been|untried/.test(t)) q.lifecycle = "watchlist";
  if (/favou?rite|go-?to|loved|usual/.test(t)) q.lifecycle = "favorites";
  if (/open now|right now|still open|open right/.test(t)) q.openNow = true;
  const budget = parseBudget(t);
  if (budget != null) q.maxBudget = budget;

  const rating = parseRating(t);
  if (rating != null) q.minRating = rating;

  const area = parseArea(t);
  if (area) q.area = area;

  // Quality asks → boostRatings (rank up on a private sub-rating dimension).
  const boost: string[] = [];
  if (/ambian|ambien|atmosphere/.test(t)) boost.push("ambiance");
  if (/delicious|tasty|amazing food|great food|best food|incredible food/.test(t)) boost.push("food");
  // `experience` is the non-food counterpart of `food` — see dimensionsFor().
  if (/worth (a )?(visit|seeing)|amazing to see|great day out|must see|must visit/.test(t)) boost.push("experience");
  if (/great service|good service|attentive|friendly staff/.test(t)) boost.push("service");
  if (/value for money|worth it|good value|great value|bang for buck/.test(t)) boost.push("value");
  if (boost.length) q.boostRatings = boost;

  // Distinctive free-text terms → matched against your notes by the ranker.
  // Never the area's own name: the area is already a hard gate on both decks,
  // so a keyword naming it matched every surviving card (its address is in the
  // haystack), scored each +15 and labelled each "Matches your ask" — the ask
  // it matched was its own locality. "museum in jayanagar" kept "jayanagar".
  const areaWords = new Set(area ? area.toLowerCase().split(/[^a-z0-9]+/) : []);
  const kw = keywordsFromText(text).filter((w) => !areaWords.has(w));
  if (kw.length) q.keywords = kw;

  return q;
}
