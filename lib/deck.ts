import type { Place } from "./types";
import type { SwiggyRestaurant } from "./swiggy";
import { rankPlaces, type DecideQuery } from "./decide";

// The swipe deck's source is the FIRST filter the user picks — before any
// cuisine lens. "saved" ranks your own map (the full DecideQuery vocabulary);
// "new" is Swiggy Dineout's catalog (cuisine-only — Swiggy records carry no
// type/staple/vibe/hours signal, so the richer lens can't bite there); "both"
// is your matches first, then new discovery.
export type DeckSource = "saved" | "new" | "both";

// One card, normalised over the two sources so the deck engine is source-blind.
// `kind` discriminates the action a swipe takes (a "new" right-swipe saves a
// fresh Place; a "saved" one is a no-op confirm — see SwipeDeck).
export type DeckCard =
  | { key: string; kind: "saved"; place: Place; reasons: string[] }
  | { key: string; kind: "new"; r: SwiggyRestaurant };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// A Swiggy result that's clearly already on your map (same-ish name within
// ~120m — the same rule findDuplicate uses). Dropped from New/Both so the deck
// never offers a "new" card for a place you already have. Kept local to avoid
// pulling the "use client" store into this pure module.
function alreadySaved(r: SwiggyRestaurant, places: Place[]): boolean {
  const rn = norm(r.name);
  return places.some((p) => {
    const near = Math.abs(p.lat - r.lat) < 0.0011 && Math.abs(p.lng - r.lng) < 0.0011;
    if (!near) return false;
    return norm(p.name) === rn || norm(p.name).includes(rn.slice(0, 5));
  });
}

// Materialise the ordered deck for the current lens. Excludes the session
// `seen` set (left-dismissed or already-decided cards) so nothing resurfaces on
// a reshuffle within the session. Saved order comes from the existing seeded
// ranker; New order is the Swiggy list as returned.
export function buildDeck(opts: {
  source: DeckSource;
  places: Place[];
  query: DecideQuery;
  swiggy: SwiggyRestaurant[];
  seed: number;
  seen: Set<string>;
}): DeckCard[] {
  const { source, places, query, swiggy, seed, seen } = opts;

  const savedCards: DeckCard[] =
    source === "new"
      ? []
      : rankPlaces(places, query, seed).map((r) => ({
          key: `saved:${r.place.id}`,
          kind: "saved" as const,
          place: r.place,
          reasons: r.reasons,
        }));

  const newCards: DeckCard[] =
    source === "saved"
      ? []
      : swiggy
          .filter((r) => !alreadySaved(r, places))
          .map((r) => ({ key: `new:${r.id}`, kind: "new" as const, r }));

  const merged =
    source === "both" ? [...savedCards, ...newCards] : source === "new" ? newCards : savedCards;

  return merged.filter((c) => !seen.has(c.key));
}
