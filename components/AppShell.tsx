"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Search, Plus, Menu, MapPin, TriangleAlert } from "lucide-react";
import { usePlaces, usePersistError } from "@/lib/store";
import { displayState, type DisplayState } from "@/lib/types";
import { cityLabel } from "@/lib/city";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceDetail from "./PlaceDetail";
import CommandPalette from "./CommandPalette";
import AddPlaceSheet from "./AddPlaceSheet";
import SwipeMode from "./SwipeMode";
import ModeSwitch, { type AppMode } from "./ModeSwitch";
import PlaceWizard from "./PlaceWizard";
import MenuSheet from "./MenuSheet";
import BrowseSheet, { type BrowseMode } from "./BrowseSheet";
import ModeReveal, { BEATS, type RevealSpec } from "./ModeReveal";

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

// The pin hue per state — the same tokens MapView gives its markers, so a place
// keeps its colour when the reveal picks it up off the map.
const STATE_COLOR: Record<DisplayState, string> = {
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
  const persistError = usePersistError();
  // "Bengaluru", "Bengaluru & Jaipur", or "4 cities" — see lib/city.ts.
  const where = useMemo(() => cityLabel(places), [places]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState<string | null>(null); // palette → + sheet carry-over
  // Map or Swipe. Two ways of looking at the same places, switched by ONE
  // control that this shell owns and renders above both of them — not a row in
  // the map's dock, and not a copy at the top of each mode. `swipeClosing` is
  // the leaving half: swipe mode stays mounted while it plays its outro, and
  // tells us when it's safe to drop.
  const [mode, setMode] = useState<AppMode>("map");
  const [swipeClosing, setSwipeClosing] = useState(false);
  // Going TO the deck is a reveal, not a mode flip: ModeReveal takes the screen
  // for ~1.9s and the deck mounts inside it. Coming back is a plain 190ms fade —
  // an exit should never make you wait.
  const [reveal, setReveal] = useState<RevealSpec | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const flick = useRef<{ x: number; t: number } | null>(null);

  // Where each place sits on screen right now, read straight off the map's
  // markers. Deliberately DOM-side: MapView owns the map instance, and the pins
  // it renders already carry their own position and state colour, so nothing
  // has to be plumbed through for the reveal to know what to pick up.
  const capturePins = (): RevealSpec["pins"] => {
    if (typeof document === "undefined") return [];
    const byName = new Map(places.map((p) => [p.name, p]));
    return [...document.querySelectorAll<HTMLElement>(".maplibregl-marker > button[aria-label]")]
      .map((node) => {
        const r = node.getBoundingClientRect();
        const place = byName.get(node.getAttribute("aria-label") ?? "");
        return {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          size: Math.max(11, Math.min(16, Math.min(r.width, r.height))),
          color: place ? STATE_COLOR[displayState(place)] : "var(--accent)",
        };
      })
      .filter((p) => p.x > -40 && p.y > -40 && p.x < window.innerWidth + 40 && p.y < window.innerHeight + 40);
  };

  // Beat 1 and 2, on the real chrome: the title compresses under your thumb,
  // then the masthead lifts off the top and the dock drops through the floor.
  // The mode switch is NOT in here — it holds its position through the whole
  // sequence, which is what says "same app" rather than "new screen".
  const clearTheStage = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ease = "cubic-bezier(0.5,0,0.75,0)";
    titleRef.current?.animate(
      [
        { transform: "scale(1)", letterSpacing: "-0.015em" },
        { transform: "scale(0.955)", letterSpacing: "-0.045em", offset: 0.5 },
        { transform: "scale(1.015)", letterSpacing: "-0.015em" },
      ],
      { duration: 200, easing: "cubic-bezier(0.34,1.56,0.64,1)" }
    );
    headerRef.current?.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(-46px)", opacity: 0 },
      ],
      { duration: 300, delay: BEATS.wash + 20, easing: ease, fill: "both" }
    );
    dockRef.current?.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(78px)", opacity: 0 },
      ],
      { duration: 340, delay: BEATS.wash + 40, easing: ease, fill: "both" }
    );
  };

  const openSwipe = (ox: number, oy: number) => {
    if (mode === "swipe" || reveal) return;
    clearTheStage();
    setReveal({ ox, oy, pins: capturePins() });
  };

  const changeMode = (m: AppMode) => {
    if (m === "swipe") {
      // The reveal starts under the control you actually pressed.
      const el = document.querySelector<HTMLElement>('[role="group"][aria-label="View"]');
      const r = el?.getBoundingClientRect();
      openSwipe(r ? r.left + r.width / 2 : window.innerWidth - 55, r ? r.top + r.height / 2 : 30);
    } else if (mode === "swipe") {
      setSwipeClosing(true); // SwipeMode fades out, then calls onClosed
    }
  };
  const leaveSwipe = () => {
    setMode("map");
    setSwipeClosing(false);
    setReveal(null);
  };
  const [detailId, setDetailId] = useState<string | null>(null);
  // Visit-logging form. A fresh watchlist add opens NO form — its details come
  // from Google and the one-line note is taken on the add sheet. This only opens
  // for "I've already been here", which logs a retroactive visit in one go.
  const [visitPlaceId, setVisitPlaceId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false); // the menu hub (browse + backup)
  const [browseMode, setBrowseMode] = useState<BrowseMode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      className={`relative w-full overflow-hidden${reveal ? " reveal-on" : ""}`}
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
      {/* The right padding is the mode switch's berth: it is rendered outside
          this header (it has to outrank swipe mode), so the header leaves it a
          hole rather than overlapping it. */}
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-10 pl-5 pr-[98px] pt-[max(0.9rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          {/* The hidden way in. Double-tap the app's own name, or flick across
              it, and the deck opens — the same reveal as the switch, started
              from wherever your thumb was. The switch is how you're meant to
              FIND the mode; this is how it's meant to feel once you know. */}
          <h1
            ref={titleRef}
            onDoubleClick={(e) => openSwipe(e.clientX, e.clientY)}
            onPointerDown={(e) => {
              flick.current = { x: e.clientX, t: e.timeStamp };
            }}
            onPointerUp={(e) => {
              const f = flick.current;
              flick.current = null;
              if (f && Math.abs(e.clientX - f.x) > 30 && e.timeStamp - f.t < 600) {
                openSwipe(e.clientX, e.clientY);
              }
            }}
            onPointerCancel={() => {
              flick.current = null;
            }}
            className="font-medium leading-none tracking-[-0.015em]"
            style={{
              touchAction: "pan-y",
              WebkitUserSelect: "none",
              userSelect: "none",
              fontFamily: "var(--font-display)",
              color: "#16181d",
              // Scales so the full 18-char name never clips against the
              // controls. The 18 characters measure 10.15em wide in Zodiak
              // (measured, not guessed — the 8.81 that used to be here was too
              // low and only survived because the reserve was smaller); 164px
              // is everything to the right of the name: gap, menu button, gap,
              // mode switch, and the page's own side padding.
              fontSize: "min(26px, calc((100vw - 164px) / 10.2))",
            }}
          >
            wheredoigokeerthan
          </h1>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            className="press grid h-9 w-9 shrink-0 place-items-center rounded-full"
            style={GLASS}
          >
            <Menu size={17} style={{ color: "oklch(0.9 0 0)" }} />
          </button>
        </div>
        {/* Count + where those places actually are. The city was hard-coded to
            Bengaluru, which quietly lied the moment a pin landed anywhere else;
            it is derived now, and says nothing at all rather than guess. */}
        <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
            {places.length}
          </span>{" "}
          {places.length === 1 ? "place" : "places"}
          {where && ` · ${where}`}
        </p>
      </header>

      {/* The one piece of chrome that belongs to the APP rather than to either
          mode. Rendered here, above swipe mode (z-52) and below any sheet it
          opens (z-54+), so it never unmounts and never moves: the map dissolves
          into the deck behind a control that stays exactly where your thumb
          left it. Its `mode` flips the instant you ask, not when the old mode
          finishes leaving — the thumb slides while the deck recedes. */}
      <div
        className="fixed right-5 top-[max(0.9rem,env(safe-area-inset-top))] z-[53]"
      >
        <ModeSwitch mode={swipeClosing ? "map" : mode} onChange={changeMode} />
      </div>

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
        <div ref={dockRef} className="fixed inset-x-0 bottom-0 z-10">
          {/* filter rail — Decide (white action) + a dark-glass underline tray.
              Same horizontal padding, gap, corner radius and 36px row height
              as the search dock below it, so the two rows read as one dock
              instead of two differently-sized ones stacked up. Sized to fit
              one line on a narrow phone with no horizontal swipe. */}
          {/* The dock is the MAP's controls and nothing else. Mode used to take
              a third row up here, which made app-level navigation read as one
              more filter and left the busiest corner of the screen with three
              stacked bars in it. */}
          <div className="relative flex items-center gap-2.5 px-[18px] pb-2">
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

      {reveal && (
        <ModeReveal
          spec={reveal}
          // the flash — the deck is dealt out of it
          onDeal={() => {
            setSwipeClosing(false);
            setMode("swipe");
          }}
          onDone={() => setReveal(null)}
        />
      )}

      {mode === "swipe" && (
        <SwipeMode
          entrance={reveal ? "fan" : "deal"}
          closing={swipeClosing}
          onRequestClose={() => setSwipeClosing(true)}
          onClosed={leaveSwipe}
          // The escape hatch at the bottom of a card: returns to the map and
          // opens the place, because PlaceDetail sits below the mode (z-40).
          // No outro here — a full-screen sheet is taking the screen anyway,
          // and animating out behind it would only delay it.
          onOpenSaved={(id) => {
            leaveSwipe();
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
