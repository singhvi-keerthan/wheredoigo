"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Search, MapPin } from "lucide-react";
import { displayState, type DisplayState, type Place } from "@/lib/types";
import { cityLabel } from "@/lib/city";
import MapView from "./MapView";
import PublicPlaceCard from "./PublicPlaceCard";
import PublicSearch from "./PublicSearch";

// The share view: AppShell's map, with everything that writes taken out.
//
// Same map, same pins, same filters, same card — because the answer to "where
// do I go" is the map Keerthan actually uses, not a prettier read-only
// rendering of it. What's gone is the half that only makes sense if the
// library is yours: add, the menu, swipe mode, and the tap-through to the
// detail sheet.
//
// The one thing this screen has that the app doesn't is the stamp: how fresh
// what you're looking at actually is.

type FilterKey = "all" | DisplayState;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "watchlist", label: "Watchlist" },
  { key: "visited", label: "Been" },
  { key: "favorite", label: "Favorites" },
  { key: "never_again", label: "Skip" },
];

const UNDERLINE: Record<FilterKey, string> = {
  all: "rgba(255,255,255,0.85)",
  watchlist: "var(--s-watchlist)",
  visited: "var(--s-visited)",
  favorite: "var(--s-favorite)",
  never_again: "var(--s-never)",
};

const GLASS: CSSProperties = {
  background: "rgba(22,24,30,0.66)",
  backdropFilter: "blur(22px) saturate(1.3)",
  WebkitBackdropFilter: "blur(22px) saturate(1.3)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px -12px rgba(0,0,0,0.5)",
};

export default function PublicShell({ places, updatedAgo }: { places: Place[]; updatedAgo: string | null }) {
  const where = useMemo(() => cityLabel(places), [places]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(
    () => (filter === "all" ? places : places.filter((p) => displayState(p) === filter)),
    [places, filter]
  );
  const selected = useMemo(() => visible.find((p) => p.id === selectedId) ?? null, [visible, selectedId]);

  return (
    <main className="relative w-full overflow-hidden" style={{ height: "100dvh", background: "var(--bg-base)" }}>
      <MapView places={visible} selectedId={selectedId} onSelect={setSelectedId} shared />

      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-28"
        style={{ background: "linear-gradient(180deg, rgba(243,243,240,0.95), rgba(243,243,240,0))" }}
      />

      <header className="fixed inset-x-0 top-0 z-10 px-5 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <h1
          className="font-medium leading-none tracking-[-0.015em]"
          style={{
            fontFamily: "var(--font-display)",
            color: "#16181d",
            // Same measured fit as the app's masthead, minus the 164px of
            // controls this screen doesn't have — only the page padding.
            fontSize: "min(26px, calc((100vw - 40px) / 10.2))",
          }}
        >
          wheredoigokeerthan
        </h1>
        <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>{places.length}</span>{" "}
          {places.length === 1 ? "place" : "places"}
          {where && ` · ${where}`}
          {updatedAgo && ` · updated ${updatedAgo}`}
        </p>
      </header>

      {places.length === 0 && (
        <div className="pointer-events-none fixed inset-0 z-[5] grid place-items-center px-8">
          <div className="pointer-events-auto flex max-w-[320px] flex-col items-center px-6 py-7 text-center" style={{ ...GLASS, borderRadius: "var(--radius)" }}>
            <MapPin size={22} style={{ color: "var(--accent)" }} />
            <p className="mt-3 text-[17px] font-semibold" style={{ color: "oklch(0.95 0 0)" }}>
              Nothing here yet
            </p>
            <p className="mt-1 text-[13px] leading-snug" style={{ color: "oklch(0.72 0.01 260)" }}>
              This map hasn’t been shared with anything on it.
            </p>
          </div>
        </div>
      )}

      {selected ? (
        <div className="fixed inset-x-0 bottom-0 z-10">
          <PublicPlaceCard place={selected} onClose={() => setSelectedId(null)} />
        </div>
      ) : (
        <div className="fixed inset-x-0 bottom-0 z-10">
          <div className="relative flex items-center gap-2.5 px-[18px] pb-2">
            <div
              className="min-w-0 flex-1"
              style={{ ...GLASS, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1px 3px", borderRadius: 18 }}
            >
              {FILTERS.map((f) => {
                const on = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    aria-label={f.label}
                    className="press min-w-0 flex-1"
                    style={{
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                      height: 34,
                      padding: "0 4px",
                      borderRadius: 13,
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 12.5,
                      letterSpacing: "-0.01em",
                      fontWeight: on ? 600 : 500,
                      color: on ? "oklch(0.98 0 0)" : "oklch(0.74 0.01 260)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {f.label}
                    <span style={{ width: 14, height: 3, borderRadius: 2, background: on ? UNDERLINE[f.key] : "transparent" }} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* search takes the whole row — there is no + on this screen */}
          <div className="flex items-center px-[18px] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => setSearchOpen(true)}
              className="press flex flex-1 items-center gap-2.5 text-left"
              style={{ ...GLASS, height: 50, padding: "0 7px", borderRadius: 18, cursor: "text" }}
            >
              <span
                className="flex shrink-0 items-center justify-center"
                style={{ width: 36, height: 36, borderRadius: "50%", background: "oklch(0.32 0.01 260)", color: "oklch(0.95 0 0)" }}
              >
                <Search size={17} strokeWidth={2.25} />
              </span>
              <span className="flex-1" style={{ fontSize: 15, color: "oklch(0.6 0.01 260)", letterSpacing: "-0.01em" }}>
                Search these places
              </span>
              <kbd
                className="inline-flex items-center pointer-coarse:hidden"
                style={{ height: 24, padding: "0 8px", borderRadius: 7, background: "rgba(255,255,255,0.08)", color: "oklch(0.62 0.01 260)", fontSize: 12, fontWeight: 600, marginRight: 6 }}
              >
                ⌘K
              </kbd>
            </button>
          </div>
        </div>
      )}

      <PublicSearch open={searchOpen} places={places} onClose={() => setSearchOpen(false)} onPick={(id) => setSelectedId(id)} />
    </main>
  );
}
