"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Clock, MapPin, RefreshCw, Sparkles, X } from "lucide-react";
import { parseFallback } from "@/lib/decide-fallback";
import { geocodeArea } from "@/lib/places";
import { BENGALURU_AREA_OPTIONS } from "@/lib/areas";
import { TAG_OPTIONS } from "@/lib/types";
import type { DecideQuery } from "@/lib/decide";

// Ask, back on the map.
//
// It used to live here as a mascot you tapped — "Can't decide? Ask me" — and it
// left on 2026-08-19 with DecideSheet, when swipe became a mode and Ask moved
// inside the deck's filter panel. The map still needs its own version: not a way
// into the deck, but a way to narrow the pins you are already looking at.

type FilterField =
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

type Filters = {
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

const EMPTY_FILTERS: Filters = {
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

const opt = (arr: string[]) => arr.map((v) => ({ value: v, label: v }));
const AREA_CAT: Category = { id: "area", label: "Area", values: opt(BENGALURU_AREA_OPTIONS) };
const CUISINE_CAT: Category = { id: "cuisine", label: "Cuisine", values: opt(TAG_OPTIONS.cuisine) };
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
const STANDARD_CATS: Category[] = [AREA_CAT, CUISINE_CAT, BUDGET_CAT, RATING_CAT];
const TAG_CATS: Category[] = [
  { id: "type", label: "Type", values: opt(TAG_OPTIONS.type) },
  { id: "staple", label: "Staple", values: opt(TAG_OPTIONS.staple) },
  { id: "occasion", label: "Occasion", values: opt(TAG_OPTIONS.occasion) },
  { id: "vibe", label: "Vibe", values: opt(TAG_OPTIONS.vibe) },
  { id: "practical", label: "Practical", values: opt(TAG_OPTIONS.practical) },
];

function buildQuery(f: Filters, x: Extras): DecideQuery {
  const q: DecideQuery = { lifecycle: "any" };
  if (f.openNow) q.openNow = true;
  if (f.cuisine) q.cuisines = [f.cuisine];
  if (f.type) q.types = [f.type];
  if (f.staple) q.staples = [f.staple];
  if (f.occasion) q.occasions = [f.occasion];
  if (f.vibe) q.vibes = [f.vibe];
  if (f.practical) q.practical = [f.practical];
  if (f.area) {
    q.area = f.area;
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

function mergeParsed(f: Filters, q: DecideQuery): Filters {
  return {
    ...f,
    area: q.area ?? f.area,
    cuisine: q.cuisines?.[0] ?? f.cuisine,
    maxBudget: q.maxBudget ?? f.maxBudget,
    minRating: q.minRating ?? f.minRating,
    type: q.types?.[0] ?? f.type,
    staple: q.staples?.[0] ?? f.staple,
    occasion: q.occasions?.[0] ?? f.occasion,
    vibe: q.vibes?.[0] ?? f.vibe,
    practical: q.practical?.[0] ?? f.practical,
    openNow: q.openNow ?? f.openNow,
  };
}

function extrasFromParsed(prev: Extras, q: DecideQuery): Extras {
  return {
    areaCenter: q.area ? q.areaCenter : prev.areaCenter,
    keywords: q.keywords,
    excludeCuisines: q.excludeCuisines,
    excludeTypes: q.excludeTypes,
    excludeStaples: q.excludeStaples,
    excludeOccasions: q.excludeOccasions,
    excludeVibes: q.excludeVibes,
    excludePractical: q.excludePractical,
  };
}

function summarize(f: Filters, text: string) {
  const bits: string[] = [];
  if (text) bits.push(text);
  if (f.area) bits.push(f.area);
  for (const k of ["cuisine", "type", "staple", "occasion", "vibe", "practical"] as const) {
    if (f[k]) bits.push(f[k]);
  }
  if (f.maxBudget != null) bits.push(`under ₹${f.maxBudget.toLocaleString("en-IN")}`);
  if (f.minRating != null) bits.push(`${f.minRating.toFixed(1)}+`);
  if (f.openNow) bits.push("open now");
  return bits.join(" · ");
}

async function geocodeQueryArea(q: DecideQuery): Promise<DecideQuery> {
  if (!q.area || q.areaCenter) return q;
  try {
    const hit = await geocodeArea(q.area);
    if (hit) return { ...q, area: hit.name, areaCenter: { lat: hit.lat, lng: hit.lng } };
  } catch {
    // Keep the area name fallback.
  }
  return q;
}

export default function AskSheet({
  open,
  onClose,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (q: DecideQuery, said: string) => void;
}) {
  const [nl, setNl] = useState("");
  const [thinking, setThinking] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [extras, setExtras] = useState<Extras>({});
  const [picker, setPicker] = useState<FilterField | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dirty = useMemo(
    () =>
      !!nl.trim() ||
      Object.entries(filters).some(([k, v]) => (k === "openNow" ? v === true : v != null && v !== "")) ||
      Object.values(extras).some((v) => (Array.isArray(v) ? v.length > 0 : v != null)),
    [nl, filters, extras]
  );
  const openCat = picker ? [...STANDARD_CATS, ...TAG_CATS].find((c) => c.id === picker) ?? null : null;
  const valueOf = (id: FilterField): string => {
    const v = filters[id];
    return v == null || v === "" ? "" : String(v);
  };

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      setNl("");
      setThinking(false);
      setFilters(EMPTY_FILTERS);
      setExtras({});
      setPicker(null);
      inputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setField = (id: FilterField, value: string) => {
    setFilters((f) => ({
      ...f,
      [id]: id === "maxBudget" || id === "minRating" ? (value ? Number(value) : null) : value,
    }));
    if (id === "area") setExtras((x) => ({ ...x, areaCenter: undefined }));
    setPicker(null);
  };

  const clear = () => {
    setNl("");
    setFilters(EMPTY_FILTERS);
    setExtras({});
    setPicker(null);
  };

  const parseAsk = async (): Promise<{ filters: Filters; extras: Extras; text: string }> => {
    const text = nl.trim();
    if (!text) return { filters, extras, text };
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
    q = await geocodeQueryArea(q);
    const nextFilters = mergeParsed(filters, q);
    const nextExtras = extrasFromParsed(extras, q);
    setFilters(nextFilters);
    setExtras(nextExtras);
    return { filters: nextFilters, extras: nextExtras, text };
  };

  const apply = async (parseText: boolean) => {
    if (thinking || !dirty) return;
    setThinking(true);
    const parsed = parseText ? await parseAsk() : { filters, extras, text: nl.trim() };
    const q = await geocodeQueryArea(buildQuery(parsed.filters, parsed.extras));
    setThinking(false);
    onApply(q, summarize(parsed.filters, parsed.text));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
        className="animate-rise absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4"
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
            Ask
          </span>
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                onClick={clear}
                className="press px-2 py-1 text-[12px] font-semibold"
                style={{ color: "var(--text-tertiary)" }}
              >
                Clear all
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close ask"
              className="press grid h-8 w-8 place-items-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
            >
              <X size={15} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        <div
          className="flex items-center gap-2 px-3"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <Sparkles size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
          <input
            ref={inputRef}
            value={nl}
            onChange={(e) => setNl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply(true)}
            placeholder="Somewhere cheap in Indiranagar…"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-[14px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          <button
            onClick={() => apply(true)}
            disabled={thinking || !dirty}
            className="press flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-40"
            style={{
              background: "oklch(0.97 0 0)",
              color: "oklch(0.16 0.006 260)",
              borderRadius: "var(--radius-chip)",
            }}
          >
            {thinking ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} strokeWidth={2.25} />}
            Ask
          </button>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {STANDARD_CATS.map((cat) => (
            <CatChip
              key={cat.id}
              cat={cat}
              value={valueOf(cat.id)}
              isOpen={picker === cat.id}
              onToggle={() => setPicker((p) => (p === cat.id ? null : cat.id))}
            />
          ))}
        </div>
        {openCat && STANDARD_CATS.some((c) => c.id === openCat.id) && (
          <ValueList cat={openCat} value={valueOf(openCat.id)} onPick={setField} />
        )}

        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="scroll-quiet flex gap-1.5 overflow-x-auto pb-0.5">
            {TAG_CATS.map((cat) => (
              <CatChip
                key={cat.id}
                cat={cat}
                value={valueOf(cat.id)}
                isOpen={picker === cat.id}
                onToggle={() => setPicker((p) => (p === cat.id ? null : cat.id))}
              />
            ))}
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
          {openCat && TAG_CATS.some((c) => c.id === openCat.id) && (
            <ValueList cat={openCat} value={valueOf(openCat.id)} onPick={setField} />
          )}
        </div>

        <button
          onClick={() => apply(!!nl.trim())}
          disabled={thinking || !dirty}
          className="press mt-4 flex w-full items-center justify-center gap-2 py-3 text-[14px] font-bold disabled:opacity-40"
          style={{
            background: "oklch(0.97 0 0)",
            color: "oklch(0.16 0.006 260)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {thinking ? <RefreshCw size={14} className="animate-spin" /> : <MapPin size={14} strokeWidth={2.25} />}
          Show on map
        </button>
      </div>
    </div>
  );
}

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
  const active = value !== "";
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
      <ChevronDown
        size={12}
        strokeWidth={2.5}
        style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
      />
    </button>
  );
}

function ValueList({
  cat,
  value,
  onPick,
}: {
  cat: Category;
  value: string;
  onPick: (id: FilterField, value: string) => void;
}) {
  const [customArea, setCustomArea] = useState("");
  const typedArea = customArea.trim();
  const values = [{ value: "", label: "Any" }, ...cat.values];
  return (
    <div
      className="animate-rise scroll-quiet mt-2 flex max-h-[34vh] flex-col gap-2 overflow-y-auto p-3"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
    >
      {cat.id === "area" && (
        <div
          className="flex items-center gap-2 px-3"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <MapPin size={14} strokeWidth={2.25} style={{ color: "var(--text-tertiary)" }} />
          <input
            value={customArea}
            onChange={(e) => setCustomArea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && typedArea) onPick("area", typedArea);
            }}
            placeholder="Type any area"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          <button
            onClick={() => typedArea && onPick("area", typedArea)}
            disabled={!typedArea}
            className="press px-3 py-1.5 text-[12px] font-bold disabled:opacity-40"
            style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
          >
            Use
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
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
    </div>
  );
}
