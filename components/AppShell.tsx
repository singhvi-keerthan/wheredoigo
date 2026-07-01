"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Search, Plus } from "lucide-react";
import { usePlaces } from "@/lib/store";
import { displayState, type DisplayState } from "@/lib/types";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceDetail from "./PlaceDetail";
import CommandPalette from "./CommandPalette";
import DecideSheet from "./DecideSheet";

type FilterKey = "all" | DisplayState;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "watchlist", label: "Watchlist" },
  { key: "visited", label: "Been" },
  { key: "favorite", label: "Favorites" },
  { key: "never_again", label: "Skip" },
];

// Underline colour per filter — the locked V1 pin-system tokens (not the mock's
// guessed hues). "all" is neutral white.
const UNDERLINE: Record<FilterKey, string> = {
  all: "rgba(255,255,255,0.85)",
  watchlist: "var(--s-watchlist)",
  visited: "var(--s-visited)",
  favorite: "var(--s-favorite)",
  never_again: "var(--s-never)",
};

// Dark frosted glass — floats over the light map.
const GLASS: CSSProperties = {
  background: "rgba(22,24,30,0.66)",
  backdropFilter: "blur(22px) saturate(1.3)",
  WebkitBackdropFilter: "blur(22px) saturate(1.3)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px -12px rgba(0,0,0,0.5)",
};
// Solid white action (Decide + Add).
const WHITE_ACTION: CSSProperties = {
  background: "oklch(0.97 0 0)",
  color: "oklch(0.16 0.006 260)",
  boxShadow: "0 8px 22px -8px rgba(0,0,0,0.5)",
  border: "none",
};

export default function AppShell() {
  const places = usePlaces();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // ⌘K / Ctrl-K opens the search palette (matches the badge on the search dock).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          {/* filter rail — Decide (white action) + a dark-glass underline tray */}
          <div className="flex items-center gap-3 overflow-x-auto px-5 pb-2.5 scroll-quiet">
            <button
              onClick={() => setDecideOpen(true)}
              className="press shrink-0"
              style={{
                ...WHITE_ACTION,
                display: "inline-flex",
                alignItems: "center",
                height: 44,
                padding: "0 20px",
                borderRadius: 20,
                fontSize: 14.5,
                fontWeight: 640,
                letterSpacing: "-0.01em",
                cursor: "pointer",
              }}
            >
              Decide
            </button>

            {/* Filter tray — one dark-glass control, underline-select chips */}
            <div
              className="shrink-0"
              style={{
                ...GLASS,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: 6,
                borderRadius: 22,
              }}
            >
              {FILTERS.map((f) => {
                const on = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className="press shrink-0"
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                      height: 38,
                      padding: "0 15px",
                      borderRadius: 15,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 14,
                      letterSpacing: "-0.01em",
                      fontWeight: on ? 600 : 500,
                      color: on ? "oklch(0.98 0 0)" : "oklch(0.74 0.01 260)",
                    }}
                  >
                    {f.label}
                    <span
                      style={{
                        width: 18,
                        height: 3,
                        borderRadius: 2,
                        background: on ? UNDERLINE[f.key] : "transparent",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* search dock — drag handle + glass search + white add */}
          <div style={{ width: 38, height: 4, borderRadius: 3, background: "rgba(60,64,74,0.55)", margin: "0 auto 12px" }} />
          <div className="flex items-center gap-3 px-[18px] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => setPaletteOpen(true)}
              className="press flex flex-1 items-center gap-3 text-left"
              style={{ ...GLASS, height: 56, padding: "0 8px", borderRadius: 20, cursor: "text" }}
            >
              <span
                className="flex shrink-0 items-center justify-center"
                style={{ width: 40, height: 40, borderRadius: "50%", background: "oklch(0.32 0.01 260)", color: "oklch(0.95 0 0)" }}
              >
                <Search size={18} strokeWidth={2.25} />
              </span>
              <span className="flex-1" style={{ fontSize: 16, color: "oklch(0.6 0.01 260)", letterSpacing: "-0.01em" }}>
                Search a place
              </span>
              <kbd
                className="inline-flex items-center"
                style={{
                  height: 24,
                  padding: "0 8px",
                  borderRadius: 7,
                  background: "rgba(255,255,255,0.08)",
                  color: "oklch(0.62 0.01 260)",
                  fontSize: 12,
                  fontWeight: 600,
                  marginRight: 6,
                }}
              >
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Add a place"
              className="press flex shrink-0 items-center justify-center"
              style={{ ...WHITE_ACTION, width: 56, height: 56, borderRadius: 20, cursor: "pointer" }}
            >
              <Plus size={26} strokeWidth={2.5} />
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
