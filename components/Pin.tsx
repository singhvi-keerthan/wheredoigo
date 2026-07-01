"use client";

import type { ReactNode } from "react";

// Label-sticker pin (color system §pins): a white card carrying a state-coloured
// type-disc (white glyph) + the place name, on a pointer. Colour = STATE, glyph =
// TYPE — never mixed. Selected grows slightly and gets a state-coloured hairline.
export default function Pin({
  name,
  glyph,
  color,
  active,
}: {
  name: string;
  glyph: ReactNode;
  color: string;
  active: boolean;
}) {
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
