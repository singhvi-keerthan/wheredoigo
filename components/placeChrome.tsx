"use client";

import type { CSSProperties } from "react";
import { Star, MapPin, MapPinOff, Clock, Play } from "lucide-react";
import { openStatus, type Place } from "@/lib/types";
import { leadPrice, leadRating, stateMeta, hoursPill, referenceSourceLabel } from "@/lib/format";
import PlaceGlyph from "./PlaceGlyph";

// The sheets' vocabulary — the map's chrome, continued onto ink.
//
// The map has two proven objects: the pin's sticker (a state-coloured disc
// with a type glyph, and a name) and the floating pill. Every interior in
// this file set starts from those two instead of from a form: one white pill
// per surface for the thing to press, quiet pills cut from the sheet for the
// rest, and the disc wherever a place is named. No dashed outlines, no boxed
// fields, no section eyebrows — a sheet that labels and borders everything
// reads as an admin editor, and that is the look that was called out.

export const WHITE_ACTION: CSSProperties = {
  background: "oklch(0.97 0 0)",
  color: "oklch(0.16 0.006 260)",
  borderRadius: "var(--radius-chip)",
};

export const INK_PILL: CSSProperties = {
  background: "rgba(255,255,255,0.07)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-primary)",
  borderRadius: "var(--radius-chip)",
};

// A pill that is lit — favourite on, skip on. State colour, never accent.
export function litPill(color: string): CSSProperties {
  return { background: color, border: `1px solid ${color}`, color: "#fff", borderRadius: "var(--radius-chip)" };
}

// The pin's disc at hand size: colour = state, glyph = type — the same two
// facts the map just showed, so a place reads as the pin opening rather than
// as a different object arriving.
export function StateDisc({ place, size = 44 }: { place: Place; size?: number }) {
  const meta = stateMeta(place);
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: meta.color, color: "#fff" }}
    >
      <PlaceGlyph place={place} size={Math.round(size * 0.46)} strokeWidth={2} />
    </span>
  );
}

const OPEN_WORD = { open: "open", closing_soon: "closes soon", closed: "closed" } as const;

// "■ Favorite · 9-11pm open" — the state said in a word (colour alone is a
// code only the map's author knows by heart), the hours in traffic-light
// colour AND a word, so open/closed survives a screen reader and a colour
// the eye can't name. The pill shows the window it's in if open, else the next
// one it opens into — the word is what tells those two apart.
export function StateLine({ place, className = "" }: { place: Place; className?: string }) {
  const meta = stateMeta(place);
  const hours = hoursPill(place);
  const status = openStatus(place.openingPeriods);
  return (
    <div className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${className}`}>
      <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: meta.color }} />
      <span style={{ color: meta.color }}>{meta.label}</span>
      {hours && status && (
        <span className="ml-1 inline-flex items-center gap-1 font-medium" style={{ color: hours.color }}>
          <Clock size={10} strokeWidth={2.25} />
          {hours.label} {OPEN_WORD[status.state]}
        </span>
      )}
    </div>
  );
}

// The data line, in mono: your rating leads once you've been, then price,
// then where — the swipe card's line, so the two surfaces say it the same way.
export function MetaLine({ place, where = true, className = "" }: { place: Place; where?: boolean; className?: string }) {
  const rating = leadRating(place);
  const price = leadPrice(place);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] ${className}`}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {rating.value != null ? (
        <span className="inline-flex items-center gap-1" style={{ color: rating.mine ? "var(--star)" : "var(--text-primary)" }}>
          <Star size={11} strokeWidth={0} fill="currentColor" />
          {rating.value.toFixed(1)}
          <span style={{ color: "var(--text-tertiary)" }}>{rating.mine ? "you" : referenceSourceLabel(place)}</span>
        </span>
      ) : (
        <span style={{ color: "var(--text-tertiary)" }}>Unrated</span>
      )}
      {/* A price only when one is known — a dash in the data line is noise. */}
      {(place.myBudgetPerPerson != null || place.googlePriceLevel != null) && (
        <span style={{ color: price.mine ? "var(--text-primary)" : "var(--text-secondary)" }}>{price.label}</span>
      )}
      {where && (place.area || place.approxLocation) && (
        <span className="inline-flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
          {place.approxLocation ? <MapPinOff size={10} strokeWidth={2} /> : <MapPin size={10} strokeWidth={2} />}
          {place.area || "Location unknown"}
          {place.approxLocation && place.area ? " · approx." : ""}
        </span>
      )}
    </div>
  );
}

// Instagram's gradient, kept to one small square — the reel's own colour and
// nothing else on the sheet is allowed to use it.
export function IgDot({ size = 20 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.35), background: "linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)" }}
    >
      <Play size={Math.round(size * 0.55)} strokeWidth={0} fill="#fff" style={{ color: "#fff" }} />
    </span>
  );
}

// Neutral chip — a tag is a category, never a state, so it gets no hue.
export const TAG_CHIP: CSSProperties = {
  borderRadius: "var(--radius-chip)",
  background: "rgba(255,255,255,0.07)",
  color: "var(--text-secondary)",
};
