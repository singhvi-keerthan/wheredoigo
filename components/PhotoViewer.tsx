"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trash2 } from "lucide-react";
import type { Photo } from "@/lib/types";

// Full-screen photo lightbox — swipe (native scroll-snap) between every photo
// on the place, opened from either the peek card's thumbnail strip or the
// detail sheet's carousel. Delete lives here (and as a small corner badge on
// the thumbnails) rather than a reveal-then-tap dance.
export default function PhotoViewer({
  photos,
  startIndex,
  onClose,
  onDelete,
}: {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
  onDelete: (photoId: string) => void;
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
    <div className="fixed inset-0 z-[70]" style={{ background: "rgba(6,7,10,0.97)" }}>
      <div
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="scroll-quiet flex h-full w-full snap-x snap-mandatory overflow-x-auto"
      >
        {photos.map((ph) => (
          <div
            key={ph.id}
            className="grid h-full w-full shrink-0 snap-center place-items-center px-2"
            onClick={onClose}
          >
            <img
              src={ph.dataUrl}
              alt=""
              className="max-h-full max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="press pointer-events-auto grid h-9 w-9 place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
        >
          <X size={16} strokeWidth={2.25} />
        </button>
        {photos.length > 1 && (
          <span
            className="font-[family-name:var(--font-mono)] text-[12px]"
            style={{ color: "rgba(255,255,255,0.7)" }}
          >
            {index + 1}/{photos.length}
          </span>
        )}
        <button
          onClick={() => onDelete(current.id)}
          aria-label="Delete photo"
          className="press pointer-events-auto grid h-9 w-9 place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
        >
          <Trash2 size={16} strokeWidth={2.25} />
        </button>
      </div>
    </div>,
    document.body
  );
}
