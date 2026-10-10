"use client";

import { useRef, useState } from "react";
import { Navigation, X, ChevronRight, Camera, Check, Ban } from "lucide-react";
import { displayState, type Place } from "@/lib/types";
import { addPhoto, removePhoto, addVisit, toggleNeverAgain } from "@/lib/store";
import { resizeImage } from "@/lib/image";
import { directionsUrl, photosSorted } from "@/lib/format";
import PhotoViewer from "./PhotoViewer";
import { useSheetDrag } from "./useSheetDrag";
import { StateDisc, StateLine, MetaLine, IgDot, WHITE_ACTION, INK_PILL, TAG_CHIP } from "./placeChrome";

// Docked card shown when a pin is selected: the pin's sticker, grown up. The
// state disc and the name are the two things the map just showed, so the card
// reads as the pin opening rather than a form arriving. One row of controls in
// thumb reach; photos are a strip you look at, not a drop zone with dashed
// tiles. Adding a photo is one quiet circle, and only once you've been — the
// OS picker offers the camera and the library itself, so the card no longer
// needs two tiles to say so.
export default function PlaceCard({
  place,
  onOpen,
  onClose,
}: {
  place: Place;
  onOpen: () => void;
  onClose: () => void;
}) {
  const watchlist = displayState(place) === "watchlist";
  const photos = photosSorted(place);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      try {
        const dataUrl = await resizeImage(file);
        addPhoto(place.id, { dataUrl, source: "mine", scope: "place", visitId: null });
      } catch {
        /* ignore bad image */
      }
    }
  };

  return (
    <div
      ref={sheetRef}
      className="animate-rise relative px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
      style={{
        background: "var(--bg-raised)",
        boxShadow: "var(--shadow-sheet)",
        borderTopLeftRadius: "var(--radius-lg)",
        borderTopRightRadius: "var(--radius-lg)",
      }}
    >
      <div {...handleProps} className="flex cursor-grab touch-none justify-center pb-3 pt-0.5">
        <span className="h-[5px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
      </div>
      <button
        onClick={onClose}
        aria-label="Close"
        className="press absolute right-4 top-3 z-10 grid h-8 w-8 place-items-center rounded-full"
        style={{ background: "rgba(255,255,255,0.07)", color: "var(--text-secondary)" }}
      >
        <X size={14} strokeWidth={2.25} />
      </button>

      {/* the sticker — tap anywhere on it to open the place */}
      <button onClick={onOpen} className="flex w-full items-start gap-3.5 pr-7 text-left">
        <StateDisc place={place} size={46} />
        <span className="min-w-0 flex-1">
          <StateLine place={place} />
          <h2
            className="mt-0.5 line-clamp-2 text-[25px] leading-[1.04] tracking-[-0.005em]"
            style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
          >
            {place.name}
          </h2>
          <MetaLine place={place} className="mt-1.5" />
        </span>
        <ChevronRight size={18} className="mt-3.5 shrink-0" style={{ color: "var(--text-tertiary)" }} />
      </button>

      {/* tags — the map's chips, five at most */}
      {place.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {place.tags.slice(0, 5).map((t) => (
            <span key={t.namespace + t.value} className="px-2.5 py-[4px] text-[11.5px]" style={TAG_CHIP}>
              {t.value}
            </span>
          ))}
          {place.tags.length > 5 && (
            <span className="px-2.5 py-[4px] text-[11.5px]" style={{ ...TAG_CHIP, color: "var(--text-tertiary)" }}>
              +{place.tags.length - 5}
            </span>
          )}
        </div>
      )}

      {/* photos — a strip to look at; one tap opens the viewer */}
      {photos.length > 0 && (
        <div className="scroll-quiet -mx-5 mt-3.5 flex gap-2 overflow-x-auto px-5">
          {photos.map((ph, i) => (
            <button
              key={ph.id}
              onClick={() => setViewerIndex(i)}
              aria-label="View photo"
              className="press h-[84px] w-[84px] shrink-0 overflow-hidden"
              style={{ borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)" }}
            >
              <img src={ph.dataUrl} alt="" draggable={false} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* one row: the thing to press, then the quick calls */}
      <div className="mt-3.5 flex items-center gap-2">
        <a
          href={directionsUrl(place)}
          target="_blank"
          rel="noreferrer"
          className="press flex h-12 min-w-0 flex-1 items-center justify-center gap-2 text-[14px] font-bold"
          style={WHITE_ACTION}
        >
          <Navigation size={15} strokeWidth={2.5} fill="currentColor" />
          Directions
        </a>
        {watchlist ? (
          <>
            <button
              // Visited is always an appended visit (the timeline invariant),
              // not a bare status flip — this logs a minimal one dated today;
              // rating and notes can be added from the place screen.
              onClick={() =>
                addVisit(place.id, {
                  visitedOn: new Date().toISOString().slice(0, 10),
                  whoWith: "",
                  notes: "",
                  rating: null,
                })
              }
              className="press flex h-12 shrink-0 items-center gap-1.5 px-4 text-[13.5px] font-semibold"
              style={INK_PILL}
            >
              <Check size={15} strokeWidth={2.5} /> Been
            </button>
            <button
              onClick={() => toggleNeverAgain(place.id)}
              aria-label="Skip it"
              className="press grid h-12 w-12 shrink-0 place-items-center"
              style={INK_PILL}
            >
              <Ban size={16} strokeWidth={2.25} />
            </button>
          </>
        ) : (
          <button
            onClick={() => uploadRef.current?.click()}
            aria-label="Add a photo"
            className="press grid h-12 w-12 shrink-0 place-items-center"
            style={INK_PILL}
          >
            <Camera size={17} strokeWidth={2} />
          </button>
        )}
        {place.reelUrl && (
          <a
            href={place.reelUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Watch the reel"
            className="press grid h-12 w-12 shrink-0 place-items-center"
            style={INK_PILL}
          >
            <IgDot size={20} />
          </a>
        )}
      </div>
      <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={onFile} />

      {viewerIndex !== null && (
        <PhotoViewer
          name={place.name}
          photos={photos}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onDelete={(id) => removePhoto(place.id, id)}
        />
      )}
    </div>
  );
}
