"use client";

import { Map as MapIcon, Layers } from "lucide-react";

export type AppMode = "map" | "swipe";

// The app has two ways of looking at the same places, and this is the only
// control that says so. It renders identically in both modes — on the map it
// sits in the dock, in swipe mode at the top — because a mode you reach through
// a button buried in another surface reads as that surface's feature. Two equal
// segments, side by side, present in both places: neither is a detour from the
// other.
export default function ModeSwitch({
  mode,
  onChange,
}: {
  mode: AppMode;
  onChange: (m: AppMode) => void;
}) {
  const OPTIONS: { key: AppMode; label: string; icon: React.ReactNode }[] = [
    { key: "map", label: "Map", icon: <MapIcon size={14} strokeWidth={2.25} /> },
    { key: "swipe", label: "Swipe", icon: <Layers size={14} strokeWidth={2.25} /> },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-1"
      style={{
        background: "var(--glass)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-chip)",
        padding: 3,
      }}
    >
      {OPTIONS.map((o) => {
        const on = mode === o.key;
        return (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            aria-pressed={on}
            className="press flex items-center justify-center gap-1.5 py-2 text-[13.5px] font-semibold transition-colors"
            style={{
              borderRadius: "calc(var(--radius-chip) - 3px)",
              background: on ? "oklch(0.97 0 0)" : "transparent",
              color: on ? "oklch(0.16 0.006 260)" : "oklch(0.86 0 0)",
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
