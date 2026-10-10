"use client";

import { useEffect, useRef } from "react";
import { Navigation, X, Star, MapPin } from "lucide-react";
import type { Place } from "@/lib/types";
import type { Pick } from "@/lib/picks";
import { coverPhoto, leadRating, leadPrice, stateMeta, directionsUrl } from "@/lib/format";

// The picks — what a run of the deck earned. A right swipe used to toast
// "Already on your map" and advance; now it keeps the place here, so the yeses
// of a session can be looked at together, compared, and left for. The sheet
// is deliberately the deck's own surface (solid ink, the deck's sheet
// vocabulary), not a second place screen: a row opens the full place screen,
// and Directions is right on the row so leaving for one is one tap.
//
// Rows are compact comparison lines, not cards: name, then the three facts
// the decision turns on in the card's own mono — locality, price basis, the
// rating with its provenance (your star is amber, like the card's).
export default function PicksSheet({
  picks,
  places,
  onClose,
  onOpen,
  onRemove,
  onClear,
}: {
  picks: Pick[];
  places: Place[];
  onClose: () => void;
  onOpen: (id: string) => void; // the full place screen (and its actions)
  onRemove: (id: string) => void; // drop the pick; the place itself stays
  onClear: () => void;
}) {
  const byId = new Map(places.map((p) => [p.id, p]));
  // A pick whose place is gone (deleted since) has nothing to show; it is
  // skipped here rather than shown as a blank row. SwipeMode prunes such
  // picks from the ledger while the sheet is open, so the header's count and
  // this list agree; until that effect lands, "Clear picks" stays reachable
  // whenever the ledger holds anything at all.
  const rows = picks.map((k) => byId.get(k.id)).filter((p): p is Place => !!p && !p.deletedAt);

  // A dialog takes focus when it opens and hands it back when it closes, so
  // the keyboard is in the sheet rather than on the deck it covers (the deck's
  // own controls are inert meanwhile — see SwipeMode `covered`).
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[54] flex flex-col justify-end"
      style={{ background: "rgba(6,7,10,0.6)" }}
      onClick={onClose}
    >
      <div
        className="animate-rise mx-auto flex max-h-[88dvh] w-full max-w-[560px] flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Your picks"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="eyebrow" style={{ color: "var(--accent)" }}>
            Your picks
            {rows.length > 0 && (
              <span className="ml-2" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                {rows.length}
              </span>
            )}
          </span>
          <button
            onClick={onClose}
            aria-label="Close picks"
            className="press grid h-8 w-8 place-items-center rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
          >
            <X size={15} strokeWidth={2.25} />
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              Nothing picked yet
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
              Swipe right on a place and it waits for you here.
            </p>
          </div>
        ) : (
          <ul className="scroll-quiet min-h-0 flex-1 overflow-y-auto py-2" aria-label="Picked places">
            {rows.map((p) => (
              <PickRow key={p.id} place={p} onOpen={() => onOpen(p.id)} onRemove={() => onRemove(p.id)} />
            ))}
          </ul>
        )}

        {picks.length > 0 && (
          <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={onClear} className="press px-2 py-3 text-[13.5px] font-semibold" style={{ color: "var(--text-tertiary)" }}>
              Clear picks
            </button>
            <button
              onClick={onClose}
              className="press px-5 py-3 text-[14px] font-bold"
              style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
            >
              Keep swiping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PickRow({ place, onOpen, onRemove }: { place: Place; onOpen: () => void; onRemove: () => void }) {
  const cover = coverPhoto(place);
  const rating = leadRating(place);
  const price = leadPrice(place);
  const meta = stateMeta(place);
  return (
    <li className="flex items-center gap-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <button onClick={onOpen} className="press flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Open ${place.name}`}>
        <span
          className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden"
          style={{
            borderRadius: "var(--radius-sm)",
            background: "linear-gradient(155deg, oklch(0.34 0.05 265), oklch(0.22 0.03 265))",
          }}
        >
          {cover?.dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover.dataUrl} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <span className="text-[26px] leading-none opacity-40" style={{ fontFamily: "var(--font-serif)", color: "#fff" }}>
              {place.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="h-[6px] w-[6px] shrink-0 rounded-[2px]" style={{ background: meta.color }} />
            <span className="truncate text-[18px] leading-tight" style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}>
              {place.name}
            </span>
          </span>
          <span
            className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}
          >
            {rating.value != null && (
              <span className="inline-flex items-center gap-1" style={{ color: rating.mine ? "var(--star)" : "var(--text-secondary)" }}>
                <Star size={10} strokeWidth={0} fill="currentColor" />
                {rating.value.toFixed(1)}
              </span>
            )}
            <span>{price.label}</span>
            {place.area && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={10} strokeWidth={2} />
                {place.area}
              </span>
            )}
          </span>
        </span>
      </button>
      <a
        href={directionsUrl(place)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Directions to ${place.name}`}
        className="press grid h-10 w-10 shrink-0 place-items-center rounded-full"
        style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)" }}
      >
        <Navigation size={15} strokeWidth={2.5} fill="currentColor" />
      </a>
      <button
        onClick={onRemove}
        aria-label={`Remove ${place.name} from picks`}
        className="press grid h-10 w-10 shrink-0 place-items-center rounded-full"
        style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
      >
        <X size={14} strokeWidth={2.5} />
      </button>
    </li>
  );
}
