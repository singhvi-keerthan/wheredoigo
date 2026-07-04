"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Sparkles, Navigation, RefreshCw, ArrowRight, Clock, Search, Star, Check, CalendarClock } from "lucide-react";
import { usePlaces, addPlace, findDuplicate } from "@/lib/store";
import { isOpenNow } from "@/lib/types";
import { rankPlaces, EMPTY_QUERY, type DecideQuery } from "@/lib/decide";
import { parseFallback } from "@/lib/decide-fallback";
import { geocodeArea } from "@/lib/places";
import { searchDineout, getSlots, bookTable, type SwiggyRestaurant, type SwiggySlot } from "@/lib/swiggyClient";
import { stateMeta, leadRating, leadPrice, directionsUrl, coverPhoto, referenceSourceLabel } from "@/lib/format";
import { useSheetDrag } from "./useSheetDrag";

type DecideMode = "mine" | "swiggy";

// Intent presets — one tap sets a structured query. Proximity only enters via a
// typed "near {area}" ask, never implicitly.
const PRESETS: { label: string; query: DecideQuery }[] = [
  { label: "Surprise me", query: { intent: "Surprise me", lifecycle: "any" } },
  { label: "Something new", query: { intent: "Something new", lifecycle: "watchlist" } },
  { label: "Date night", query: { intent: "Date night", occasions: ["date"], vibes: ["romantic", "cozy"] } },
  { label: "With friends", query: { intent: "With friends", occasions: ["friends"], vibes: ["lively"] } },
  { label: "Coffee", query: { intent: "Coffee", types: ["café"] } },
  { label: "Tried & loved", query: { intent: "Tried & loved", lifecycle: "favorites" } },
];

export default function DecideSheet({
  open,
  onClose,
  onView,
}: {
  open: boolean;
  onClose: () => void;
  onView: (id: string) => void;
}) {
  const places = usePlaces();
  const [mode, setMode] = useState<DecideMode>("mine");
  const [query, setQuery] = useState<DecideQuery>(EMPTY_QUERY);
  // Lazy seed so each mount gets a fresh shuffle (AppShell remounts via key on open).
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9) + 1);
  const [cursor, setCursor] = useState(0);
  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  const ranked = useMemo(() => rankPlaces(places, query, seed), [places, query, seed]);
  const hero = ranked[cursor] ?? ranked[0] ?? null;

  if (!open) return null;

  const applyQuery = (q: DecideQuery) => {
    setQuery(q);
    setSeed((s) => s + 1);
    setCursor(0);
  };

  const another = () => {
    if (cursor + 1 < ranked.length) {
      setCursor((c) => c + 1);
    } else {
      setSeed((s) => s + 1); // reshuffle once the list is exhausted
      setCursor(0);
    }
  };

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
    // "near jayanagar" → resolve the neighbourhood to a centroid the ranker can
    // use; if it doesn't geocode to an area, drop the constraint rather than
    // filter on garbage.
    if (q.area) {
      try {
        const hit = await geocodeArea(q.area);
        if (hit) {
          q.areaCenter = { lat: hit.lat, lng: hit.lng };
          q.area = hit.name;
        } else {
          delete q.area;
        }
      } catch {
        delete q.area;
      }
    }
    applyQuery(q);
    setThinking(false);
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
        ref={sheetRef}
        className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[94dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* handle + close */}
        <div className="sticky top-0 z-10 px-5 pt-2" style={{ background: "var(--bg-raised)" }}>
          <div {...handleProps} className="flex cursor-grab touch-none justify-center pb-2 pt-0.5">
            <div className="h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-3 grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-5">
          <div className="flex items-center gap-1.5">
            <Sparkles size={13} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
            <span className="eyebrow" style={{ color: "var(--accent)" }}>Decide</span>
          </div>
          <h1
            className="mt-1.5 text-[27px] font-medium leading-[1.05] tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {mode === "mine" ? "Where to tonight?" : "Browse Swiggy"}
          </h1>

          {/* mode toggle — "mine" ranks what you've saved; "swiggy" is a plain
              browse of Swiggy's own catalog, independent of your data, for
              when nothing you've saved fits the mood. */}
          <div
            className="mt-3 inline-flex"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-chip)", padding: 3 }}
          >
            {(["mine", "swiggy"] as const).map((m) => {
              const on = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="press px-4 py-1.5 text-[13px] font-semibold transition-colors"
                  style={{
                    borderRadius: "var(--radius-chip)",
                    background: on ? "oklch(0.97 0 0)" : "transparent",
                    color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
                  }}
                >
                  {m === "mine" ? "My places" : "Swiggy"}
                </button>
              );
            })}
          </div>

          {mode === "mine" ? (
            <>
              {/* NL input */}
              <div
                className="mt-3.5 flex items-center gap-2 px-3"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
              >
                <input
                  value={nl}
                  onChange={(e) => setNl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ask()}
                  placeholder="Tell me the mood… “date night, something new”"
                  className="flex-1 bg-transparent py-3 text-[14px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                <button
                  onClick={ask}
                  disabled={thinking || !nl.trim()}
                  className="press flex items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-bold disabled:opacity-40"
                  style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
                >
                  {thinking ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2.25} />}
                  Ask
                </button>
              </div>

              {/* preset chips */}
              <div className="scroll-quiet mt-2.5 flex gap-2 overflow-x-auto pb-1">
                {PRESETS.map((p) => {
                  const on = query.intent === p.query.intent;
                  return (
                    <button
                      key={p.label}
                      onClick={() => applyQuery(p.query)}
                      className="press shrink-0 px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
                      style={{
                        borderRadius: "var(--radius-chip)",
                        background: on ? "oklch(0.97 0 0)" : "transparent",
                        color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
                        border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border-strong)"}`,
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => applyQuery({ ...query, openNow: !query.openNow })}
                  className="flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                  style={{
                    borderRadius: "var(--radius-chip)",
                    background: query.openNow ? "var(--s-watchlist)" : "transparent",
                    color: query.openNow ? "#1a1206" : "var(--text-secondary)",
                    border: `1px solid ${query.openNow ? "var(--s-watchlist)" : "var(--border-strong)"}`,
                  }}
                >
                  <Clock size={12} /> Open now
                </button>
              </div>

              {/* hero pick */}
              {hero ? (
                <HeroPick
                  key={hero.place.id}
                  ranked={hero}
                  onView={() => {
                    onView(hero.place.id);
                    onClose();
                  }}
                />
              ) : (
                <div
                  className="animate-rise mt-4 px-5 py-10 text-center"
                  style={{ borderRadius: "var(--radius)", border: "1px dashed var(--border-strong)" }}
                >
                  <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
                    Nothing fits that combination.
                  </p>
                  <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
                    Loosen a filter, or hit a preset above.
                  </p>
                </div>
              )}

              {hero && (
                <button
                  onClick={another}
                  className="press mt-3 flex w-full items-center justify-center gap-2 py-3 text-[14px] font-semibold"
                  style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
                >
                  <RefreshCw size={14} /> Another
                  <span className="font-[family-name:var(--font-mono)] text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {cursor + 1}/{ranked.length}
                  </span>
                </button>
              )}
            </>
          ) : (
            <SwiggyPanel />
          )}
        </div>
      </div>
    </div>
  );
}

function HeroPick({
  ranked,
  onView,
}: {
  ranked: ReturnType<typeof rankPlaces>[number];
  onView: () => void;
}) {
  const { place, reasons } = ranked;
  const meta = stateMeta(place);
  const rating = leadRating(place);
  const price = leadPrice(place);
  const open = isOpenNow(place.openingPeriods);
  const cover = coverPhoto(place);

  return (
    <div
      className="animate-rise mt-4 overflow-hidden"
      style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-strong)", background: "var(--bg-elevated)" }}
    >
      {cover && (
        <div className="h-36 w-full" style={{ background: `center/cover url(${cover.dataUrl})` }} />
      )}
      <div className="p-4">
        <div className="flex items-center gap-1.5">
          <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: meta.color }} />
          <span className="text-[11.5px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          {open === true && (
            <span className="ml-1 text-[11px] font-medium" style={{ color: "var(--s-watchlist)" }}>· Open now</span>
          )}
        </div>

        <h2
          className="mt-1 text-[28px] leading-[1.02] tracking-[-0.005em]"
          style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
        >
          {place.name}
        </h2>

        <div className="mt-1.5 flex items-center gap-3.5 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
          {rating.value != null && (
            <span className="inline-flex items-center gap-1" style={{ color: rating.mine ? "var(--star)" : "var(--text-secondary)" }}>
              ★ {rating.value.toFixed(1)}
              <span style={{ color: "var(--text-tertiary)" }}>{rating.mine ? "you" : referenceSourceLabel(place)}</span>
            </span>
          )}
          <span style={{ color: "var(--text-secondary)" }}>{price.label}</span>
        </div>

        {/* why this */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {reasons.map((r) => (
            <span
              key={r}
              className="px-2 py-[3px] text-[11px]"
              style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
            >
              {r}
            </span>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <a
            href={directionsUrl(place)}
            target="_blank"
            rel="noreferrer"
            className="press flex items-center justify-center gap-2 py-3 text-[14px] font-bold"
            style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
          >
            <Navigation size={15} strokeWidth={2.5} fill="currentColor" /> Directions
          </a>
          <button
            onClick={onView}
            className="press flex items-center justify-center gap-1.5 px-4 py-3 text-[14px] font-semibold"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
          >
            Details <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Same cuisine namespace as the app's own tags, so a saved Swiggy find shows
// up consistent with places added any other way.
const CUISINE_CHIPS = ["north-indian", "south-indian", "italian", "chinese", "thai", "continental", "korean", "mexican"];

// "Swiggy" mode — a plain browse of Swiggy Dineout's own catalog, independent
// of anything you've saved. Mocked until Builders Club access is approved
// (lib/swiggy.ts); the UI is fully live against that mock so this is a real,
// demoable escape hatch today, not a placeholder.
function SwiggyPanel() {
  const [keyword, setKeyword] = useState("");
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [results, setResults] = useState<SwiggyRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [bookingFor, setBookingFor] = useState<string | null>(null);
  const [slots, setSlots] = useState<SwiggySlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [bookedFor, setBookedFor] = useState<Record<string, string>>({});

  const runSearch = async (q: { keyword?: string; cuisine?: string }) => {
    setLoading(true);
    const { results } = await searchDineout(q);
    setResults(results);
    setLoading(false);
  };

  // Browse everything on first open.
  useEffect(() => {
    runSearch({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCuisine = (c: string) => {
    const next = cuisine === c ? null : c;
    setCuisine(next);
    runSearch({ keyword: keyword.trim() || undefined, cuisine: next ?? undefined });
  };

  const save = (r: SwiggyRestaurant) => {
    const dup = findDuplicate({ name: r.name, lat: r.lat, lng: r.lng });
    if (!dup) {
      addPlace({
        googlePlaceId: null,
        name: r.name,
        address: r.address,
        area: r.area,
        lat: r.lat,
        lng: r.lng,
        status: "watchlist",
        myRating: null,
        googleRating: r.rating,
        myBudgetPerPerson: null,
        googlePriceLevel: null,
        notes: "",
        tags: r.cuisines.map((c) => ({ namespace: "cuisine" as const, value: c })),
        source: "swiggy",
        enrichedAt: null,
      });
    }
    setSavedIds((s) => new Set(s).add(r.id));
  };

  const startBooking = async (r: SwiggyRestaurant) => {
    setBookingFor(r.id);
    setSlotsLoading(true);
    const { results } = await getSlots(r.id);
    setSlots(results);
    setSlotsLoading(false);
  };

  const confirmSlot = async (r: SwiggyRestaurant, slot: SwiggySlot) => {
    const booking = await bookTable(r.id, slot.id, 2);
    if (booking?.confirmed) {
      setBookedFor((b) => ({ ...b, [r.id]: slot.label }));
      setBookingFor(null);
    }
  };

  return (
    <div className="mt-3.5">
      <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
        Swiggy Dineout&rsquo;s own listings — not limited to what you&rsquo;ve saved. Bookings here are a live preview; real bookings need Swiggy Builders Club access.
      </p>

      {/* search */}
      <div
        className="mt-3 flex items-center gap-2 px-3"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
      >
        <Search size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch({ keyword: keyword.trim() || undefined, cuisine: cuisine ?? undefined })}
          placeholder="Search restaurants, cuisines…"
          className="flex-1 bg-transparent py-3 text-[14px] outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      {/* cuisine chips */}
      <div className="scroll-quiet mt-2.5 flex gap-2 overflow-x-auto pb-1">
        {CUISINE_CHIPS.map((c) => {
          const on = cuisine === c;
          return (
            <button
              key={c}
              onClick={() => toggleCuisine(c)}
              className="press shrink-0 px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
              style={{
                borderRadius: "var(--radius-chip)",
                background: on ? "oklch(0.97 0 0)" : "transparent",
                color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
                border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border-strong)"}`,
              }}
            >
              {c}
            </button>
          );
        })}
      </div>

      {/* results */}
      <div className="mt-3.5 flex flex-col gap-2.5">
        {loading ? (
          <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            Loading…
          </p>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
            No matches — try a different cuisine or search term.
          </p>
        ) : (
          results.map((r) => (
            <SwiggyCard
              key={r.id}
              r={r}
              saved={savedIds.has(r.id)}
              bookedLabel={bookedFor[r.id]}
              bookingOpen={bookingFor === r.id}
              slots={slots}
              slotsLoading={slotsLoading}
              onSave={() => save(r)}
              onBookStart={() => startBooking(r)}
              onBookCancel={() => setBookingFor(null)}
              onSlotPick={(slot) => confirmSlot(r, slot)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SwiggyCard({
  r,
  saved,
  bookedLabel,
  bookingOpen,
  slots,
  slotsLoading,
  onSave,
  onBookStart,
  onBookCancel,
  onSlotPick,
}: {
  r: SwiggyRestaurant;
  saved: boolean;
  bookedLabel?: string;
  bookingOpen: boolean;
  slots: SwiggySlot[];
  slotsLoading: boolean;
  onSave: () => void;
  onBookStart: () => void;
  onBookCancel: () => void;
  onSlotPick: (slot: SwiggySlot) => void;
}) {
  return (
    <div
      className="p-3.5"
      style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-strong)", background: "var(--bg-elevated)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            className="truncate text-[18px] leading-[1.1]"
            style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
          >
            {r.name}
          </h3>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-tertiary)" }}>{r.area}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 pt-0.5 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
          {r.rating != null && (
            <span className="inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
              <Star size={11} strokeWidth={0} fill="currentColor" style={{ color: "var(--star)" }} />
              {r.rating.toFixed(1)}
            </span>
          )}
          {r.priceForTwo != null && <span style={{ color: "var(--text-secondary)" }}>₹{r.priceForTwo} for two</span>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {r.cuisines.map((c) => (
          <span
            key={c}
            className="px-2.5 py-[3px] text-[11px]"
            style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-raised)", color: "var(--text-secondary)" }}
          >
            {c}
          </span>
        ))}
      </div>

      {bookingOpen ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)" }}>
            {slotsLoading ? "Finding tables…" : "Pick a time — table for 2"}
          </p>
          {!slotsLoading && (
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSlotPick(s)}
                  className="press px-3 py-[7px] text-[12.5px] font-semibold"
                  style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
                >
                  {s.label}
                </button>
              ))}
              <button
                onClick={onBookCancel}
                className="press px-3 py-[7px] text-[12.5px] font-semibold"
                style={{ borderRadius: "var(--radius-chip)", color: "var(--text-tertiary)" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={onBookStart}
            disabled={!!bookedLabel}
            className="press flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-bold disabled:opacity-70"
            style={{ background: bookedLabel ? "var(--s-visited)" : "oklch(0.97 0 0)", color: bookedLabel ? "#fff" : "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
          >
            {bookedLabel ? (
              <>
                <Check size={14} strokeWidth={3} /> Booked {bookedLabel}
              </>
            ) : (
              <>
                <CalendarClock size={14} strokeWidth={2.5} /> Book a table
              </>
            )}
          </button>
          <button
            onClick={onSave}
            disabled={saved}
            className="press flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold disabled:opacity-70"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
          >
            {saved ? (
              <>
                <Check size={14} strokeWidth={3} /> Saved
              </>
            ) : (
              "Save to my places"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
