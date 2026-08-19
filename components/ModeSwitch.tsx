"use client";

import { Map as MapIcon, Layers } from "lucide-react";

export type AppMode = "map" | "swipe";

// Geometry, shared by the thumb and the segments so they can never drift.
const PAD = 3;
const SEG_W = 32;
const SEG_H = 30;

// The app has two ways of looking at the same places, and this is the only
// control that says so.
//
// It used to be a full-width, two-word pill sitting in the map's bottom dock —
// a third row above the filters and the search bar. That put app-level
// navigation inside the map's tool cluster, where it read as one more filter,
// and it made the busiest corner of the screen busier still. It now lives in
// the app's top-right chrome next to the menu, rendered ONCE by AppShell above
// both modes: the same control, at the same coordinates, whichever mode you're
// in. Nothing about it moves when the world behind it changes — which is what
// lets the mode change read as a reveal rather than a screen swap.
//
// Icons, not words, because it has to fit beside the masthead without shrinking
// the app's name; the sliding white thumb is what makes it read as a toggle.
export default function ModeSwitch({
  mode,
  onChange,
}: {
  mode: AppMode;
  onChange: (m: AppMode) => void;
}) {
  const OPTIONS: { key: AppMode; label: string; icon: React.ReactNode }[] = [
    { key: "map", label: "Map", icon: <MapIcon size={15} strokeWidth={2.25} /> },
    { key: "swipe", label: "Swipe — decide one by one", icon: <Layers size={15} strokeWidth={2.25} /> },
  ];

  return (
    <div
      className="relative grid grid-cols-2"
      role="group"
      aria-label="View"
      style={{
        width: SEG_W * 2 + PAD * 2,
        height: SEG_H + PAD * 2,
        padding: PAD,
        background: "var(--glass)",
        backdropFilter: "blur(22px) saturate(1.3)",
        WebkitBackdropFilter: "blur(22px) saturate(1.3)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "var(--radius-chip)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px -12px rgba(0,0,0,0.5)",
      }}
    >
      {/* One thumb that slides, rather than a background that blinks between
          two buttons — the movement is the feedback, and it survives being
          interrupted mid-slide. */}
      <span
        aria-hidden
        className="absolute"
        style={{
          top: PAD,
          left: PAD,
          width: SEG_W,
          height: SEG_H,
          borderRadius: "var(--radius-chip)",
          background: "oklch(0.97 0 0)",
          transform: `translateX(${mode === "swipe" ? SEG_W : 0}px)`,
          transition: "transform 0.28s var(--ease-spring)",
        }}
      />
      {OPTIONS.map((o) => {
        const on = mode === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            aria-label={o.label}
            aria-pressed={on}
            className="press relative grid place-items-center"
            style={{
              height: SEG_H,
              borderRadius: "var(--radius-chip)",
              color: on ? "oklch(0.16 0.006 260)" : "oklch(0.82 0 0)",
              transition: "color 0.22s ease",
            }}
          >
            {o.icon}
          </button>
        );
      })}
    </div>
  );
}
