import type { DecideQuery } from "./decide";

// ---------------------------------------------------------------------------
// The app's vocabulary → the terms Swiggy Dineout's search actually resolves.
//
// search_restaurants_dineout takes ONE free-text term and works out for itself
// whether it names a cuisine, an area, a kind of place or a vibe. Its own
// contract is explicit about the shape:
//
//   "pass the single thing the user is looking for, not their sentence"
//   "One term, not a sentence, and no location words when latitude/longitude
//    already cover the location"
//   "For a dish, search the cuisine that serves it ("dosa" becomes "South Indian")"
//
// What used to go in was a sentence built from a stopword-stripped bag of the
// user's words — "rooftop friends in Indiranagar", "quiet cafe work in
// Jayanagar", "take parents their anniversary". All three return zero rows.
// One junk token is enough: "rooftop in Indiranagar" returns 10, and
// "rooftop friends in Indiranagar" returns 0.
//
// Every term below was MEASURED against the live catalogue on 2026-08-30
// (Bangalore centre, limit 30) rather than guessed, because yield varies far
// more than the vocabulary suggests. The ones that failed and what replaced
// them:
//
//   "Pub"          2 rows  → `bar` sends "Bar" (30)
//   "Celebration"  3 rows  → `celebration` sends nothing
//   "Anniversary"  1 row   → never a term; keywords stay local (see below)
//   "Ramen"   1 row    → `ramen` sends "Japanese" (28)
//   "Tacos"   3 rows   → `tacos` sends "Mexican" (28)
//   "Burrito" 5 rows   → `burrito` sends "Mexican"
//
// A value with no entry sends nothing. That is deliberate: `museum`,
// `landmark`, `park-garden` and the rest of the non-eating half of the type
// vocabulary have no counterpart in a restaurant-booking catalogue, and
// `quiet` / `cozy` / `instagrammable` have no term Swiggy resolves. Sending a
// term it can't resolve is worse than sending none — it narrows the pool to
// noise instead of leaving it wide.
// ---------------------------------------------------------------------------

const TYPE_TERMS: Record<string, string> = {
  "café": "Cafe",
  bar: "Bar",
  dessert: "Desserts",
  "street-food": "Street Food",
  // `restaurant` deliberately absent — every row in this catalogue is one, so
  // it narrows nothing and costs a search slot.
};

const CUISINE_TERMS: Record<string, string> = {
  italian: "Italian",
  "south-indian": "South Indian",
  "north-indian": "North Indian",
  japanese: "Japanese",
  chinese: "Chinese",
  thai: "Thai",
  mexican: "Mexican",
  continental: "Continental",
  korean: "Korean",
  mughlai: "Mughlai",
};

// A dish is its own term when the catalogue knows it, and its cuisine when it
// doesn't — the doc's rule, kept honest by the measured counts above.
const STAPLE_TERMS: Record<string, string> = {
  pizza: "Pizza",
  pasta: "Pasta",
  burger: "Burger",
  burrito: "Mexican",
  tacos: "Mexican",
  dosa: "Dosa",
  biryani: "Biryani",
  ramen: "Japanese",
  sushi: "Sushi",
  noodles: "Noodles",
  sandwich: "Sandwich",
  momos: "Momos",
  wings: "Wings",
  shawarma: "Shawarma",
};

const VIBE_TERMS: Record<string, string> = {
  rooftop: "Rooftop",
  outdoor: "Outdoor Seating",
  lively: "Live Music",
  "fine-dining": "Fine Dining",
  romantic: "Romantic",
};

const PRACTICAL_TERMS: Record<string, string> = {
  vegetarian: "Pure Veg",
  "pet-friendly": "Pet Friendly",
  "late-night": "Late Night",
  groups: "Group Dining",
};

// Only the occasions the catalogue actually answers. Measured at Bangalore
// centre: "Family" 30, "Group Dining" 19, "Romantic" 28 — but "Celebration" 3,
// "Anniversary" 1, "Birthday" 0. So `celebration` maps to nothing rather than
// to a term that returns noise; the ask still narrows your OWN places, where
// the occasion tag means something.
const OCCASION_TERMS: Record<string, string> = {
  date: "Romantic",
  family: "Family",
  friends: "Group Dining",
};

// A vibe the catalogue tags loosely. Measured 2026-09-14 for "Romantic" at
// the Bengaluru centre: 28 rows, ten of them hotel fine dining and six of
// them rows Swiggy itself tags bar-food or fast-food — and nothing on a row
// says romantic, so the pool cannot be ranked on the ask alone. FACETS are
// sibling terms the catalogue resolves sharply; a row the ask returned that a
// facet search also lists is the core of the answer (13 of those 28: the
// hotel rooms and the terraces), and a row carrying an AVOID cuisine tag goes
// after every other. Facets are evidence, never eligibility: a Fine Dining
// row Swiggy did not call romantic is not in the deck, and a Romantic row no
// facet confirmed still is, after the confirmed ones. Keyed by the Swiggy
// term, so `date` (→ Romantic) gets the same treatment as `romantic`.
const VIBE_FACETS: Record<string, { facets: string[]; avoid: string[] }> = {
  romantic: { facets: ["Fine Dining", "Rooftop", "Outdoor Seating"], avoid: ["bar-food", "fast-food"] },
};

// The facets and avoid-tags for a set of ask terms — minus any facet the ask
// already sends as a term of its own.
export function facetsFor(terms: string[]): { facets: string[]; avoid: string[] } {
  const have = new Set(terms.map((t) => t.toLowerCase()));
  const facets: string[] = [];
  const avoid: string[] = [];
  for (const term of terms) {
    const entry = VIBE_FACETS[term.toLowerCase()];
    if (!entry) continue;
    for (const f of entry.facets) if (!have.has(f.toLowerCase()) && !facets.includes(f)) facets.push(f);
    for (const a of entry.avoid) if (!avoid.includes(a)) avoid.push(a);
  }
  return { facets, avoid };
}

// Most specific first: a dish beats a cuisine beats a kind of place beats a
// vibe. Swiggy returns ~30 rows per term whatever it is, so the ORDER decides
// what a small deck ends up being about.
const SOURCES: { key: keyof DecideQuery; table: Record<string, string> }[] = [
  { key: "staples", table: STAPLE_TERMS },
  { key: "cuisines", table: CUISINE_TERMS },
  { key: "types", table: TYPE_TERMS },
  { key: "vibes", table: VIBE_TERMS },
  { key: "practical", table: PRACTICAL_TERMS },
  { key: "occasions", table: OCCASION_TERMS },
];

const MAX_TERMS = 4;

// The half of the type vocabulary that is not on Dineout at all. A museum is
// not a restaurant Swiggy can't filter for — it is not in the catalogue — so
// an ask made only of these has no honest Swiggy answer, and the plan says so
// rather than browsing the locality's restaurants under a museum's name.
// Everything else that maps to no term (cozy, quiet, celebration, parking…)
// still browses: the catalogue HAS those places, it just can't index the
// attribute, and your own saved places carry that half of the lens.
const NOT_ON_DINEOUT = new Set([
  "museum",
  "landmark",
  "viewpoint",
  "park-garden",
  "activity",
  "theatre",
  "shopping",
]);

export interface SwiggySearchPlan {
  // The concept searches, most specific first. Never a sentence, never a
  // location word — the locality travels separately as `area` (and its geocoded
  // centre), and lib/swiggy.ts decides whether it earns a search of its own.
  // Measured: `query="Indiranagar"` at limit 30 returns 28 rows, all 28 in
  // Indiranagar — far better area coverage than a concept term at the area's
  // coordinates (`query="bar"` there returned 30 rows, 2 in Indiranagar).
  terms: string[];
  // Evidence searches for a loosely tagged vibe (facetsFor), within the same
  // four-search budget as the terms. lib/swiggy.ts runs them alongside and
  // lib/deck.ts ranks the ask's rows by how many confirmed each.
  facets?: string[];
  // Set — and `terms` empty — when the ask named only things Dineout does not
  // list (NOT_ON_DINEOUT). The deck makes no Swiggy call for it and says why
  // it is empty. Values as the lens wrote them, for that message.
  unsupported?: string[];
}

export function buildSearchPlan(query: DecideQuery, keywords?: string[]): SwiggySearchPlan {
  const terms: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k) || terms.length >= MAX_TERMS) return;
    seen.add(k);
    terms.push(t);
  };

  for (const { key, table } of SOURCES) {
    for (const v of (query[key] as string[] | undefined) ?? []) {
      const term = table[v];
      if (term) push(term);
    }
  }

  // Keywords deliberately do NOT become search terms.
  //
  // They are defined as free text "matched against the person's OWN notes", and
  // handing them to a restaurant catalogue is a category error with a measured
  // cost: "somewhere to take my parents for their anniversary" produced the
  // terms ["anniversary","parents"], and Swiggy answered with Sri Anniversary
  // Uphar, Wah Parantha and Parnisri Hotel — three real restaurants, none of
  // them an answer. The tool's own contract says as much: "An empty result
  // means nothing matched ... Never present unrelated restaurants as matches."
  //
  // So when the structured ask resolves to nothing Swiggy speaks, the search
  // stays wide (the locality, or simply what's nearby) and the keywords do
  // their job locally instead — lib/deck.ts scores them against each row's own
  // name, cuisines, description and highlights.
  void keywords;

  // Only things the catalogue does not hold: "museum in Jayanagar" must not
  // become Jayanagar's restaurants. A mixed ask still browses or searches —
  // "museum or a cafe" has a true term, "museum or a restaurant" has a
  // browsable one — and drops the museum to the saved side. Unsupported is
  // when EVERY type asked for is off the catalogue.
  if (terms.length === 0) {
    const types = query.types ?? [];
    if (types.length > 0 && types.every((v) => NOT_ON_DINEOUT.has(v))) {
      return { terms, unsupported: types };
    }
  }

  // Nothing to go on at all: an EMPTY list, on purpose. It used to push
  // "restaurants", which this catalogue answers as a NAME match (measured
  // 2026-09-14: 30 rows all called "…Restaurant", 11 unrated) — and because the
  // list was never empty, the locality default in components/SwipeMode.tsx
  // (`nearbyArea`) and the "Dinner" floor in lib/swiggy.ts could never fire.
  // An empty list is the signal that lets them: the client sends the locality
  // the nearest saved pins stand in, and the server falls back to a browsable
  // concept when no locality is known either.

  const facets = facetsFor(terms).facets.slice(0, Math.max(0, MAX_TERMS - terms.length));
  return facets.length ? { terms, facets } : { terms };
}
