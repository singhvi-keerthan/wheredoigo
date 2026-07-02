"use client";

import type { ReactNode } from "react";

// Colour = STATE, glyph = TYPE — never mixed. Three zoom-dependent renders so a
// growing map degrades gracefully instead of turning into overlapping name
// cards (MapView picks the variant; selected pins are always "full"):
//   full — the label-sticker: white card, state-coloured type-disc, place name.
//   disc — just the state-coloured type-disc (mid zoom).
//   dot  — a small state-coloured dot (city-wide zoom).
export type PinVariant = "full" | "disc" | "dot";

export default function Pin({
  name,
  glyph,
  color,
  active,
  variant = "full",
}: {
  name: string;
  glyph: ReactNode;
  color: string;
  active: boolean;
  variant?: PinVariant;
}) {
  if (variant === "dot") {
    return (
      <span
        className="block rounded-full"
        style={{
          width: 13,
          height: 13,
          background: color,
          border: "2px solid #fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
        }}
      />
    );
  }

  if (variant === "disc") {
    return (
      <span
        className="flex items-center justify-center"
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          background: color,
          color: "#fff",
          border: "2px solid #fff",
          boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
        }}
      >
        {glyph}
      </span>
    );
  }

  return (
    <div
      className="inline-flex flex-col items-center"
      style={{ transform: active ? "scale(1.06)" : "none", transition: "transform .12s ease" }}
    >
      <div
        className="inline-flex items-center gap-2"
        style={{
          height: 40,
          padding: "5px 15px 5px 5px",
          borderRadius: 13,
          background: "#fff",
          border: active ? `1.5px solid ${color}` : "1.5px solid transparent",
          boxShadow: "0 8px 18px -8px rgba(0,0,0,0.45)",
        }}
      >
        <span
          className="flex items-center justify-center"
          style={{ width: 30, height: 30, borderRadius: 9, background: color, color: "#fff" }}
        >
          {glyph}
        </span>
        <span
          className="max-w-[150px] truncate"
          style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "oklch(0.2 0.01 260)" }}
        >
          {name}
        </span>
      </div>
      {/* pointer */}
      <span
        style={{
          width: 0,
          height: 0,
          borderLeft: "7px solid transparent",
          borderRight: "7px solid transparent",
          borderTop: "9px solid #fff",
          marginTop: -1,
          filter: "drop-shadow(0 3px 2px rgba(0,0,0,0.18))",
        }}
      />
    </div>
  );
}
