"use client";

import { useMemo, useState } from "react";
import { Search, Sparkles, Plus } from "lucide-react";
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
            Nightfall
          </h1>
          <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
              {places.length}
            </span>{" "}
            places after dark · Bengaluru
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
          {/* filter rail — solid dark chips floating on the light map */}
          <div className="flex items-center gap-2 overflow-x-auto px-5 pb-2.5 scroll-quiet">
            <button
              onClick={() => setDecideOpen(true)}
              className="press flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-bold"
              style={{
                color: "#2a1505",
                background: "var(--grad-hero)",
                borderRadius: "var(--radius-chip)",
                boxShadow: "0 4px 14px rgba(200,71,79,0.3)",
              }}
            >
              <Sparkles size={13} strokeWidth={2.5} />
              Decide
            </button>
            <span className="h-4 w-px shrink-0" style={{ background: "rgba(0,0,0,0.14)" }} />
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className="press flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-[12.5px] font-semibold transition-colors"
                  style={{
                    borderRadius: "var(--radius-chip)",
                    background: on ? "var(--accent)" : "var(--bg-raised)",
                    color: on ? "var(--accent-ink)" : "var(--text-secondary)",
                    border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
                    boxShadow: "0 3px 12px rgba(0,0,0,0.3)",
                  }}
                >
                  {f.swatch && (
                    <span className="h-[8px] w-[8px] rounded-full" style={{ background: f.swatch }} />
                  )}
                  {f.label}
                </button>
              );
            })}
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
