"use client";

import { useRef } from "react";
import { Star, Navigation, X, ChevronRight, Clock, ImagePlus } from "lucide-react";
import type { Place } from "@/lib/types";
import { isOpenNow } from "@/lib/types";
import { addPhoto } from "@/lib/store";
import { resizeImage } from "@/lib/image";
import { leadPrice, stateMeta, directionsUrl } from "@/lib/format";
import PlaceGlyph from "./PlaceGlyph";

// Docked peek card shown when a pin is selected. Fills the width: photo + a rich
// detail column (both ratings, price, open-now, address, tags) with Directions
// on the right (desktop) / full-width below (mobile). Tap the body → full detail.
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
  const price = leadPrice(place);
  const photo = place.photos[0]?.dataUrl;
  const open = isOpenNow(place.openingPeriods);
  const tags = place.tags.slice(0, 8);
  const fileRef = useRef<HTMLInputElement>(null);

  // Quick-add a place photo straight from the card. A plain file input (no
  // `capture`) lets mobile offer Take Photo / Library natively; desktop opens
  // the picker. The full Upload/Take-photo pair lives in the detail sheet.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      addPhoto(place.id, { dataUrl, source: "mine", scope: "place", visitId: null });
    } catch {
      /* ignore bad image */
    }
    e.target.value = "";
  };

  return (
    <div
      className="animate-rise relative px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-6"
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
        className="mx-auto mb-3 block h-[5px] w-10 rounded-full sm:hidden"
        style={{ background: "var(--ink-line)" }}
      />
      <button
        onClick={onClose}
        aria-label="Close"
        className="press absolute right-4 top-3 z-10 grid h-7 w-7 place-items-center rounded-full"
        style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
      >
        <X size={14} strokeWidth={2.25} />
      </button>

      {/* one horizontal band on desktop; stacks on mobile */}
      <div className="mx-auto flex max-w-[1100px] flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 items-center gap-4 sm:flex-1">
          {/* photo / glyph tile — with a quick add-photo badge */}
          <div
            className="relative grid h-[84px] w-[84px] shrink-0 place-items-center overflow-hidden sm:h-[104px] sm:w-[104px]"
            style={{
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: photo ? `center/cover url(${photo})` : "var(--bg-elevated)",
            }}
          >
            {!photo && (
              <PlaceGlyph place={place} size={34} strokeWidth={1.9} style={{ color: "var(--text-secondary)" }} />
            )}
            <button
              onClick={() => fileRef.current?.click()}
              aria-label={photo ? "Add another photo" : "Add a photo"}
              className="press absolute bottom-1 right-1 grid h-[26px] w-[26px] place-items-center rounded-full"
              style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}
            >
              <ImagePlus size={14} strokeWidth={2.25} />
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

          <button onClick={onOpen} className="min-w-0 flex-1 text-left">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.05em]"
              style={{ borderRadius: "var(--radius-chip)", background: "rgba(255,255,255,0.08)", color: "var(--text-secondary)" }}
            >
              <span className="h-[6px] w-[6px] rounded-full" style={{ background: meta.color }} />
              {meta.label}
            </span>

            <h2
              className="mt-1 truncate text-[26px] leading-[1.02] tracking-[-0.005em] sm:text-[30px]"
              style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
            >
              {place.name}
            </h2>

            {/* metrics row — both ratings, price, open-now */}
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
              {place.myRating != null && (
                <Metric star value={place.myRating.toFixed(1)} tag="you" mine />
              )}
              {place.googleRating != null && (
                <Metric star value={place.googleRating.toFixed(1)} tag="ggl" />
              )}
              {price.label && <span style={{ color: "var(--text-secondary)" }}>{price.label}</span>}
              {open !== null && (
                <span className="inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                  <Clock size={11} style={{ color: "var(--text-tertiary)" }} />
                  {open ? "Open now" : "Closed"}
                </span>
              )}
            </div>

            {place.address && (
              <p className="mt-1 truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                {place.address}
              </p>
            )}

            {/* tags — wrap into the freed space */}
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t.namespace + t.value}
                    className="px-2.5 py-[3px] text-[11.5px]"
                    style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
                  >
                    {t.value}
                  </span>
                ))}
              </div>
            )}
          </button>

          <ChevronRight size={18} className="shrink-0 self-center sm:hidden" style={{ color: "var(--text-tertiary)" }} />
        </div>

        {/* Directions — right rail on desktop, full-width below on mobile */}
        <div className="flex shrink-0 flex-col gap-2 sm:w-[190px]">
          <a
            href={directionsUrl(place)}
            target="_blank"
            rel="noreferrer"
            className="press flex items-center justify-center gap-2 py-3 text-[14px] font-bold"
            style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
          >
            <Navigation size={15} strokeWidth={2.5} fill="currentColor" />
            Directions
          </a>
          <button
            onClick={onOpen}
            className="press hidden items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold sm:flex"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
          >
            Details <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({ value, tag, star, mine }: { value: string; tag: string; star?: boolean; mine?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[2px]"
      style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: mine ? "var(--star)" : "var(--text-secondary)" }}
    >
      {star && <Star size={11} strokeWidth={0} fill="currentColor" />}
      {value}
      <span style={{ color: "var(--text-tertiary)" }}>{tag}</span>
    </span>
  );
}
