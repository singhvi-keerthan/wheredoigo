"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Search, Plus, Menu, MapPin, TriangleAlert, X } from "lucide-react";
import { usePlaces, usePersistError } from "@/lib/store";
import { displayState, type DisplayState } from "@/lib/types";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceDetail from "./PlaceDetail";
import CommandPalette from "./CommandPalette";
import AddPlaceSheet from "./AddPlaceSheet";
import DecideSheet from "./DecideSheet";
import PlaceWizard from "./PlaceWizard";
import MenuSheet from "./MenuSheet";
import BrowseSheet, { type BrowseMode } from "./BrowseSheet";

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

// One-time coach on the Decide mascot — most people don't guess a face-button
// is "help me pick". Shown once (persisted), a few seconds in.
const MASCOT_TIP_KEY = "wheredoigokeerthan.mascotTipSeen.v1";

export default function AppShell() {
  const places = usePlaces();
  const persistError = usePersistError();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState<string | null>(null); // palette → + sheet carry-over
  const [decideOpen, setDecideOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Visit-logging form. A fresh watchlist add opens NO form — its details come
  // from Google and the one-line note is taken on the add sheet. This only opens
  // for "I've already been here", which logs a retroactive visit in one go.
  const [visitPlaceId, setVisitPlaceId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); // the menu hub (browse + backup)
  const [browseMode, setBrowseMode] = useState<BrowseMode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decide-mascot explainer: mounts a few seconds after load, once ever. Read
  // the live place count from a ref so the single mount-time timer sees the
  // hydrated value without re-arming on every store change.
  const [mascotTip, setMascotTip] = useState(false);
  const [mascotTipShown, setMascotTipShown] = useState(false); // drives the fade
  const placesLenRef = useRef(places.length);
  useEffect(() => {
    placesLenRef.current = places.length;
  });
  const dismissMascotTip = () => {
    setMascotTipShown(false);
    try {
      localStorage.setItem(MASCOT_TIP_KEY, "1");
    } catch {
      /* private mode — worst case it shows again, harmless */
    }
    window.setTimeout(() => setMascotTip(false), 260); // fade, then unmount
  };
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(MASCOT_TIP_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (seen) return;
    let auto = 0;
    let reveal = 0;
    const t = window.setTimeout(() => {
      if (placesLenRef.current === 0) return; // nothing to decide yet — try next launch
      setMascotTip(true);
      reveal = window.setTimeout(() => setMascotTipShown(true), 30); // next tick → fade in
      auto = window.setTimeout(dismissMascotTip, 9000); // retire on its own if ignored
    }, 3600);
    return () => {
      clearTimeout(t);
      clearTimeout(auto);
      clearTimeout(reveal);
    };
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  };

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
      {/* Title row and menu share one line (menu centred on the name), with the
          count line tucked underneath — so the masthead reads as one unit, not
          a name floating above a lower-sitting button. */}
      <header className="fixed inset-x-0 top-0 z-10 px-5 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <h1
            className="font-medium leading-none tracking-[-0.015em]"
            style={{
              fontFamily: "var(--font-display)",
              color: "#16181d",
              // 26px everywhere ≥ ~313px wide; below that, scale so the full
              // 18-char name (≈8.8em in Zodiak) never clips against the menu
              // button (84px = side padding + button + gap).
              fontSize: "min(26px, calc((100vw - 84px) / 8.81))",
            }}
          >
            wheredoigokeerthan
          </h1>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            className="press grid h-9 w-9 place-items-center rounded-full"
            style={GLASS}
          >
            <Menu size={17} style={{ color: "oklch(0.9 0 0)" }} />
          </button>
        </div>
        <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
            {places.length}
          </span>{" "}
          places · Bengaluru
        </p>
      </header>

      {/* storage failure — silent persist loss is the one unforgivable state */}
      {persistError && (
        <div
          className="fixed inset-x-4 top-[max(4.6rem,calc(env(safe-area-inset-top)+3.6rem))] z-20 flex items-start gap-2 px-3.5 py-3"
          style={{ ...GLASS, borderRadius: "var(--radius-sm)", border: "1px solid oklch(0.6 0.17 15 / 0.5)" }}
        >
          <TriangleAlert size={15} className="mt-0.5 shrink-0" style={{ color: "var(--s-favorite)" }} />
          <p className="text-[12.5px] leading-snug" style={{ color: "oklch(0.92 0 0)" }}>
            {persistError}
          </p>
        </div>
      )}

      {/* empty state — real data only; no more sample pins */}
      {places.length === 0 && !addOpen && (
        <div className="pointer-events-none fixed inset-0 z-[5] grid place-items-center px-8">
          <div
            className="pointer-events-auto flex max-w-[320px] flex-col items-center px-6 py-7 text-center"
            style={{ ...GLASS, borderRadius: "var(--radius)" }}
          >
            <MapPin size={22} style={{ color: "var(--accent)" }} />
            <p className="mt-3 text-[17px] font-semibold" style={{ color: "oklch(0.95 0 0)" }}>
              Nothing pinned yet
            </p>
            <p className="mt-1 text-[13px] leading-snug" style={{ color: "oklch(0.72 0.01 260)" }}>
              Save the places you hear about — and never argue about where to go again.
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="press mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 text-[13.5px] font-bold"
              style={{ ...WHITE_ACTION, borderRadius: "var(--radius-chip)", cursor: "pointer" }}
            >
              <Plus size={15} strokeWidth={2.75} /> Add your first place
            </button>
          </div>
        </div>
      )}

      {/* toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(4.4rem,calc(env(safe-area-inset-top)+3.4rem))] z-[60] flex justify-center px-6">
          <div
            className="animate-rise px-4 py-2.5 text-[13px] font-medium"
            style={{ ...GLASS, borderRadius: "var(--radius-chip)", color: "oklch(0.93 0 0)" }}
          >
            {toast}
          </div>
        </div>
      )}

      {/* ===================== BOTTOM DOCK — controls in the thumb zone ===================== */}
      {selected ? (
        <div className="fixed inset-x-0 bottom-0 z-10">
          <PlaceCard place={selected} onClose={() => setSelectedId(null)} onOpen={() => setDetailId(selected.id)} />
        </div>
      ) : (
        <div className="fixed inset-x-0 bottom-0 z-10">
          {/* filter rail — Decide (white action) + a dark-glass underline tray.
              Same horizontal padding, gap, corner radius and 36px row height
              as the search dock below it, so the two rows read as one dock
              instead of two differently-sized ones stacked up. Sized to fit
              one line on a narrow phone with no horizontal swipe. */}
          <div className="relative flex items-center gap-2.5 px-[18px] pb-2">
            {/* one-time explainer bubble — points down at the mascot */}
            {mascotTip && (
              <div
                className="absolute bottom-full left-2.5 z-30 mb-2.5"
                style={{
                  opacity: mascotTipShown ? 1 : 0,
                  transform: mascotTipShown ? "translateY(0)" : "translateY(6px)",
                  transition: "opacity 240ms var(--ease-out), transform 240ms var(--ease-out)",
                }}
              >
                <div className="relative" style={{ ...GLASS, maxWidth: 252, borderRadius: 16, padding: "11px 13px" }}>
                  <button
                    onClick={dismissMascotTip}
                    aria-label="Dismiss"
                    className="press absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full"
                    style={{ color: "oklch(0.68 0 0)" }}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                  <p className="pr-4 text-[12.5px] leading-snug" style={{ color: "oklch(0.92 0 0)" }}>
                    <span className="font-semibold" style={{ color: "#fff" }}>Can’t decide?</span> Ask me and
                    I’ll deal your places one at a time — swipe till you land on tonight’s spot.
                  </p>
                  {/* tail — a rotated square peeking out the bottom, over the mascot */}
                  <span
                    className="absolute h-3 w-3 rotate-45"
                    style={{
                      left: 18,
                      top: "100%",
                      marginTop: -6,
                      background: "rgba(22,24,30,0.66)",
                      borderRight: "1px solid rgba(255,255,255,0.1)",
                      borderBottom: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                </div>
              </div>
            )}
            <button
              onClick={() => {
                dismissMascotTip();
                setDecideOpen(true);
              }}
              aria-label="Decide"
              className="press shrink-0 overflow-hidden"
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                border: "2px solid oklch(0.97 0 0)",
                boxShadow: "0 8px 22px -8px rgba(0,0,0,0.5)",
                cursor: "pointer",
              }}
            >
              <img src="/decide-mascot.png" alt="" className="h-full w-full object-cover" />
            </button>

            {/* Filter tray — one dark-glass control, underline-select chips */}
            <div
              className="min-w-0 flex-1"
              style={{
                ...GLASS,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "1px 3px",
                borderRadius: 18,
              }}
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
                    {/* Every chip reads as its word — the state hue stays on the
                        underline, per the pin-colour discipline. */}
                    {f.label}
                    <span
                      style={{
                        width: 14,
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

          {/* search dock — glass search + white add */}
          <div className="flex items-center gap-2.5 px-[18px] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <button
              onClick={() => setPaletteOpen(true)}
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
                Search your places
              </span>
              <kbd
                className="inline-flex items-center pointer-coarse:hidden"
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
              onClick={() => setAddOpen(true)}
              aria-label="Add a place"
              className="press flex shrink-0 items-center justify-center"
              style={{ ...WHITE_ACTION, width: 50, height: 50, borderRadius: 18, cursor: "pointer" }}
            >
              <Plus size={24} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={(id) => setSelectedId(id)}
        onAddNew={(carry) => {
          setPaletteOpen(false);
          setAddQuery(carry);
          setAddOpen(true);
        }}
      />

      {addOpen && (
        <AddPlaceSheet
          open={addOpen}
          onClose={() => {
            setAddOpen(false);
            setAddQuery(null);
          }}
          initialQuery={addQuery ?? undefined}
          // Adding drops the pin and selects it. A duplicate just reopens what's
          // already there; "been already" jumps straight into logging that
          // visit; a fresh watchlist add opens no form — Google fills the
          // details, the note was taken on the add sheet.
          onAdded={(id, opts) => {
            setSelectedId(id);
            if (opts?.duplicate) showToast("Already on your map — opened it");
            else if (opts?.beenAlready) setVisitPlaceId(id);
          }}
        />
      )}

      {visitPlaceId && (
        <PlaceWizard placeId={visitPlaceId} onClose={() => setVisitPlaceId(null)} />
      )}

      {menuOpen && (
        <MenuSheet
          onClose={() => setMenuOpen(false)}
          onOpenBrowse={(mode) => {
            setMenuOpen(false);
            setBrowseMode(mode);
          }}
          onToast={showToast}
        />
      )}

      {browseMode && (
        <BrowseSheet
          mode={browseMode}
          onClose={() => setBrowseMode(null)}
          onPick={(id) => {
            setBrowseMode(null);
            setMenuOpen(false);
            setSelectedId(id);
            setDetailId(id);
          }}
        />
      )}

      {decideOpen && (
        <DecideSheet
          open={decideOpen}
          onClose={() => setDecideOpen(false)}
          onView={(id) => {
            setSelectedId(id);
            setDetailId(id);
          }}
          onToast={showToast}
        />
      )}

      <PlaceDetail id={detailId} onClose={() => setDetailId(null)} />
    </main>
  );
}
