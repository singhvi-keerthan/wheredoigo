"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Search, Plus } from "lucide-react";
import { usePlaces } from "@/lib/store";
import { displayState, type DisplayState } from "@/lib/types";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceDetail from "./PlaceDetail";
import CommandPalette from "./CommandPalette";
import DecideSheet from "./DecideSheet";

type FilterKey = "all" | DisplayState;

const FILTERS: { key: FilterKey; label: string; swatch?: string }[] = [
  { key: "all", label: "All" },
  { key: "watchlist", label: "Watchlist", swatch: "var(--s-watchlist)" },
  { key: "visited", label: "Been", swatch: "var(--s-visited)" },
  { key: "favorite", label: "Favorites", swatch: "var(--s-favorite)" },
  { key: "never_again", label: "Skip", swatch: "var(--s-never)" },
];

export default function AppShell() {
  const places = usePlaces();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === "all" ? places : places.filter((p) => displayState(p) === filter)),
    [places, filter]
  );
  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? null,
    [visible, selectedId]
  );

  return (
    <main
      className="relative w-full overflow-hidden"
      style={{ height: "100dvh", background: "var(--bg-base)" }}
    >
      <MapView places={visible} selectedId={selectedId} onSelect={setSelectedId} />

      {/* top scrim — light wash so the dark-ink masthead reads over the map */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-28"
        style={{ background: "linear-gradient(180deg, rgba(243,243,240,0.95), rgba(243,243,240,0))" }}
      />

      {/* ===================== MASTHEAD — dark ink on the light map ===================== */}
      <header className="fixed inset-x-0 top-0 z-10 flex items-end justify-between px-5 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <div>
          <h1
            className="text-[26px] font-medium leading-none tracking-[-0.015em]"
            style={{ fontFamily: "var(--font-display)", color: "#16181d" }}
          >
            im hungry
          </h1>
          <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
              {places.length}
            </span>{" "}
            places · Bengaluru
          </p>
        </div>
      </header>

      {/* ===================== BOTTOM DOCK — controls in the thumb zone ===================== */}
      {selected ? (
        <div className="fixed inset-x-0 bottom-0 z-10">
          <PlaceCard place={selected} onClose={() => setSelectedId(null)} onOpen={() => setDetailId(selected.id)} />
        </div>
      ) : (
        <div className="fixed inset-x-0 bottom-0 z-10">
          {/* filter rail — Decide (held apart) + a frosted segmented tray */}
          <div className="flex items-center gap-3 overflow-x-auto px-5 pb-2.5 scroll-quiet">
            {/* Decide — the mode, a solid ink pill */}
            <button
              onClick={() => setDecideOpen(true)}
              className="press shrink-0"
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 38,
                padding: "0 17px",
                borderRadius: 19,
                background: "oklch(0.2 0.008 260)",
                color: "oklch(0.97 0 0)",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.14), 0 8px 22px -8px rgba(0,0,0,0.5)",
              }}
            >
              Decide
            </button>

            {/* Filter tray — one frosted-glass segmented control */}
            <div
              className="shrink-0"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: 5,
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.65)",
                background: "rgba(255,255,255,0.52)",
                backdropFilter: "blur(22px) saturate(1.3)",
                WebkitBackdropFilter: "blur(22px) saturate(1.3)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 28px -12px rgba(0,0,0,0.4)",
              }}
            >
              {FILTERS.map((f) => {
                const on = filter === f.key;
                const c = f.swatch; // undefined for "all" — no pin colour
                const style: CSSProperties = {
                  display: "inline-flex",
                  alignItems: "center",
                  height: 30,
                  padding: "0 12px",
                  borderRadius: 13,
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                  color: "oklch(0.36 0.012 260)",
                  background: "transparent",
                  transition: "background .15s ease",
                };
                if (on && !c) {
                  // "All" active = neutral white lozenge
                  style.fontWeight = 600;
                  style.color = "oklch(0.2 0.01 260)";
                  style.background = "rgba(255,255,255,0.96)";
                  style.boxShadow = "0 2px 6px -2px rgba(0,0,0,0.18)";
                } else if (on && c) {
                  // category active = tinted in its pin colour
                  style.fontWeight = 600;
                  style.color = c;
                  style.padding = "0 13px";
                  style.background = `color-mix(in srgb, ${c} 16%, transparent)`;
                  style.boxShadow = `inset 0 0 0 1px color-mix(in srgb, ${c} 40%, transparent)`;
                }
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className="press shrink-0"
                    style={style}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* COMMAND ROW — search pill + an unmissable add button */}
          <div className="flex items-center gap-2.5 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => setPaletteOpen(true)}
              className="press flex flex-1 items-center gap-3 px-4 py-3.5 text-left"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-chip)",
                boxShadow: "var(--shadow-pop)",
              }}
            >
              <Search size={18} strokeWidth={2.25} style={{ color: "var(--text-secondary)" }} />
              <span className="text-[14.5px]" style={{ color: "var(--text-secondary)" }}>
                Search a place…
              </span>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Add a place"
              className="press grid h-[52px] w-[52px] shrink-0 place-items-center"
              style={{
                background: "var(--accent)",
                color: "var(--accent-ink)",
                borderRadius: "var(--radius-chip)",
                boxShadow: "var(--shadow-fab)",
              }}
            >
              <Plus size={24} strokeWidth={2.75} />
            </button>
          </div>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={(id) => setSelectedId(id)}
      />

      {decideOpen && (
        <DecideSheet
          open={decideOpen}
          onClose={() => setDecideOpen(false)}
          onView={(id) => {
            setSelectedId(id);
            setDetailId(id);
          }}
        />
      )}

      <PlaceDetail id={detailId} onClose={() => setDetailId(null)} />
    </main>
  );
}
