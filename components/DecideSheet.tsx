"use client";

import { useMemo, useState } from "react";
import { X, Sparkles, RefreshCw, ChevronDown, Clock, Layers } from "lucide-react";
import { geocodeArea } from "@/lib/places";
import { parseFallback } from "@/lib/decide-fallback";
import { EMPTY_QUERY, rankPlaces, type DecideQuery } from "@/lib/decide";
import { TAG_OPTIONS } from "@/lib/types";
import { usePlaces } from "@/lib/store";
import type { DeckSource } from "@/lib/deck";
import type { SwipeLaunch } from "./SwipeMode";
import { useSheetDrag } from "./useSheetDrag";

// Rotating title — a fresh quirky line each time the sheet opens (it mounts
// fresh per open, so the initializer picks once per open, never mid-session).
const PHRASES = [
  "Where to tonight?",
  "What are we feeling?",
  "Hungry yet?",
  "Pick your poison",
  "Dinner roulette",
  "Swipe till it's dinner",
  "What's the move?",
  "Let's find the one",
  "Okay, decide already",
  "Somewhere good?",
  "Feed me.",
  "Treat yourself",
];

// The filter row is CATEGORY chips, not their values — tapping one opens a list
// to pick from. Keeps the row short + uniform no matter how many values a
// namespace has, and exposes every namespace without a 40-chip scroll.
type FilterField = "lifecycle" | "cuisine" | "type" | "staple" | "occasion" | "vibe" | "practical";
type Category = { id: FilterField; label: string; values: { value: string; label: string }[] };

const opt = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));
const CUISINE_CAT: Category = { id: "cuisine", label: "Cuisine", values: opt(TAG_OPTIONS.cuisine) };
// Saved gets the full namespace set; "Show" is the lifecycle lens.
const SAVED_CATS: Category[] = [
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
  CUISINE_CAT,
  { id: "type", label: "Type", values: opt(TAG_OPTIONS.type) },
  { id: "staple", label: "Staple", values: opt(TAG_OPTIONS.staple) },
  { id: "occasion", label: "Occasion", values: opt(TAG_OPTIONS.occasion) },
  { id: "vibe", label: "Vibe", values: opt(TAG_OPTIONS.vibe) },
  { id: "practical", label: "Practical", values: opt(TAG_OPTIONS.practical) },
];

type Filters = {
  lifecycle: "any" | "favorites" | "watchlist" | "visited";
  cuisine: string;
  type: string;
  staple: string;
  occasion: string;
  vibe: string;
  practical: string;
  openNow: boolean;
};
const EMPTY_FILTERS: Filters = {
  lifecycle: "any",
  cuisine: "",
  type: "",
  staple: "",
  occasion: "",
  vibe: "",
  practical: "",
  openNow: false,
};

// The extra query bits categories don't cover (area / budget / free keywords /
// exclusions) — set by the Ask box, carried alongside the category filters.
type Extras = Pick<
  DecideQuery,
  | "area"
  | "areaCenter"
  | "maxBudget"
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
  if (x.area) {
    q.area = x.area;
    if (x.areaCenter) q.areaCenter = x.areaCenter;
  }
  if (x.maxBudget != null) q.maxBudget = x.maxBudget;
  if (x.keywords?.length) q.keywords = x.keywords;
  for (const k of ["excludeCuisines", "excludeTypes", "excludeStaples", "excludeOccasions", "excludeVibes", "excludePractical"] as const) {
    if (x[k]?.length) q[k] = x[k];
  }
  return q;
}

export default function DecideSheet({
  open,
  onClose,
  onStartSwiping,
}: {
  open: boolean;
  onClose: () => void;
  // Decide sets the lens; swiping happens on its own full-screen surface, which
  // AppShell mounts above this sheet. Closing swipe mode lands back here with
  // the filters intact, so "refine and go again" stays one tap.
  onStartSwiping: (launch: SwipeLaunch) => void;
}) {
  const [title] = useState(() => PHRASES[Math.floor(Math.random() * PHRASES.length)]);
  const places = usePlaces();
  const [source, setSource] = useState<DeckSource>("saved");

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [extras, setExtras] = useState<Extras>({});
  const [picker, setPicker] = useState<FilterField | null>(null); // open category list

  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);

  const { sheetRef, handleProps } = useSheetDrag(onClose);

  // The lens the deck runs on. New ignores the query (uses cuisine + keyword);
  // Saved/Both run the full built query (Both only ever has cuisine set here).
  const deckQuery = useMemo<DecideQuery>(
    () => (source === "new" ? EMPTY_QUERY : buildQuery(filters, extras)),
    [source, filters, extras]
  );
  const cuisineProp = filters.cuisine || null;
  const keywordProp = source === "saved" ? "" : extras.keywords?.join(" ") ?? "";

  // Cheap and local (rankPlaces is pure), so the chips get live feedback: change
  // a filter, watch the number move. Only meaningful for the saved lens.
  const savedMatches = useMemo(
    () => (source === "new" ? 0 : rankPlaces(places, deckQuery, 1).length),
    [source, places, deckQuery]
  );

  if (!open) return null;

  const cats = source === "saved" ? SAVED_CATS : [CUISINE_CAT];

  const setField = (id: FilterField, value: string) => {
    setFilters((f) => ({ ...f, [id]: value }));
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
      cuisine: q.cuisines?.[0] ?? f.cuisine,
      type: q.types?.[0] ?? f.type,
      staple: q.staples?.[0] ?? f.staple,
      occasion: q.occasions?.[0] ?? f.occasion,
      vibe: q.vibes?.[0] ?? f.vibe,
      practical: q.practical?.[0] ?? f.practical,
      openNow: q.openNow ?? f.openNow,
    }));
    setExtras({
      area: q.area,
      areaCenter: q.areaCenter,
      maxBudget: q.maxBudget,
      keywords: q.keywords,
      excludeCuisines: q.excludeCuisines,
      excludeTypes: q.excludeTypes,
      excludeStaples: q.excludeStaples,
      excludeOccasions: q.excludeOccasions,
      excludeVibes: q.excludeVibes,
      excludePractical: q.excludePractical,
    });
    setThinking(false);
  };

  const SOURCES: { key: DeckSource; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "new", label: "New" },
    { key: "both", label: "Both" },
  ];

  const openCat = picker ? cats.find((c) => c.id === picker) ?? null : null;

  return (
    <div className="fixed inset-0 z-50" style={{ background: "var(--bg-raised)" }}>
      <div
        ref={sheetRef}
        className="absolute inset-0 flex flex-col"
        style={{ background: "var(--bg-raised)" }}
      >
        {/* ---- header ---- */}
        <div className="flex-none px-5 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div {...handleProps} className="flex cursor-grab touch-none justify-center py-1.5">
            <div className="h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Sparkles size={12} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
                <span className="eyebrow" style={{ color: "var(--accent)" }}>
                  Decide
                </span>
              </div>
              <h1
                className="mt-1 truncate text-[24px] font-medium leading-none tracking-[-0.01em]"
                style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
              >
                {title}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={onClose}
                aria-label="Close"
                className="press grid h-9 w-9 place-items-center rounded-full"
                style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
              >
                <X size={16} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          {/* SOURCE — the first filter */}
          <div
            className="mt-3.5 grid grid-cols-3 gap-1"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-chip)", padding: 3 }}
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
        </div>

        {/* ---- controls: one Ask box (every source) + category chips ---- */}
        <div className="flex-none px-5 pt-3">
          <div
            className="flex items-center gap-2 px-3"
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

          {/* category chips */}
          <div className="scroll-quiet mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
            {cats.map((cat) => {
              const val = filters[cat.id] as string;
              const active = cat.id === "lifecycle" ? val !== "any" : val !== "";
              const isOpen = picker === cat.id;
              const shownLabel = active ? cat.values.find((v) => v.value === val)?.label ?? cat.label : cat.label;
              const highlight = active || isOpen;
              return (
                <button
                  key={cat.id}
                  onClick={() => setPicker((p) => (p === cat.id ? null : cat.id))}
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
            })}
            {source === "saved" && (
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
            )}
          </div>

          {/* value list — appears under the row when a category is tapped */}
          {openCat && (
            <div
              className="animate-rise scroll-quiet mt-2 flex max-h-[34vh] flex-wrap gap-1.5 overflow-y-auto p-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
            >
              {(openCat.id === "lifecycle" ? openCat.values : [{ value: "", label: "Any" }, ...openCat.values]).map((v) => {
                const on = (filters[openCat.id] as string) === v.value;
                return (
                  <button
                    key={v.value || "any"}
                    onClick={() => setField(openCat.id, v.value)}
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
          )}
        </div>

        {/* ---- the hand-off ----
            Everything above sets the lens; this launches it. The match count is
            only computable for the saved lens (New/Both need a Swiggy round-trip
            this sheet deliberately doesn't make), so it shows there and nowhere
            else rather than guessing a number. */}
        <div className="mt-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          {source === "saved" && (
            <p className="mb-2.5 text-center text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
              {savedMatches === 0
                ? "Nothing matches this lens yet"
                : `${savedMatches} ${savedMatches === 1 ? "place" : "places"} match`}
            </p>
          )}
          <button
            onClick={() =>
              onStartSwiping({
                source,
                query: deckQuery,
                cuisine: cuisineProp,
                keyword: keywordProp,
              })
            }
            disabled={source === "saved" && savedMatches === 0}
            className="press flex w-full items-center justify-center gap-2 py-3.5 text-[15px] font-bold disabled:opacity-40"
            style={{
              background: "oklch(0.97 0 0)",
              color: "oklch(0.16 0.006 260)",
              borderRadius: "var(--radius-chip)",
            }}
          >
            <Layers size={16} strokeWidth={2.5} />
            Start swiping
          </button>
        </div>
      </div>
    </div>
  );
}
