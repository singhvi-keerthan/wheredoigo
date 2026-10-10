"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";
import type { Photo } from "@/lib/types";
import { relativeDate } from "@/lib/format";

// Full-screen photo view — the swipe card's language, not a bare lightbox.
// The photo sits on the deck's ink, whole (contain: this is where you see the
// picture the sheet cropped), with the place's name in serif at the foot and
// the count in mono. Swipe between photos with native scroll-snap; the thin
// segments at the top say where you are, as they do on the card. Delete lives
// here, and only here, as a quiet glass circle.
export default function PhotoViewer({
  name,
  photos,
  startIndex,
  onClose,
  onDelete,
}: {
  // The place the photo belongs to; the share view passes none and the foot
  // shows only the count.
  name?: string;
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
  // Optional: the share view (/go) shows the same carousel with no way to
  // delete, so the button is absent rather than inert.
  onDelete?: (photoId: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => Math.min(startIndex, Math.max(0, photos.length - 1)));

  // Land on the tapped photo instantly — no animated scroll on open.
  useEffect(() => {
    const el = trackRef.current;
    if (el) el.scrollLeft = index * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A delete shrinks the array out from under the current scroll position —
  // clamp back onto the nearest surviving photo, or close once none are left.
  useEffect(() => {
    if (photos.length === 0) {
      onClose();
      return;
    }
    setIndex((i) => {
      const clamped = Math.min(i, photos.length - 1);
      const el = trackRef.current;
      if (clamped !== i && el) el.scrollLeft = clamped * el.clientWidth;
      return clamped;
    });
  }, [photos.length, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (photos.length === 0) return null;
  const current = photos[Math.min(index, photos.length - 1)];

  // Portal to <body> — a `fixed` element still gets scoped to the nearest
  // transformed/filtered ancestor's box instead of the real viewport, and
  // this is opened from deep inside animated, draggable sheets.
  return createPortal(
    <div className="mode-in fixed inset-0 z-[70]" style={{ background: "var(--deck-bg)" }}>
      <div
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="scroll-quiet flex h-full w-full snap-x snap-mandatory overflow-x-auto"
      >
        {photos.map((ph) => (
          <div key={ph.id} className="grid h-full w-full shrink-0 snap-center place-items-center" onClick={onClose}>
            <img
              src={ph.dataUrl}
              alt=""
              draggable={false}
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </div>

      {/* top: close · where you are · delete */}
      <div className="pointer-events-none fixed inset-x-0 top-0 flex items-center gap-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="press pointer-events-auto grid h-9 w-9 shrink-0 place-items-center rounded-full"
          style={GLASS_CIRCLE}
        >
          <X size={16} strokeWidth={2.25} />
        </button>
        <div className="flex flex-1 gap-1.5">
          {photos.length > 1 &&
            photos.map((ph, i) => (
              <span
                key={ph.id}
                className="h-[3px] flex-1 rounded-full"
                style={{
                  background: i === index ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.28)",
                  transition: "background 0.2s ease",
                }}
              />
            ))}
        </div>
        {onDelete ? (
          <button
            onClick={() => onDelete(current.id)}
            aria-label="Delete photo"
            className="press pointer-events-auto grid h-9 w-9 shrink-0 place-items-center rounded-full"
            style={GLASS_CIRCLE}
          >
            <Trash2 size={16} strokeWidth={2.25} />
          </button>
        ) : (
          <span className="h-9 w-9 shrink-0" />
        )}
      </div>

      {/* foot: whose photo this is */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16"
        style={{ background: "linear-gradient(0deg, rgba(6,7,10,0.84), rgba(6,7,10,0))" }}
      >
        {name && (
          <p className="text-[24px] leading-[1.05] tracking-[-0.005em]" style={{ fontFamily: "var(--font-serif)", color: "#fff" }}>
            {name}
          </p>
        )}
        <p className="mt-1 text-[12px]" style={{ fontFamily: "var(--font-mono)", color: "rgba(255,255,255,0.62)" }}>
          {photos.length > 1 ? `${index + 1} of ${photos.length} · ` : ""}
          {relativeDate(current.createdAt)}
          {current.source === "google" ? " · Google" : ""}
        </p>
      </div>
    </div>,
    document.body
  );
}

const GLASS_CIRCLE = {
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
} as const;
