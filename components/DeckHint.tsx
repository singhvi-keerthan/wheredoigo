"use client";

import { type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

// First-run coach over the card: faint directional cues that imply each swipe,
// plus the keyboard equivalents for desktop. Non-interactive (pointer-events
// none) so it never intercepts a swipe, and low-contrast by design — it teaches,
// then fades on the first gesture. Shown once (SwipeDeck persists a seen flag).
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

export default function DeckHint({ visible }: { visible: boolean }) {
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

      {/* right = Add to watchlist */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        <div
          className="hint-x flex items-center gap-1"
          style={{ "--hint-dx": "9px", color: "var(--s-watchlist)" } as CSSProperties}
        >
          <span className="text-[12.5px] font-bold">Watchlist</span>
          <ChevronRight size={20} strokeWidth={2.75} />
        </div>
      </div>

      {/* up = Details */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2">
        <div className="hint-y flex flex-col items-center gap-0.5" style={{ color: "var(--accent)" }}>
          <ChevronUp size={20} strokeWidth={2.75} />
          <span className="text-[12.5px] font-bold">Details</span>
        </div>
      </div>

      {/* keyboard equivalents — desktop has no swipe */}
      <div
        className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full px-3 py-2"
        style={{ background: "rgba(10,10,14,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}
      >
        <Key>←</Key>
        <Key>↑</Key>
        <Key>→</Key>
        <span className="ml-1 text-[11.5px] font-medium" style={{ color: "rgba(255,255,255,0.72)" }}>
          or swipe
        </span>
      </div>
    </div>
  );
}
