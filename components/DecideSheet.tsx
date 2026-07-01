"use client";

import { useMemo, useState } from "react";
import { X, Sparkles, Navigation, RefreshCw, ArrowRight, Clock } from "lucide-react";
import { usePlaces } from "@/lib/store";
import { TAG_OPTIONS, isOpenNow } from "@/lib/types";
import { rankPlaces, EMPTY_QUERY, type DecideQuery } from "@/lib/decide";
import { stateMeta, leadRating, leadPrice, directionsUrl } from "@/lib/format";

// Intent presets — one tap sets a structured query. No proximity, by design.
const PRESETS: { label: string; query: DecideQuery }[] = [
  { label: "Surprise me", query: { intent: "Surprise me", lifecycle: "any" } },
  { label: "Something new", query: { intent: "Something new", lifecycle: "watchlist" } },
  { label: "Date night", query: { intent: "Date night", occasions: ["date"], vibes: ["romantic", "cozy"] } },
  { label: "With friends", query: { intent: "With friends", occasions: ["friends"], vibes: ["lively"] } },
  { label: "Coffee", query: { intent: "Coffee", types: ["café"] } },
  { label: "Tried & loved", query: { intent: "Tried & loved", lifecycle: "favorites" } },
];

// Local keyword parse — fallback when the Gemini NL route is unavailable. Mirrors
// the model's guardrails: negated terms ("no bars", "not italian") go to exclude
// fields rather than inverting into positives, and "tonight" is not open-now.
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

function parseFallback(text: string): DecideQuery {
  const t = text.toLowerCase();
  const q: DecideQuery = { intent: text.trim().slice(0, 40), lifecycle: "any" };

  const fields: { ns: keyof typeof TAG_OPTIONS; inc: keyof DecideQuery; exc: keyof DecideQuery }[] = [
    { ns: "type", inc: "types", exc: "excludeTypes" },
    { ns: "cuisine", inc: "cuisines", exc: "excludeCuisines" },
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
  return q;
}

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
  const [query, setQuery] = useState<DecideQuery>(EMPTY_QUERY);
  // Lazy seed so each mount gets a fresh shuffle (AppShell remounts via key on open).
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9) + 1);
  const [cursor, setCursor] = useState(0);
  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);

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
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();
      applyQuery(data.query ?? parseFallback(text));
    } catch {
      applyQuery(parseFallback(text));
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
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
          <div className="mx-auto mb-2 h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
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
            Where to tonight?
          </h1>

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

  return (
    <div
      className="animate-rise mt-4 overflow-hidden"
      style={{ borderRadius: "var(--radius)", border: "1px solid var(--border-strong)", background: "var(--bg-elevated)" }}
    >
      {place.photos[0] && (
        <div className="h-36 w-full" style={{ background: `center/cover url(${place.photos[0].dataUrl})` }} />
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
          className="mt-1 text-[26px] font-medium leading-[1.05] tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          {place.name}
        </h2>

        <div className="mt-1.5 flex items-center gap-3.5 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
          {rating.value != null && (
            <span className="inline-flex items-center gap-1" style={{ color: rating.mine ? "var(--star)" : "var(--text-secondary)" }}>
              ★ {rating.value.toFixed(1)}
              <span style={{ color: "var(--text-tertiary)" }}>{rating.mine ? "you" : "ggl"}</span>
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
