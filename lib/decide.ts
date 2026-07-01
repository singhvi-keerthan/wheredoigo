import type { Place, TagNamespace } from "./types";
import { isOpenNow } from "./types";
import { leadRating } from "./format";

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
  occasions?: string[];
  vibes?: string[];
  practical?: string[];
  maxBudget?: number | null; // per person (₹)
  openNow?: boolean;
}

export interface Ranked {
  place: Place;
  score: number;
  reasons: string[];
}

export const EMPTY_QUERY: DecideQuery = { lifecycle: "any" };

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
  { ns: "occasion", key: "occasions" },
  { ns: "vibe", key: "vibes" },
  { ns: "practical", key: "practical" },
];

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

    // Budget hard cap — only when we actually know your spend.
    if (
      query.maxBudget != null &&
      p.myBudgetPerPerson != null &&
      p.myBudgetPerPerson > query.maxBudget
    ) {
      continue;
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

    if (open === true) {
      score += 4;
      if (reasons.length < 3) reasons.push("Open now");
    }

    // Variety — keeps "Another" lively without overpowering quality.
    score += rand() * 16;

    if (reasons.length === 0) reasons.push("A solid shout");
    out.push({ place: p, score, reasons: reasons.slice(0, 3) });
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}
