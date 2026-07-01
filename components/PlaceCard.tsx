"use client";

import { Star, Navigation, X, ChevronRight } from "lucide-react";
import type { Place } from "@/lib/types";
import { leadPrice, leadRating, stateMeta, directionsUrl } from "@/lib/format";
import { placeEmoji } from "@/lib/icons";

// Docked card shown when a pin is selected. Photo-forward, rounded, with a Beli
// style status pill + score. Tap the body to open the full detail drawer.
export default function PlaceCard({
  place,
  onOpen,
  onClose,
}: {
  place: Place;
  onOpen: () => void;
  onClose: () => void;
}) {
  const meta = stateMeta(place);
  const rating = leadRating(place);
  const price = leadPrice(place);
  const photo = place.photos[0]?.dataUrl;

  return (
    <div
      className="animate-rise relative px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
      style={{
        background: "var(--bg-raised)",
        boxShadow: "var(--shadow-sheet)",
        borderTopLeftRadius: "var(--radius-lg)",
        borderTopRightRadius: "var(--radius-lg)",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="mx-auto mb-3 block h-[5px] w-10 rounded-full"
        style={{ background: "var(--ink-line)" }}
      />
      <button
        onClick={onClose}
        aria-label="Close"
        className="press absolute right-4 top-3 grid h-7 w-7 place-items-center rounded-full"
        style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
      >
        <X size={14} strokeWidth={2.25} />
      </button>

      <button onClick={onOpen} className="flex w-full items-center gap-3.5 text-left">
        {/* photo / emoji tile */}
        <div
          className="relative grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden"
          style={{
            borderRadius: "var(--radius)",
            border: "1px solid var(--border)",
            background: photo ? `center/cover url(${photo})` : "var(--bg-elevated)",
          }}
        >
          {!photo && <span style={{ fontSize: 30, lineHeight: 1 }}>{placeEmoji(place)}</span>}
        </div>

        <div className="min-w-0 flex-1">
          <span
            className="inline-flex items-center gap-1.5 px-2 py-[3px] text-[11px] font-bold"
            style={{ borderRadius: "var(--radius-chip)", background: meta.color, color: "#fff" }}
          >
            {meta.label}
          </span>

          <h2
            className="mt-1.5 truncate text-[24px] font-medium leading-[1.05] tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {place.name}
          </h2>

          <div className="mt-1.5 flex items-center gap-2.5 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
            {rating.value != null && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-[2px]"
                style={{
                  borderRadius: "var(--radius-chip)",
                  background: rating.mine ? "var(--accent-soft)" : "var(--bg-elevated)",
                  color: rating.mine ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                <Star size={11} strokeWidth={0} fill="currentColor" />
                {rating.value.toFixed(1)}
                <span style={{ color: "var(--text-tertiary)" }}>{rating.mine ? "you" : "ggl"}</span>
              </span>
            )}
            <span style={{ color: "var(--text-secondary)" }}>{price.label}</span>
          </div>
        </div>

        <ChevronRight size={18} className="shrink-0 self-center" style={{ color: "var(--text-tertiary)" }} />
      </button>

      {place.tags.length > 0 && (
        <div className="no-bar mt-3 flex gap-1.5 overflow-x-auto">
          {place.tags.slice(0, 6).map((t) => (
            <span
              key={t.namespace + t.value}
              className="shrink-0 px-2.5 py-[4px] text-[11.5px]"
              style={{
                borderRadius: "var(--radius-chip)",
                background: "var(--bg-elevated)",
                color: "var(--text-secondary)",
              }}
            >
              {t.value}
            </span>
          ))}
        </div>
      )}

      <a
        href={directionsUrl(place)}
        target="_blank"
        rel="noreferrer"
        className="press mt-3.5 flex items-center justify-center gap-2 py-3 text-[14px] font-bold"
        style={{ background: "var(--accent)", color: "var(--accent-ink)", borderRadius: "var(--radius-chip)" }}
      >
        <Navigation size={15} strokeWidth={2.5} fill="currentColor" />
        Directions
      </a>
    </div>
  );
}
