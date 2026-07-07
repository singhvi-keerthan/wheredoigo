import { TAG_OPTIONS } from "./types";
import type { DecideQuery } from "./decide";
import { keywordsFromText, STOPWORDS } from "./decide-prompt";

// Local keyword parse — fallback when the Gemini NL route is unavailable.
// Mirrors the model's guardrails: negated terms ("no bars", "not italian") go
// to exclude fields rather than inverting into positives, and "tonight" is not
// open-now. Lives in lib (not the component) so the eval harness can grade it.

const NEG_BEFORE = /\b(no|not|non|without|avoid|skip|except|hate|dislike)\b[\s\w-]{0,12}$/;

// Split matched vocabulary into wanted vs avoided by looking for a negation word
// just before each hit. Scans EVERY occurrence: any negated mention excludes;
// any plain mention includes (a value can legitimately end up in both).
function classify(vals: string[], t: string): { inc: string[]; exc: string[] } {
  const inc: string[] = [];
  const exc: string[] = [];
  for (const v of vals) {
    const needle = t.includes(v) ? v : t.includes(v.replace("-", " ")) ? v.replace("-", " ") : null;
    if (!needle) continue;
    let negated = false;
    let plain = false;
    for (let i = t.indexOf(needle); i !== -1; i = t.indexOf(needle, i + 1)) {
      if (NEG_BEFORE.test(t.slice(Math.max(0, i - 16), i))) negated = true;
      else plain = true;
    }
    if (negated) exc.push(v);
    if (plain) inc.push(v);
  }
  return { inc, exc };
}

// "near jayanagar" / "around koramangala" / "in indiranagar" → the bare area
// name (max 3 words, stopword-led captures dropped: "in the mood" is not a place).
function parseArea(t: string): string | undefined {
  const m = t.match(/\b(?:near|around|in)\s+([a-z][a-z\s-]{2,30})/);
  if (!m) return undefined;
  const words = m[1].trim().split(/\s+/).slice(0, 3);
  while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop();
  if (!words.length || STOPWORDS.has(words[0])) return undefined;
  return words.join(" ");
}

export function parseFallback(text: string): DecideQuery {
  const t = text.toLowerCase();
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
  const budget = t.match(/(?:under|below|max|upto|up to|<)\s*₹?\s*(\d{2,5})/);
  if (budget) q.maxBudget = +budget[1];

  const area = parseArea(t);
  if (area) q.area = area;

  // Quality asks → boostRatings (rank up on a private sub-rating dimension).
  const boost: string[] = [];
  if (/ambian|ambien|atmosphere/.test(t)) boost.push("ambiance");
  if (/delicious|tasty|amazing food|great food|best food|incredible food/.test(t)) boost.push("food");
  if (/great service|good service|attentive|friendly staff/.test(t)) boost.push("service");
  if (/value for money|worth it|good value|great value|bang for buck/.test(t)) boost.push("value");
  if (boost.length) q.boostRatings = boost;

  // Distinctive free-text terms → matched against your notes by the ranker.
  const kw = keywordsFromText(text);
  if (kw.length) q.keywords = kw;

  return q;
}
