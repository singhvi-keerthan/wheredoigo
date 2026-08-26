"use client";

import { useMemo, useState } from "react";
import { X, Sparkles, RefreshCw, ChevronDown, Clock } from "lucide-react";
import { geocodeArea } from "@/lib/places";
import { parseFallback } from "@/lib/decide-fallback";
import { rankPlaces, type DecideQuery } from "@/lib/decide";
import { TAG_OPTIONS } from "@/lib/types";
import { usePlaces } from "@/lib/store";
import type { DeckSource } from "@/lib/deck";

// The lens — what the deck is looking at. This used to be a whole sheet you
// passed THROUGH to reach the deck; swipe is a mode now, not something you
// arrive at, so the lens travels with it as a panel the mode opens on itself.
// State lives in the hook so the mode keeps its lens while the panel is shut.

type FilterField =
  | "lifecycle"
  | "area"
  | "cuisine"
  | "maxBudget"
  | "minRating"
  | "type"
  | "staple"
  | "occasion"
  | "vibe"
  | "practical";
type Category = { id: FilterField; label: string; values: { value: string; label: string }[] };

const opt = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));

// ---- the standard four --------------------------------------------------
// Where, what, how much, how good — what every delivery and booking app puts
// in front of you, and the only filters that bite on BOTH sources, so they sit
// in their own row above the tag lens and show for every source.
//
// Area is the odd one: its values aren't a fixed vocabulary, they're the
// localities actually present in the pool you're swiping (see the `areas`
// prop). That way every option returns something, and there's no free-text box
// competing with Ask, which already handles "near koramangala" — and geocodes.
const CUISINE_CAT: Category = { id: "cuisine", label: "Cuisine", values: opt(TAG_OPTIONS.cuisine) };
// Per person, and pinned to the same rupee ladder decide.ts estimates Google's
// price levels onto (300/800/1500/2500) — a rung between two levels would filter
// on a distinction the underlying data can't actually make.
const BUDGET_CAT: Category = {
  id: "maxBudget",
  label: "Budget",
  values: [500, 1000, 1500, 2500].map((n) => ({
    value: String(n),
    label: `Under ₹${n.toLocaleString("en-IN")}`,
  })),
};
const RATING_CAT: Category = {
  id: "minRating",
  label: "Rating",
  values: [3.5, 4, 4.5].map((n) => ({ value: String(n), label: `${n.toFixed(1)}+` })),
};

// ---- the tag lens -------------------------------------------------------
// Your own vocabulary, so it only appears when your own places are the deck.
// "Show" is the lifecycle lens.
const TAG_CATS: Category[] = [
  {
    id: "lifecycle",
    label: "Show",
    values: [
      { value: "any", label: "All" },
      { value: "favorites", label: "Favorites" },
      { value: "watchlist", label: "Watchlist" },
      { value: "visited", label: "Been" },
    ],
  },
  { id: "type", label: "Type", values: opt(TAG_OPTIONS.type) },
  { id: "staple", label: "Staple", values: opt(TAG_OPTIONS.staple) },
  { id: "occasion", label: "Occasion", values: opt(TAG_OPTIONS.occasion) },
  { id: "vibe", label: "Vibe", values: opt(TAG_OPTIONS.vibe) },
  { id: "practical", label: "Practical", values: opt(TAG_OPTIONS.practical) },
];

// The two numeric filters live here as numbers, not as the chip's string value,
// so buildQuery hands decide.ts and buildDeck the same shape Ask does.
type Filters = {
  lifecycle: "any" | "favorites" | "watchlist" | "visited";
  area: string;
  cuisine: string;
  maxBudget: number | null;
  minRating: number | null;
  type: string;
  staple: string;
  occasion: string;
  vibe: string;
  practical: string;
  openNow: boolean;
};
const EMPTY_FILTERS: Filters = {
  lifecycle: "any",
  area: "",
  cuisine: "",
  maxBudget: null,
  minRating: null,
  type: "",
  staple: "",
  occasion: "",
  vibe: "",
  practical: "",
  openNow: false,
};

// What's left that no chip can express — free keywords, hard negatives, and the
// centroid Ask geocodes for an area (the chips only ever set the area's name).
// Ask-only, carried alongside the chip filters.
type Extras = Pick<
  DecideQuery,
  | "areaCenter"
  | "keywords"
  | "excludeCuisines"
  | "excludeTypes"
  | "excludeStaples"
  | "excludeOccasions"
  | "excludeVibes"
  | "excludePractical"
>;

function buildQuery(f: Filters, x: Extras): DecideQuery {
  const q: DecideQuery = { lifecycle: f.lifecycle };
  if (f.openNow) q.openNow = true;
  if (f.cuisine) q.cuisines = [f.cuisine];
  if (f.type) q.types = [f.type];
  if (f.staple) q.staples = [f.staple];
  if (f.occasion) q.occasions = [f.occasion];
  if (f.vibe) q.vibes = [f.vibe];
  if (f.practical) q.practical = [f.practical];
  if (f.area) {
    q.area = f.area;
    // Only Ask ever produces a centroid; with one, rankPlaces gates by distance
    // instead of by the name (see DecideQuery.area).
    if (x.areaCenter) q.areaCenter = x.areaCenter;
  }
  if (f.maxBudget != null) q.maxBudget = f.maxBudget;
  if (f.minRating != null) q.minRating = f.minRating;
  if (x.keywords?.length) q.keywords = x.keywords;
  for (const k of [
    "excludeCuisines",
    "excludeTypes",
    "excludeStaples",
    "excludeOccasions",
    "excludeVibes",
    "excludePractical",
  ] as const) {
    if (x[k]?.length) q[k] = x[k];
  }
  return q;
}

export type Lens = ReturnType<typeof useLens>;

export function useLens() {
  const places = usePlaces();
  const [source, setSource] = useState<DeckSource>("saved");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [extras, setExtras] = useState<Extras>({});

  // Built for every source. The tag half only lands on saved cards (buildDeck
  // never ranks Swiggy through rankPlaces), but area/budget/rating do gate the
  // Swiggy half too — so "new" can't be handed an empty query any more, or the
  // standard filters would silently no-op on the one source that's all new.
  const query = useMemo<DecideQuery>(() => buildQuery(filters, extras), [filters, extras]);
  const cuisine = filters.cuisine || null;
  const keyword = source === "saved" ? "" : extras.keywords?.join(" ") ?? "";

  // Cheap and local (rankPlaces is pure), so the chips get live feedback.
  // Only meaningful for the saved side.
  const savedMatches = useMemo(
    () => (source === "new" ? 0 : rankPlaces(places, query, 1).length),
    [source, places, query]
  );

  // A one-line summary for the collapsed trigger, so the mode can always say
  // what it is showing you without the panel being open.
  const summary = useMemo(() => {
    const bits: string[] = [];
    if (filters.lifecycle !== "any") bits.push(filters.lifecycle);
    if (filters.area) bits.push(filters.area);
    for (const k of ["cuisine", "type", "staple", "occasion", "vibe", "practical"] as const) {
      if (filters[k]) bits.push(filters[k]);
    }
    if (filters.maxBudget != null) bits.push(`under ₹${filters.maxBudget.toLocaleString("en-IN")}`);
    if (filters.minRating != null) bits.push(`${filters.minRating.toFixed(1)}+`);
    if (filters.openNow) bits.push("open now");
    return bits;
  }, [filters]);

  // Is anything narrowing the deck right now? Not just `summary.length` — Ask
  // can set keywords and hard negatives that no chip shows, and a Clear that
  // left those behind would be a lie.
  const dirty = useMemo(
    () =>
      summary.length > 0 ||
      Object.values(extras).some((v) => (Array.isArray(v) ? v.length > 0 : v != null)),
    [summary, extras]
  );

  const clear = () => {
    setFilters(EMPTY_FILTERS);
    setExtras({});
  };

  return {
    source,
    setSource,
    filters,
    setFilters,
    extras,
    setExtras,
    query,
    cuisine,
    keyword,
    savedMatches,
    summary,
    dirty,
    clear,
  };
}

export default function LensPanel({
  lens,
  areas,
  onClose,
}: {
  lens: Lens;
  // Every locality present in the pool this deck is drawing from — saved
  // places, Swiggy results, or both, per source. Passed in rather than derived
  // here because only the mode holds the Swiggy half.
  areas: string[];
  onClose: () => void;
}) {
  const { source, setSource, filters, setFilters, setExtras, dirty, clear } = lens;
  const [picker, setPicker] = useState<FilterField | null>(null);
  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);

  // A chosen area survives in the list even after the pool moves under it (a
  // cuisine change refetches Swiggy), so the chip never points at a value the
  // list can't show you or let you clear.
  const areaCat = useMemo<Category>(() => {
    const all = [...new Set(filters.area ? [...areas, filters.area] : areas)].sort((a, b) =>
      a.localeCompare(b)
    );
    return { id: "area", label: "Area", values: all.map((a) => ({ value: a, label: a })) };
  }, [areas, filters.area]);

  // An empty pool means an Area chip that opens onto nothing — drop it rather
  // than offer a dead control.
  const standardCats = useMemo<Category[]>(
    () => [...(areaCat.values.length ? [areaCat] : []), CUISINE_CAT, BUDGET_CAT, RATING_CAT],
    [areaCat]
  );
  const tagCats = source === "saved" ? TAG_CATS : [];
  const openCat = picker
    ? [...standardCats, ...tagCats].find((c) => c.id === picker) ?? null
    : null;

  // Chips speak strings; budget and rating are stored as numbers.
  const valueOf = (id: FilterField): string => {
    const v = filters[id];
    return v == null || v === "" ? "" : String(v);
  };

  const setField = (id: FilterField, value: string) => {
    setFilters((f) => ({
      ...f,
      [id]: id === "maxBudget" || id === "minRating" ? (value ? Number(value) : null) : value,
    }));
    // Choosing an area by hand drops the centroid a previous Ask geocoded: the
    // name you just picked is the constraint now, not a radius round another one.
    if (id === "area") setExtras((x) => ({ ...x, areaCenter: undefined }));
    setPicker(null);
  };

  // Ask — the ONE natural-language mechanism, same for every source. Gemini
  // parses free text into the structured query; here we fan it out onto the
  // category filters (so the chips reflect what you asked) plus the extras.
  const ask = async () => {
    const text = nl.trim();
    if (!text) return;
    setThinking(true);
    let q: DecideQuery;
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      q = data.query ?? parseFallback(text);
    } catch {
      q = parseFallback(text);
    }
    if (q.area) {
      try {
        const hit = await geocodeArea(q.area);
        if (hit) {
          q.areaCenter = { lat: hit.lat, lng: hit.lng };
          q.area = hit.name;
        } else delete q.area;
      } catch {
        delete q.area;
      }
    }
    setFilters((f) => ({
      ...f,
      lifecycle: q.lifecycle ?? f.lifecycle,
      area: q.area ?? f.area,
      cuisine: q.cuisines?.[0] ?? f.cuisine,
      maxBudget: q.maxBudget ?? f.maxBudget,
      type: q.types?.[0] ?? f.type,
      staple: q.staples?.[0] ?? f.staple,
      occasion: q.occasions?.[0] ?? f.occasion,
      vibe: q.vibes?.[0] ?? f.vibe,
      practical: q.practical?.[0] ?? f.practical,
      openNow: q.openNow ?? f.openNow,
    }));
    setExtras((x) => ({
      // Area and its centroid travel together. This ask named an area → take
      // its centroid (undefined if geocoding failed, which falls back to the
      // name). It didn't → the previous area name is still standing above, so
      // its centroid has to stand with it.
      areaCenter: q.area ? q.areaCenter : x.areaCenter,
      keywords: q.keywords,
      excludeCuisines: q.excludeCuisines,
      excludeTypes: q.excludeTypes,
      excludeStaples: q.excludeStaples,
      excludeOccasions: q.excludeOccasions,
      excludeVibes: q.excludeVibes,
      excludePractical: q.excludePractical,
    }));
    setThinking(false);
  };

  const SOURCES: { key: DeckSource; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "new", label: "New" },
    { key: "both", label: "Both" },
  ];

  return (
    <div className="fixed inset-0 z-[54] flex flex-col justify-end" style={{ background: "rgba(6,7,10,0.6)" }} onClick={onClose}>
      <div
        className="animate-rise w-full px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow" style={{ color: "var(--accent)" }}>
            Showing
          </span>
          <div className="flex items-center gap-2">
            {/* Nine controls can be on at once now. Un-setting them one at a
                time is the kind of chore a filter sheet is supposed to save
                you — and this is the only thing that also clears what Ask set
                behind the chips. */}
            {dirty && (
              <button
                onClick={() => {
                  clear();
                  setPicker(null);
                  setNl("");
                }}
                className="press px-2 py-1 text-[12px] font-semibold"
                style={{ color: "var(--text-tertiary)" }}
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close filters"
              className="press grid h-8 w-8 place-items-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
            >
              <X size={15} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {/* SOURCE — the first filter */}
        <div
          className="grid grid-cols-3 gap-1"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-chip)",
            padding: 3,
          }}
        >
          {SOURCES.map((s) => {
            const on = source === s.key;
            return (
              <button
                key={s.key}
                onClick={() => {
                  setSource(s.key);
                  setPicker(null);
                }}
                className="press py-2 text-[13.5px] font-semibold transition-colors"
                style={{
                  borderRadius: "calc(var(--radius-chip) - 3px)",
                  background: on ? "oklch(0.97 0 0)" : "transparent",
                  color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Ask */}
        <div
          className="mt-2.5 flex items-center gap-2 px-3"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
        >
          <Sparkles size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
          <input
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Tell me the mood…"
            className="flex-1 bg-transparent py-2.5 text-[14px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          <button
            onClick={ask}
            disabled={thinking || !nl.trim()}
            className="press flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-40"
            style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
          >
            {thinking ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2.25} />}
            Ask
          </button>
        </div>

        {/* THE STANDARD FILTERS — where, what, how much, how good. Wraps rather
            than scrolls: four chips is the whole set, and a filter you have to
            discover by scrolling sideways is the problem this row exists to
            fix. Shown for every source, because all four bite on both. */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {standardCats.map((cat) => (
            <CatChip
              key={cat.id}
              cat={cat}
              value={valueOf(cat.id)}
              isOpen={picker === cat.id}
              onToggle={() => setPicker((p) => (p === cat.id ? null : cat.id))}
            />
          ))}
        </div>
        {openCat && standardCats.some((c) => c.id === openCat.id) && (
          <ValueList cat={openCat} value={valueOf(openCat.id)} onPick={setField} />
        )}

        {/* THE TAG LENS — your own vocabulary, so only when your own places are
            in the deck. Kept below a hairline and left to scroll: it's a long
            tail you go looking for, not the row you land on. */}
        {tagCats.length > 0 && (
          <>
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              <div className="scroll-quiet flex gap-1.5 overflow-x-auto pb-0.5">
                {tagCats.map((cat) => (
                  <CatChip
                    key={cat.id}
                    cat={cat}
                    value={valueOf(cat.id)}
                    isOpen={picker === cat.id}
                    onToggle={() => setPicker((p) => (p === cat.id ? null : cat.id))}
                  />
                ))}
                {/* Hours are a saved-place fact — Swiggy hands back none — so
                    this stays with the tags rather than joining the four. */}
                <button
                  onClick={() => setFilters((f) => ({ ...f, openNow: !f.openNow }))}
                  className="press flex shrink-0 items-center gap-1 px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    borderRadius: "var(--radius-chip)",
                    background: filters.openNow ? "var(--s-watchlist)" : "transparent",
                    color: filters.openNow ? "#1a1206" : "var(--text-secondary)",
                    border: `1px solid ${filters.openNow ? "var(--s-watchlist)" : "var(--border-strong)"}`,
                  }}
                >
                  <Clock size={11} /> Open now
                </button>
              </div>
            </div>
            {openCat && tagCats.some((c) => c.id === openCat.id) && (
              <ValueList cat={openCat} value={valueOf(openCat.id)} onPick={setField} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// A category chip: what the filter is when it's off, what you picked when it's
// on. Never "Budget · Under ₹1,000" — the chip row has to stay readable at a
// glance, and the value IS the more useful half.
function CatChip({
  cat,
  value,
  isOpen,
  onToggle,
}: {
  cat: Category;
  value: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const active = cat.id === "lifecycle" ? value !== "any" : value !== "";
  const shownLabel = active ? cat.values.find((v) => v.value === value)?.label ?? cat.label : cat.label;
  const highlight = active || isOpen;
  return (
    <button
      onClick={onToggle}
      className="press flex shrink-0 items-center gap-1 px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors"
      style={{
        borderRadius: "var(--radius-chip)",
        background: highlight ? "oklch(0.97 0 0)" : "transparent",
        color: highlight ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
        border: `1px solid ${highlight ? "oklch(0.97 0 0)" : "var(--border-strong)"}`,
      }}
    >
      {shownLabel}
      <ChevronDown size={12} strokeWidth={2.5} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
    </button>
  );
}

// The values for the open category, under the row that owns it — so the list
// always opens directly beneath the chip you tapped.
function ValueList({
  cat,
  value,
  onPick,
}: {
  cat: Category;
  value: string;
  onPick: (id: FilterField, value: string) => void;
}) {
  // Lifecycle's "All" IS its any; every other category needs one adding.
  const values = cat.id === "lifecycle" ? cat.values : [{ value: "", label: "Any" }, ...cat.values];
  return (
    <div
      className="animate-rise scroll-quiet mt-2 flex max-h-[34vh] flex-wrap gap-1.5 overflow-y-auto p-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
    >
      {values.map((v) => {
        const on = value === v.value;
        return (
          <button
            key={v.value || "any"}
            onClick={() => onPick(cat.id, v.value)}
            className="press px-3 py-1.5 text-[12.5px] font-semibold capitalize transition-colors"
            style={{
              borderRadius: "var(--radius-chip)",
              background: on ? "oklch(0.97 0 0)" : "transparent",
              color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
              border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border-strong)"}`,
            }}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
