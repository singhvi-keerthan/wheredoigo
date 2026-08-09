"use client";

import { type CSSProperties } from "react";
import { Star, MapPin, Clock } from "lucide-react";
import { isOpenNow, type Place } from "@/lib/types";
import { coverPhoto, leadRating, leadPrice, stateMeta, hoursPill } from "@/lib/format";
import type { DeckCard } from "@/lib/deck";

// Normalised display fields, so the card renders the same shape whether it's a
// saved Place or a raw Swiggy result (which has no photos, tags or hours).
type CardView = {
  name: string;
  cover: string | null;
  ratingValue: number | null;
  ratingMine: boolean;
  priceLabel: string;
  area: string | null;
  chips: string[]; // cuisine/staple tags, or Swiggy cuisines
  reasons: string[];
  open: boolean | null;
  hours: { label: string; color: string } | null;
  badge: { label: string; color: string };
};

function savedView(place: Place, reasons: string[]): CardView {
  const cover = coverPhoto(place);
  const rating = leadRating(place);
  const meta = stateMeta(place);
  const chips = place.tags
    .filter((t) => t.namespace === "cuisine" || t.namespace === "staple")
    .map((t) => t.value);
  return {
    name: place.name,
    cover: cover?.dataUrl ?? null,
    ratingValue: rating.value,
    ratingMine: rating.mine,
    priceLabel: leadPrice(place).label,
    area: place.area ?? null,
    chips,
    reasons,
    open: isOpenNow(place.openingPeriods),
    hours: hoursPill(place),
    badge: { label: meta.label, color: meta.color },
  };
}

function newView(card: Extract<DeckCard, { kind: "new" }>): CardView {
  const { r } = card;
  return {
    name: r.name,
    cover: r.photo,
    ratingValue: r.rating,
    ratingMine: false,
    priceLabel: r.priceForTwo != null ? `₹${r.priceForTwo.toLocaleString("en-IN")} for two` : "—",
    area: r.area ?? null,
    chips: r.cuisines,
    reasons: [],
    open: null,
    hours: null,
    badge: { label: "New · Swiggy", color: "var(--accent)" },
  };
}

export function cardView(card: DeckCard): CardView {
  return card.kind === "saved" ? savedView(card.place, card.reasons) : newView(card);
}

// A single deck card — full-bleed photo (or a typographic fallback for a
// photo-less Swiggy result), bottom-anchored info, and a drag stamp overlay.
// Purely presentational: all gesture state lives in SwipeDeck.
export default function SwipeCard({
  card,
  style,
  stamp,
  interactive = true,
}: {
  card: DeckCard;
  style?: CSSProperties;
  stamp?: { label: string; color: string; opacity: number } | null;
  interactive?: boolean;
}) {
  const v = cardView(card);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        borderRadius: "var(--radius-lg)",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        boxShadow: "0 18px 40px -20px rgba(0,0,0,0.55)",
        userSelect: "none",
        WebkitUserSelect: "none",
        touchAction: interactive ? "none" : undefined,
        ...style,
      }}
    >
      {/* Typographic gradient always renders; the photo lays over it. Swiggy's
          images are remote CDN URLs, so a 404 or a blocked request degrades to
          the initial instead of leaving a blank card. */}
      <div
        className="absolute inset-0 grid place-items-center"
        style={{ background: "linear-gradient(155deg, oklch(0.34 0.05 265), oklch(0.22 0.03 265))" }}
      >
        <span
          className="text-[84px] leading-none opacity-25"
          style={{ fontFamily: "var(--font-serif)", color: "#fff" }}
        >
          {v.name.slice(0, 1).toUpperCase()}
        </span>
      </div>
      {v.cover && (
        // A real <img>, not a CSS background: Swiggy's photos are remote CDN
        // URLs, and an element gives us an onError to fall back to the initial
        // when one 404s. draggable=false keeps the native image drag from
        // hijacking the swipe gesture.
        <img
          src={v.cover}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}

      {/* scrim so the info reads over any photo */}
      <div
        className="absolute inset-x-0 bottom-0 h-3/5"
        style={{ background: "linear-gradient(0deg, rgba(6,7,10,0.92) 8%, rgba(6,7,10,0.55) 45%, transparent)" }}
      />

      {/* drag stamp — the Tinder tell: what a release right now commits to */}
      {stamp && stamp.opacity > 0.02 && (
        <div
          className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2"
          style={{
            opacity: Math.min(1, stamp.opacity),
            transform: `translateX(-50%) rotate(-11deg)`,
          }}
        >
          <span
            className="block px-4 py-1.5 text-[26px] font-extrabold uppercase tracking-[0.06em]"
            style={{
              color: stamp.color,
              border: `4px solid ${stamp.color}`,
              borderRadius: 12,
              textShadow: "0 1px 2px rgba(0,0,0,0.3)",
            }}
          >
            {stamp.label}
          </span>
        </div>
      )}

      {/* info */}
      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="flex items-center gap-1.5">
          <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: v.badge.color }} />
          <span className="text-[11.5px] font-semibold" style={{ color: v.badge.color }}>
            {v.badge.label}
          </span>
          {v.open === true && (
            <span className="ml-1 text-[11px] font-medium" style={{ color: "var(--s-watchlist)" }}>
              · Open now
            </span>
          )}
        </div>

        <h2
          className="mt-1 text-[30px] leading-[1.02] tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-serif)", color: "#fff" }}
        >
          {v.name}
        </h2>

        <div
          className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px]"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {v.ratingValue != null && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: v.ratingMine ? "var(--star)" : "rgba(255,255,255,0.85)" }}
            >
              <Star size={11} strokeWidth={0} fill="currentColor" />
              {v.ratingValue.toFixed(1)}
            </span>
          )}
          <span style={{ color: "rgba(255,255,255,0.8)" }}>{v.priceLabel}</span>
          {v.area && (
            <span className="inline-flex items-center gap-1" style={{ color: "rgba(255,255,255,0.7)" }}>
              <MapPin size={10} strokeWidth={2} />
              {v.area}
            </span>
          )}
          {v.hours && (
            <span className="inline-flex items-center gap-1" style={{ color: v.hours.color }}>
              <Clock size={10} strokeWidth={2} />
              {v.hours.label}
            </span>
          )}
        </div>

        {(v.reasons.length > 0 || v.chips.length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(v.reasons.length > 0 ? v.reasons : v.chips.slice(0, 3)).map((r) => (
              <span
                key={r}
                className="px-2 py-[3px] text-[11px] capitalize"
                style={{
                  borderRadius: "var(--radius-chip)",
                  background: "rgba(255,255,255,0.14)",
                  color: "rgba(255,255,255,0.92)",
                }}
              >
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
