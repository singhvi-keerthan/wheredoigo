"use client";

import { useMemo, useState } from "react";
import { X, Sparkles, RefreshCw, Clock, Search, RotateCcw } from "lucide-react";
import { geocodeArea } from "@/lib/places";
import { parseFallback } from "@/lib/decide-fallback";
import { EMPTY_QUERY, type DecideQuery } from "@/lib/decide";
import { TAG_OPTIONS } from "@/lib/types";
import type { DeckSource } from "@/lib/deck";
import SwipeDeck from "./SwipeDeck";
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

// Saved-lens chips — same vocabulary the app already uses (lifecycle + the
// cuisine/staple tag namespaces), chosen as a one-tap chip. One active at a time.
const LIFECYCLE_CHIPS: { key: string; label: string; q: DecideQuery }[] = [
  { key: "all", label: "All", q: { lifecycle: "any" } },
  { key: "fav", label: "Favorites", q: { lifecycle: "favorites" } },
  { key: "wl", label: "Watchlist", q: { lifecycle: "watchlist" } },
  { key: "been", label: "Been", q: { lifecycle: "visited" } },
];
const CUISINE_CHIPS = TAG_OPTIONS.cuisine;
const STAPLE_CHIPS = TAG_OPTIONS.staple;
const TYPE_CHIPS = TAG_OPTIONS.type;
// occasion / vibe / practical stay in the NL "Ask" box rather than the chip row —
// ~21 more chips would re-cram the bar, and Gemini already maps "romantic
// rooftop", "good for groups" etc. onto those namespaces.

export default function DecideSheet({
  open,
  onClose,
  onView,
  onToast,
}: {
  open: boolean;
  onClose: () => void;
  onView: (id: string) => void;
  onToast: (msg: string) => void;
}) {
  const [title] = useState(() => PHRASES[Math.floor(Math.random() * PHRASES.length)]);
  const [source, setSource] = useState<DeckSource>("saved");

  // Saved lens.
  const [savedQuery, setSavedQuery] = useState<DecideQuery>(EMPTY_QUERY);
  const [lens, setLens] = useState<string>("all"); // active chip key
  const [openNow, setOpenNow] = useState(false);
  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);

  // New / Both lens (cuisine + free-text Swiggy keyword).
  const [cuisine, setCuisine] = useState<string | null>(null);
  const [kwInput, setKwInput] = useState("");
  const [keyword, setKeyword] = useState("");

  // The deck is swipe-only; its undo action surfaces here in the header.
  const [undoFn, setUndoFn] = useState<null | (() => void)>(null);

  const { sheetRef, handleProps } = useSheetDrag(onClose);

  const deckQuery = useMemo<DecideQuery>(() => {
    if (source === "saved") return { ...savedQuery, openNow };
    if (source === "both") return { lifecycle: "any", ...(cuisine ? { cuisines: [cuisine] } : {}) };
    return EMPTY_QUERY; // "new" — deck ignores query, uses cuisine + keyword
  }, [source, savedQuery, openNow, cuisine]);

  if (!open) return null;

  const pickLens = (key: string, q: DecideQuery) => {
    setLens(key);
    setSavedQuery(q);
    setNl("");
  };

  // NL "Ask" (Saved) — untouched Gemini path: free text → structured query.
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
    setSavedQuery(q);
    setLens("");
    setThinking(false);
  };

  const SOURCES: { key: DeckSource; label: string }[] = [
    { key: "saved", label: "Saved" },
    { key: "new", label: "New" },
    { key: "both", label: "Both" },
  ];

  return (
    <div className="fixed inset-0 z-50" style={{ background: "var(--bg-raised)" }}>
      <div
        ref={sheetRef}
        className="absolute inset-0 flex flex-col"
        style={{ background: "var(--bg-raised)" }}
      >
        {/* ---- header (flex-none) ---- */}
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
              {undoFn && (
                <button
                  onClick={() => undoFn()}
                  aria-label="Undo last swipe"
                  className="press flex h-9 items-center gap-1.5 rounded-full px-3"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
                >
                  <RotateCcw size={14} strokeWidth={2.25} />
                  <span className="text-[12.5px] font-semibold">Undo</span>
                </button>
              )}
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

          {/* SOURCE — the first filter, a full-width segmented control */}
          <div
            className="mt-3.5 grid grid-cols-3 gap-1"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-chip)", padding: 3 }}
          >
            {SOURCES.map((s) => {
              const on = source === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
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

        {/* ---- controls: search + chips (flex-none) ---- */}
        <div className="flex-none px-5 pt-3">
          {source === "saved" ? (
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
          ) : (
            <div
              className="flex items-center gap-2 px-3"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
            >
              <Search size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
              <input
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
                placeholder="Search Swiggy — a dish, a place…"
                className="flex-1 bg-transparent py-2.5 text-[14px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              {kwInput && (
                <button
                  onClick={() => {
                    setKwInput("");
                    setKeyword("");
                  }}
                  aria-label="Clear search"
                  className="press grid h-5 w-5 place-items-center rounded-full"
                  style={{ background: "var(--bg-raised)", color: "var(--text-tertiary)" }}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              )}
              <button
                onClick={() => setKeyword(kwInput.trim())}
                className="press flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-bold"
                style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
              >
                <Search size={13} strokeWidth={2.5} />
                Go
              </button>
            </div>
          )}

          {/* chips */}
          {source === "saved" ? (
            <div className="scroll-quiet mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
              {LIFECYCLE_CHIPS.map((c) => (
                <Chip key={c.key} label={c.label} on={lens === c.key} onClick={() => pickLens(c.key, c.q)} />
              ))}
              {CUISINE_CHIPS.map((c) => (
                <Chip
                  key={`cuisine:${c}`}
                  label={c}
                  on={lens === `cuisine:${c}`}
                  onClick={() => pickLens(`cuisine:${c}`, { lifecycle: "any", cuisines: [c] })}
                />
              ))}
              {STAPLE_CHIPS.map((c) => (
                <Chip
                  key={`staple:${c}`}
                  label={c}
                  on={lens === `staple:${c}`}
                  onClick={() => pickLens(`staple:${c}`, { lifecycle: "any", staples: [c] })}
                />
              ))}
              {TYPE_CHIPS.map((c) => (
                <Chip
                  key={`type:${c}`}
                  label={c}
                  on={lens === `type:${c}`}
                  onClick={() => pickLens(`type:${c}`, { lifecycle: "any", types: [c] })}
                />
              ))}
              <button
                onClick={() => setOpenNow((v) => !v)}
                className="flex shrink-0 items-center gap-1 px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  borderRadius: "var(--radius-chip)",
                  background: openNow ? "var(--s-watchlist)" : "transparent",
                  color: openNow ? "#1a1206" : "var(--text-secondary)",
                  border: `1px solid ${openNow ? "var(--s-watchlist)" : "var(--border-strong)"}`,
                }}
              >
                <Clock size={11} /> Open now
              </button>
            </div>
          ) : (
            <div className="scroll-quiet mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
              <Chip label="Any" on={cuisine === null} onClick={() => setCuisine(null)} />
              {CUISINE_CHIPS.map((c) => (
                <Chip key={c} label={c} on={cuisine === c} onClick={() => setCuisine(c)} />
              ))}
            </div>
          )}
        </div>

        {/* ---- deck fills the rest ---- */}
        <div className="min-h-0 flex-1 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <SwipeDeck
            source={source}
            query={deckQuery}
            cuisine={cuisine}
            keyword={source === "saved" ? "" : keyword}
            onOpenSaved={(id) => {
              onView(id);
              onClose(); // PlaceDetail (z-40) sits under the sheet — eject to show it
            }}
            onToast={onToast}
            onUndoChange={(fn) => setUndoFn(() => fn)}
          />
        </div>
      </div>
    </div>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="press shrink-0 px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors"
      style={{
        borderRadius: "var(--radius-chip)",
        background: on ? "oklch(0.97 0 0)" : "transparent",
        color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
        border: `1px solid ${on ? "oklch(0.97 0 0)" : "var(--border-strong)"}`,
      }}
    >
      {label}
    </button>
  );
}
