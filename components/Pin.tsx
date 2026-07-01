"use client";

import { Heart } from "lucide-react";
import type { ReactNode } from "react";

// Photo-disc pin: a round place thumbnail (or category SVG glyph fallback) inside
// a status-coloured ring, on a small stem. Selected pins grow + lift with a halo.
// Favorites get a heart badge. This is the headline visual — photo-forward,
// instantly recognisable, Beli-meets-map.
export default function Pin({
  photoUrl,
  glyph,
  color,
  active,
  favorite,
}: {
  photoUrl?: string;
  glyph: ReactNode;
  color: string;
  active: boolean;
  favorite?: boolean;
}) {
  const size = active ? 50 : 40;

  return (
    <div
      className="relative grid place-items-center transition-[width,height] duration-200"
      style={{ width: size, height: size + 7 }}
    >
      {/* stem */}
      <span
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: 0,
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: `7px solid ${color}`,
          filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.35))",
        }}
      />
      {/* disc */}
      <span
        className="absolute left-1/2 top-0 -translate-x-1/2 overflow-hidden rounded-full transition-all duration-200"
        style={{
          width: size,
          height: size,
          background: photoUrl ? `center/cover url(${photoUrl})` : "var(--bg-raised)",
          border: `${active ? 3 : 2.5}px solid ${color}`,
          boxShadow: active
            ? `0 0 0 3px rgba(255,255,255,0.9), 0 8px 18px rgba(0,0,0,0.45)`
            : `0 3px 8px rgba(0,0,0,0.4)`,
        }}
      >
        {!photoUrl && (
          <span
            className="grid h-full w-full place-items-center"
            style={{ color: "var(--text-primary)" }}
          >
            {glyph}
          </span>
        )}
      </span>

      {favorite && (
        <span
          className="absolute z-10 grid place-items-center rounded-full"
          style={{
            top: -2,
            right: -1,
            width: 17,
            height: 17,
            background: "var(--s-favorite)",
            border: "1.5px solid var(--bg-base)",
          }}
        >
          <Heart size={9} fill="#fff" strokeWidth={0} />
        </span>
      )}
    </div>
  );
}
