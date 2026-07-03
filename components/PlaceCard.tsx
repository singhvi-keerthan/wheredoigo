"use client";

import { useRef, useState } from "react";
import { Star, Navigation, X, ChevronRight, ImagePlus, Camera, Trash2, Check, Ban, MapPin } from "lucide-react";
import { displayState, type Place } from "@/lib/types";
import { addPhoto, removePhoto, addVisit, toggleNeverAgain } from "@/lib/store";
import { resizeImage } from "@/lib/image";
import { leadPrice, leadRating, stateMeta, directionsUrl, photosSorted } from "@/lib/format";
import PlaceGlyph from "./PlaceGlyph";
import { useSheetDrag } from "./useSheetDrag";

// Docked card shown when a pin is selected. Original order kept — status + name
// + score on the left. The photos option (show + add) fills the free space on
// the RIGHT of the name (desktop) / stacked above Directions (mobile).
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
  const watchlist = displayState(place) === "watchlist"; // show quick Been/Skip
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [revealId, setRevealId] = useState<string | null>(null); // tap a thumb → show delete
  const { sheetRef, handleProps } = useSheetDrag(onClose);

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
        {/* left: identity + name — tap to open */}
        <button onClick={onOpen} className="flex min-w-0 items-start gap-3.5 text-left sm:flex-1">
          {/* left column: category glyph with the status pill stacked below it */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div
              className="relative grid h-[76px] w-[76px] place-items-center overflow-hidden"
              style={{ borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
            >
              <PlaceGlyph place={place} size={30} strokeWidth={1.9} style={{ color: "var(--text-secondary)" }} />
            </div>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-[3px] text-[11px] font-bold"
              style={{ borderRadius: "var(--radius-chip)", background: meta.color, color: "#fff" }}
            >
              {meta.label}
            </span>
          </div>

          {/* right: name starts the line, then score, then wrapped tags */}
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-[26px] leading-[1.02] tracking-[-0.005em]"
              style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
            >
              {place.name}
            </h2>

            <div className="mt-1.5 flex items-center gap-2.5 text-[12.5px]" style={{ fontFamily: "var(--font-mono)" }}>
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
                  <span style={{ color: "var(--text-tertiary)" }}>{rating.mine ? "you" : "ggl"}</span>
                </span>
              )}
              <span style={{ color: "var(--text-secondary)" }}>{price.label}</span>
            </div>

            {/* tags — capped width; wrap (stack) beyond it so photos keep their room */}
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
          </div>

          <ChevronRight size={18} className="shrink-0 self-center sm:hidden" style={{ color: "var(--text-tertiary)" }} />
        </button>

        {/* right: photos — show + add. On desktop a right column beside the name;
            on mobile stacked below, indented to line up under the name. */}
        <div className="flex flex-wrap gap-2 pl-[90px] sm:w-[204px] sm:shrink-0 sm:pl-0 sm:pt-1">
          {photosSorted(place).map((ph) => {
            const revealed = revealId === ph.id;
            return (
              <div
                key={ph.id}
                onClick={() => setRevealId((cur) => (cur === ph.id ? null : ph.id))}
                className="relative h-[60px] w-[60px] shrink-0 cursor-pointer overflow-hidden"
                style={{ borderRadius: "var(--radius-sm)" }}
              >
                <img src={ph.dataUrl} alt="" className="h-full w-full object-cover" />
                {revealed && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removePhoto(place.id, ph.id); setRevealId(null); }}
                    aria-label="Remove photo"
                    className="absolute inset-0 grid place-items-center"
                    style={{ background: "rgba(6,8,13,0.55)", color: "#fff" }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={() => uploadRef.current?.click()}
            aria-label="Upload photo"
            className="press grid h-[60px] w-[60px] shrink-0 place-items-center"
            style={{ borderRadius: "var(--radius-sm)", border: "1px dashed var(--border-strong)", color: "var(--text-tertiary)" }}
          >
            <ImagePlus size={17} />
          </button>
          <button
            onClick={() => cameraRef.current?.click()}
            aria-label="Take photo"
            className="press grid h-[60px] w-[60px] shrink-0 place-items-center"
            style={{ borderRadius: "var(--radius-sm)", border: "1px dashed var(--border-strong)", color: "var(--text-tertiary)" }}
          >
            <Camera size={17} />
          </button>
        </div>
      </div>

      <input ref={uploadRef} type="file" accept="image/*" hidden onChange={onFile} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />

      {/* watchlist → quick log: been here / skip it (no drawer) */}
      {watchlist && (
        <div className="mt-3.5 grid grid-cols-2 gap-2">
          <button
            // Visited is always an appended visit (the timeline invariant), not
            // a bare status flip — quick action logs a minimal one dated today;
            // rating/notes can be added from the detail sheet.
            onClick={() =>
              addVisit(place.id, {
                visitedOn: new Date().toISOString().slice(0, 10),
                whoWith: "",
                notes: "",
                rating: null,
              })
            }
            className="press flex items-center justify-center gap-1.5 py-3 text-[13.5px] font-semibold"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
          >
            <Check size={15} strokeWidth={2.5} /> Been here
          </button>
          <button
            onClick={() => toggleNeverAgain(place.id)}
            className="press flex items-center justify-center gap-1.5 py-3 text-[13.5px] font-semibold"
            style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-secondary)" }}
          >
            <Ban size={15} strokeWidth={2.5} /> Skip
          </button>
        </div>
      )}

      <a
        href={directionsUrl(place)}
        target="_blank"
        rel="noreferrer"
        className={`press ${watchlist ? "mt-2" : "mt-3.5"} flex items-center justify-center gap-2 py-3 text-[14px] font-bold`}
        style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
      >
        <Navigation size={15} strokeWidth={2.5} fill="currentColor" />
        Directions
      </a>
    </div>
  );
}
