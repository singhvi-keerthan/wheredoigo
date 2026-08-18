"use client";

import { type CSSProperties } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// First-run coach over the card: faint directional cues that imply each swipe,
// plus the keyboard equivalents for desktop. Non-interactive (pointer-events
// none) so it never intercepts a swipe, and low-contrast by design — it teaches,
// then fades on the first gesture. Shown once (SwipeMode persists a seen flag).
// Horizontal only: vertical now belongs to the card's own scroll, and the card
// carries its own "scroll for more" cue, so an up-arrow here would teach a
// gesture that no longer exists.
function Key({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="grid h-[22px] min-w-[22px] place-items-center rounded-[6px] px-1 text-[13px] font-semibold"
      style={{ border: "1px solid rgba(255,255,255,0.4)", color: "rgba(255,255,255,0.9)" }}
    >
      {children}
    </span>
  );
}

export default function DeckHint({
  visible,
  rightLabel,
}: {
  visible: boolean;
  // What a right swipe actually does depends on the card: a Swiggy find gets
  // saved, a place already on your map just gets picked. Teaching "Watchlist"
  // over a place you saved months ago promises something that never happens.
  rightLabel: string;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[6]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 450ms ease" }}
      aria-hidden
    >
      {/* Positioning (outer, static transform) is kept separate from the nudge
          animation (inner) — a CSS animation replaces the whole `transform`, so
          animating on the same element would drop the centering offset. */}

      {/* left = No */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2">
        <div
          className="hint-x flex items-center gap-1"
          style={{ "--hint-dx": "-9px", color: "var(--s-favorite)" } as CSSProperties}
        >
          <ChevronLeft size={20} strokeWidth={2.75} />
          <span className="text-[12.5px] font-bold">No</span>
        </div>
      </div>

      {/* right = save it (new) / pick it (saved) */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        <div
          className="hint-x flex items-center gap-1"
          style={{ "--hint-dx": "9px", color: "var(--s-watchlist)" } as CSSProperties}
        >
          <span className="text-[12.5px] font-bold">{rightLabel}</span>
          <ChevronRight size={20} strokeWidth={2.75} />
        </div>
      </div>

      {/* keyboard equivalents — desktop has no swipe */}
      <div
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 py-2"
        style={{ background: "rgba(10,10,14,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      >
        <Key>←</Key>
        <Key>→</Key>
        <span className="ml-1 text-[11.5px] font-medium" style={{ color: "rgba(255,255,255,0.72)" }}>
          or swipe
        </span>
      </div>
    </div>
  );
}
