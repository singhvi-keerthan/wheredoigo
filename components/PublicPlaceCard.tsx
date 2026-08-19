"use client";

import { useState } from "react";
import Image from "next/image";
import { Star, Navigation, X, MapPin, Play } from "lucide-react";
import type { Place } from "@/lib/types";
import { leadPrice, leadRating, stateMeta, directionsUrl, photosSorted, hoursPill, referenceSourceLabel } from "@/lib/format";
import { PoweredBySwiggy } from "./PoweredBySwiggy";
import PlaceGlyph from "./PlaceGlyph";
import PhotoViewer from "./PhotoViewer";
import { useSheetDrag } from "./useSheetDrag";

// The share view's card — PlaceCard with every write removed, and nothing
// behind it. This is a separate component rather than a `readOnly` flag on
// PlaceCard on purpose: PlaceCard reaches straight into the store (addPhoto,
// addVisit, toggleNeverAgain, removePhoto), so a flag would mean every future
// affordance had to remember to check it, and one that forgot would let a
// stranger write to the library. This file imports no store function at all,
// which makes that class of mistake impossible instead of merely unlikely.
//
// Same information, same layout: identity, state, your score, what you spent,
// tags, photos, the reel, directions. What it drops is the tap-through — there
// is no detail sheet on /go, because the notes and the visit timeline that
// live there are the half of the record that stays private.
export default function PublicPlaceCard({ place, onClose }: { place: Place; onClose: () => void }) {
  const meta = stateMeta(place);
  const rating = leadRating(place);
  const price = leadPrice(place);
  const hours = hoursPill(place);
  const photos = photosSorted(place);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  return (
    <div
      ref={sheetRef}
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
        {...handleProps}
        className="mx-auto mb-3 block h-[5px] w-10 touch-none rounded-full"
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        {/* identity — a plain block here, not a button: nothing opens */}
        <div className="flex min-w-0 items-start gap-3.5 text-left sm:flex-1">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div
              className="relative grid h-[76px] w-[76px] place-items-center overflow-hidden"
              style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            >
              <PlaceGlyph place={place} size={30} strokeWidth={1.9} style={{ color: "var(--text-secondary)" }} />
              {hours && (
                <span
                  className="absolute inset-x-0 bottom-0 truncate px-1 text-center text-[9.5px] font-bold leading-[1.6]"
                  style={{ background: hours.color, color: "#fff" }}
                >
                  {hours.label}
                </span>
              )}
            </div>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-[3px] text-[11px] font-bold"
              style={{ borderRadius: "var(--radius-chip)", background: meta.color, color: "#fff" }}
            >
              {meta.label}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-[26px] leading-[1.02] tracking-[-0.005em]"
              style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
            >
              {place.name}
            </h2>

            {/* Wraps, unlike the app's own card: area + rating + a four-digit
                budget overflow 280px of usable width on a phone, and the thing
                that gets cut off is what he paid — which is half the reason to
                send someone this link at all. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
              {place.area && (
                <span className="inline-flex items-center gap-1" style={{ color: "var(--text-tertiary)" }}>
                  <MapPin size={11} strokeWidth={2} />
                  {place.area}
                </span>
              )}
              {rating.value != null && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-[2px]"
                  style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: rating.mine ? "var(--star)" : "var(--text-secondary)" }}
                >
                  <Star size={11} strokeWidth={0} fill="currentColor" />
                  {rating.value.toFixed(1)}
                  {/* "you" is Keerthan here, not the reader — this is his card */}
                  <span style={{ color: "var(--text-tertiary)" }}>{rating.mine ? "keerthan" : referenceSourceLabel(place)}</span>
                </span>
              )}
              <span style={{ color: "var(--text-secondary)" }}>{price.label}</span>
            </div>

            {place.tags.length > 0 && (
              <div className="mt-2 flex max-w-[300px] flex-wrap gap-1.5">
                {place.tags.slice(0, 8).map((t) => (
                  <span
                    key={t.namespace + t.value}
                    className="px-2.5 py-[4px] text-[11.5px]"
                    style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
                  >
                    {t.value}
                  </span>
                ))}
              </div>
            )}

            {/* Clause 3.4(ii): this card is a point of access for Swiggy MCP data */}
            {place.source === "swiggy" && <PoweredBySwiggy className="mt-2" />}
          </div>
        </div>

        {/* photos — view only, no add, no delete */}
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-[90px] sm:w-[204px] sm:shrink-0 sm:pl-0 sm:pt-1">
            {photos.map((ph, i) => (
              <button
                key={ph.id}
                onClick={() => setViewerIndex(i)}
                aria-label="View photo"
                className="press relative h-[60px] w-[60px] shrink-0 overflow-hidden"
                style={{ borderRadius: "var(--radius-sm)" }}
              >
                {/* Through the optimizer, not a raw <img>: the stored photos are
                    half a megabyte each, and this is a link people open on
                    mobile data. Three thumbnails would otherwise cost 1.5MB to
                    draw at 60px. The full-size original still loads when the
                    photo is actually opened. */}
                <Image src={ph.dataUrl} alt="" fill sizes="60px" className="object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`mt-3.5 ${place.reelUrl ? "grid grid-cols-2 gap-2" : ""}`}>
        {place.reelUrl && (
          <a
            href={place.reelUrl}
            target="_blank"
            rel="noreferrer"
            className="press flex items-center justify-center gap-2 py-3 text-[14px] font-bold"
            style={{ borderRadius: "var(--radius-chip)", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-strong)" }}
          >
            <span className="grid h-5 w-5 place-items-center rounded-[7px]" style={{ background: "linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5)" }}>
              <Play size={11} strokeWidth={0} fill="#fff" style={{ color: "#fff" }} />
            </span>
            Watch reel
          </a>
        )}
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
      </div>

      {viewerIndex !== null && (
        <PhotoViewer photos={photos} startIndex={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}
