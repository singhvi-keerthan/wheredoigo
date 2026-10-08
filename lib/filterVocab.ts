import { TAG_OPTIONS } from "./types";
import type { DeckSource } from "./deck";
import type { DecideQuery } from "./decide";
import { searchableOnSwiggy } from "./swiggyTerms";

// ---------------------------------------------------------------------------
// The deck's filter vocabulary — one list, shared by the first-open form and
// the deck's filter sheet, so the two can never drift into two languages.
//
// Each group is exactly one DecideQuery field, so what a chip says is what the
// ranker and the Swiggy planner receive. A group shows a SHORT list (the few
// values people reach for); the rest of its vocabulary is one search away.
// On a New deck a group only offers values Swiggy has a term for
// (searchableOnSwiggy) — a chip the catalogue search would silently ignore is
// the over-promise this editor exists to remove.
// ---------------------------------------------------------------------------

export type TagField = "cuisines" | "staples" | "types" | "vibes" | "practical" | "occasions";

export interface TagGroup {
  field: TagField;
  title: string;
  // Shown before any search. Ordered by what the measured catalogue answers
  // best (2026-10-07: cuisines and these moods return 28–30 rated rows at
  // Indiranagar, Koramangala and Whitefield; "Bar" returns name matches, so it
  // is not first).
  short: string[];
  all: string[];
}

export const TAG_GROUPS: TagGroup[] = [
  {
    field: "cuisines",
    title: "Cuisine",
    short: ["north-indian", "south-indian", "italian", "chinese", "japanese"],
    all: TAG_OPTIONS.cuisine,
  },
  {
    field: "staples",
    title: "Dish",
    short: ["biryani", "pizza", "burger", "dosa", "momos"],
    all: TAG_OPTIONS.staple,
  },
  {
    field: "types",
    title: "Kind of place",
    short: ["café", "dessert", "street-food", "bar", "restaurant"],
    all: TAG_OPTIONS.type,
  },
  {
    field: "vibes",
    title: "Vibe",
    short: ["rooftop", "lively", "outdoor", "fine-dining", "romantic"],
    all: TAG_OPTIONS.vibe,
  },
  {
    field: "practical",
    title: "Practical",
    short: ["vegetarian", "groups", "pet-friendly", "late-night", "parking"],
    all: TAG_OPTIONS.practical,
  },
  {
    field: "occasions",
    title: "Occasion",
    short: ["date", "friends", "family", "solo", "work"],
    all: TAG_OPTIONS.occasion,
  },
];

// Human labels. The stored values stay kebab-case (they are the tag vocabulary
// on every saved place); only the chip text changes.
const LABELS: Record<string, string> = {
  "north-indian": "North Indian",
  "south-indian": "South Indian",
  "street-food": "Street food",
  "park-garden": "Park or garden",
  lively: "Live music",
  outdoor: "Outdoor seating",
  "fine-dining": "Fine dining",
  vegetarian: "Pure veg",
  "vegan-options": "Vegan options",
  "reservation-needed": "Needs booking",
  "pet-friendly": "Pet friendly",
  "late-night": "Late night",
  groups: "Big groups",
  instagrammable: "Photogenic",
};

export function labelOf(value: string): string {
  if (LABELS[value]) return LABELS[value];
  const s = value.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// What a group may offer on this deck. Saved and Both offer the whole tag
// vocabulary (your own places carry every tag; on Both the saved half honours
// what Swiggy can't). New offers only what has a Swiggy term.
export function offerable(group: TagGroup, source: DeckSource): string[] {
  if (source !== "new") return group.all;
  return group.all.filter((v) => searchableOnSwiggy(group.field, v));
}

// The chips a group shows right now: its short list (what this deck can
// offer), plus anything already picked — a pick made through search must
// never vanish from view, or it can't be seen or cleared.
export function chipsFor(group: TagGroup, source: DeckSource, picked: string[]): string[] {
  const allowed = new Set(offerable(group, source));
  const shown = group.short.filter((v) => allowed.has(v));
  for (const p of picked) if (!shown.includes(p)) shown.push(p);
  return shown;
}

export type Suggestion =
  | { kind: "tag"; field: TagField; value: string; label: string; group: string }
  | { kind: "area"; value: string; label: string; group: string };

// Type-ahead across every group, plus the areas this deck actually holds.
// Prefix match on any word ("kor" → Koramangala, Korean; "ind" → North
// Indian, Indiranagar). Areas come from the pool the deck is drawing on, so a
// suggestion is always somewhere that has places — in whatever city the
// person is in. A typed area that isn't in the pool is offered as itself.
export function suggest(
  text: string,
  source: DeckSource,
  areas: string[],
  limit = 8
): Suggestion[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const hit = (label: string, value: string) =>
    [label, value.replace(/-/g, " ")].some((s) =>
      s
        .toLowerCase()
        .split(/[\s/]+/)
        .some((w) => w.startsWith(q))
    ) || label.toLowerCase().startsWith(q);

  const out: Suggestion[] = [];
  for (const a of areas) {
    if (hit(a, a)) out.push({ kind: "area", value: a, label: a, group: "Area" });
  }
  for (const g of TAG_GROUPS) {
    for (const v of offerable(g, source)) {
      const label = labelOf(v);
      if (hit(label, v)) out.push({ kind: "tag", field: g.field, value: v, label, group: g.title });
    }
  }
  const trimmed = out.slice(0, limit);
  const typed = text.trim();
  // Only when no area this deck knows matched — otherwise "kor" would offer
  // "Use “kor” as the area" right under Koramangala.
  const knownArea = out.some((s) => s.kind === "area");
  if (typed.length >= 3 && !knownArea) {
    trimmed.push({ kind: "area", value: typed, label: `Use “${typed}” as the area`, group: "Area" });
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// The lens's filter state, and the query it becomes.
// ---------------------------------------------------------------------------

export type Lifecycle = "any" | "favorites" | "watchlist" | "visited";

export type Filters = {
  lifecycle: Lifecycle;
  area: string;
  maxBudget: number | null;
  minRating: number | null;
  openNow: boolean;
} & Record<TagField, string[]>;

export const EMPTY_FILTERS: Filters = {
  lifecycle: "any",
  area: "",
  maxBudget: null,
  minRating: null,
  openNow: false,
  cuisines: [],
  staples: [],
  types: [],
  vibes: [],
  practical: [],
  occasions: [],
};

export function buildQuery(f: Filters): DecideQuery {
  const q: DecideQuery = { lifecycle: f.lifecycle };
  if (f.openNow) q.openNow = true;
  for (const g of TAG_GROUPS) if (f[g.field].length) q[g.field] = [...f[g.field]];
  if (f.area) q.area = f.area;
  if (f.maxBudget != null) q.maxBudget = f.maxBudget;
  if (f.minRating != null) q.minRating = f.minRating;
  return q;
}

export const BUDGETS = [500, 1000, 1500, 2500];
export const RATINGS = [3.5, 4, 4.5];

export const LIFECYCLES: { value: Lifecycle; label: string }[] = [
  { value: "any", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "watchlist", label: "Watchlist" },
  { value: "visited", label: "Been" },
];

// Every pick as a removable chip, in reading order — the deck's applied row.
export type Applied = { key: string; label: string; remove: (f: Filters) => Filters };

export function appliedOf(f: Filters): Applied[] {
  const out: Applied[] = [];
  if (f.lifecycle !== "any") {
    out.push({
      key: "lifecycle",
      label: LIFECYCLES.find((l) => l.value === f.lifecycle)?.label ?? f.lifecycle,
      remove: (x) => ({ ...x, lifecycle: "any" }),
    });
  }
  if (f.area) out.push({ key: "area", label: f.area, remove: (x) => ({ ...x, area: "" }) });
  for (const g of TAG_GROUPS) {
    for (const v of f[g.field]) {
      out.push({
        key: `${g.field}:${v}`,
        label: labelOf(v),
        remove: (x) => ({ ...x, [g.field]: x[g.field].filter((y) => y !== v) }),
      });
    }
  }
  if (f.maxBudget != null) {
    out.push({
      key: "maxBudget",
      label: `Under ₹${f.maxBudget.toLocaleString("en-IN")}`,
      remove: (x) => ({ ...x, maxBudget: null }),
    });
  }
  if (f.minRating != null) {
    out.push({ key: "minRating", label: `${f.minRating.toFixed(1)}+`, remove: (x) => ({ ...x, minRating: null }) });
  }
  if (f.openNow) out.push({ key: "openNow", label: "Open now", remove: (x) => ({ ...x, openNow: false }) });
  return out;
}

// What survives a switch to the New deck: only picks Swiggy can search for.
// Kept picks that New can't act on read as filters that do nothing — "Cozy"
// shown as applied over a deck it never touched. Your-places-only facts
// (lifecycle, Google hours) go too; switching back to Saved starts them fresh.
export function pruneFor(f: Filters, source: DeckSource): Filters {
  if (source !== "new") return f;
  const out: Filters = { ...f, lifecycle: "any", openNow: false };
  for (const g of TAG_GROUPS) out[g.field] = f[g.field].filter((v) => searchableOnSwiggy(g.field, v));
  return out;
}

// How many picks have a Swiggy term behind them — against the planner's cap
// (lib/swiggyTerms.ts MAX_TERMS), so the editor can say when some won't be
// searched instead of dropping them silently.
export function searchablePicks(f: Filters): number {
  return TAG_GROUPS.reduce((n, g) => n + f[g.field].filter((v) => searchableOnSwiggy(g.field, v)).length, 0);
}

export function toggleTag(f: Filters, field: TagField, value: string): Filters {
  const has = f[field].includes(value);
  return { ...f, [field]: has ? f[field].filter((v) => v !== value) : [...f[field], value] };
}
