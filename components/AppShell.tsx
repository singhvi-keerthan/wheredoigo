"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { Search, Plus, Menu, MapPin, TriangleAlert, X } from "lucide-react";
import { usePlaces, usePersistError } from "@/lib/store";
import { displayState, type DisplayState } from "@/lib/types";
import { cityLabel } from "@/lib/city";
import MapView from "./MapView";
import PlaceCard from "./PlaceCard";
import PlaceDetail from "./PlaceDetail";
import CommandPalette from "./CommandPalette";
import AddPlaceSheet from "./AddPlaceSheet";
import SwipeMode from "./SwipeMode";
import PlaceWizard from "./PlaceWizard";
import MenuSheet from "./MenuSheet";
import AskSheet from "./AskSheet";
import { narrowToAsk, type DecideQuery } from "@/lib/decide";
import BrowseSheet, { type BrowseMode } from "./BrowseSheet";
import ModeReveal, { BEATS, type RevealSpec } from "./ModeReveal";
import SignUpSheet, { type SignUpReason } from "./SignUpSheet";
import { useSyncStatus } from "@/lib/sync/client";

// The app's two ways of looking at the same places. There is no control for
// this any more: the wordmark IS the toggle, in both modes. Double-tap it or
// swipe across it. A segmented pill said the same thing in a second voice, and
// on the map it was a third row of chrome in the busiest corner of the screen.
type AppMode = "map" | "swipe";

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
  background: "var(--glass)", // the token, not a copy of it — see --glass
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

const MASCOT_TIP_KEY = "wheredoigokeerthan.mascotTipSeen.v1";

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

  // Sign-up is asked for at the moment it starts mattering, never on arrival:
  // reading the map is free, keeping something is not. `gate` runs the action
  // straight through for anyone already connected, and otherwise parks it
  // behind the sheet and replays it the instant they are.
  const sync = useSyncStatus();
  const [signUp, setSignUp] = useState<SignUpReason | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const gate = (reason: SignUpReason, run: () => void) => {
    if (sync.connected) {
      run();
      return;
    }
    pendingAction.current = run;
    setSignUp(reason);
  };
  const headerRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const flick = useRef<{ x: number; t: number } | null>(null);
  // The gesture's label: names the way through for a few seconds after you
  // arrive in a mode, and then goes. Not permanent — an instruction that never
  // leaves stops being read, and this is the only thing left that says the
  // name is pressable, so it has to stay worth reading.
  const [tell, setTell] = useState(true);
  // How far the name has to travel to sit in the middle of its row.
  const [centerShift, setCenterShift] = useState(0);
  // Where the wordmark's box actually ends on THIS screen. The deck hangs its
  // own second line and its card stage off this rather than off a tuned number.
  const [nameBottom, setNameBottom] = useState(0);

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
  // The wordmark is NOT in here — it holds its position through the whole
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
    // Everything AROUND the name leaves; the name itself holds its position
    // through the whole sequence. It's the anchor — the thing that says this is
    // still the same app — and on the far side of the flash it's the header the
    // deck keeps. (React unmounts the count line when the mode flips; this
    // carries it out before that happens.)
    countRef.current?.animate(
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(-22px)", opacity: 0 },
      ],
      { duration: 260, delay: BEATS.wash + 20, easing: ease, fill: "both" }
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
    // Gated before the stage clears: the reveal animation is a one-way door and
    // playing it behind a sign-up sheet would leave the map torn down underneath.
    gate("swipe", () => {
      clearTheStage();
      setReveal({ ox, oy, pins: capturePins() });
    });
  };

  // The wordmark is the toggle now, so it needs to know which way it points.
  // `inDeck` is true from the first frame of the reveal, not from the flash —
  // the header has to outrank the reveal layer and turn to light with it.
  const inDeck = mode === "swipe" || !!reveal;
  const onMap = !inDeck;
  const toggleByTitle = (x: number, y: number) => {
    if (inDeck) {
      if (!swipeClosing) setSwipeClosing(true);
    } else {
      openSwipe(x, y);
    }
  };

  // Re-armed on every mode change: the cleanup puts the label back up, the
  // timer takes it down again. Deliberately not set at the head of the effect —
  // a run shouldn't open by setting state during its own first commit.
  useEffect(() => {
    const t = window.setTimeout(() => setTell(false), 3200);
    return () => {
      clearTimeout(t);
      setTell(true);
    };
  }, [inDeck]);

  // The strip iOS leaves below a standalone PWA's viewport is painted from the
  // canvas, off <html>, which is outside every React tree in here. So the mode
  // has to reach up and say which ground it is over — otherwise that strip sits
  // in the deck's ink under a sheet of light paper. See html[data-ground].
  useEffect(() => {
    document.documentElement.dataset.ground = inDeck ? "deck" : "map";
  }, [inDeck]);

  // iOS standalone PWAs can report a dynamic viewport that is shorter than the
  // actual device screen, leaving a dead band at the bottom. Mark standalone at
  // runtime as a fallback for browsers that don't apply the CSS media query.
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    document.documentElement.dataset.displayMode = standalone ? "standalone" : "browser";
  }, []);

  // On the map the name shares its row with the menu button, so it sits at the
  // left margin where a masthead belongs. In the deck it is the only thing on
  // that row and the whole top of the screen is a title block, so it belongs in
  // the middle. Flex alignment cannot animate between those two, and switching
  // it would snap the name sideways on the reveal's very first frame — the one
  // element the whole sequence is built to hold still. So the distance is
  // measured and applied as a transform on a wrapper, and the name TRAVELS to
  // the centre on the same curve and the same delay as its own colour change:
  // it moves with the world going dark, not ahead of it.
  useEffect(() => {
    const measure = () => {
      const h = headerRef.current;
      const t = titleRef.current;
      if (!h || !t) return;
      // The header's px-5, and nothing else on the row once the deck is open.
      setCenterShift(Math.max(0, (h.clientWidth - 40 - t.offsetWidth) / 2));
      // Read, not assumed: the safe-area inset and the name's own line box are
      // both device-dependent, and their sum is where the deck has to begin.
      setNameBottom(Math.round(t.getBoundingClientRect().bottom));
    };
    measure();
    // Zodiak is a webfont: the name is one width in the fallback and another
    // once it lands, and a title centred on the wrong metrics is visibly off.
    document.fonts?.ready.then(measure).catch(() => {});
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [inDeck]);

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
  // Ask, on the map. `askQuery` is the parsed sentence; `askSaid` is the
  // sentence itself, kept so the map can say out loud what it is showing you
  // rather than silently hiding two thirds of your pins.
  const [askOpen, setAskOpen] = useState(false);
  const [askQuery, setAskQuery] = useState<DecideQuery | null>(null);
  const [askSaid, setAskSaid] = useState("");
  const [browseMode, setBrowseMode] = useState<BrowseMode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mascotTip, setMascotTip] = useState(false);
  const [mascotTipShown, setMascotTipShown] = useState(false);
  const placesLenRef = useRef(places.length);

  useEffect(() => {
    placesLenRef.current = places.length;
  });

  const dismissMascotTip = useCallback(() => {
    setMascotTipShown(false);
    try {
      localStorage.setItem(MASCOT_TIP_KEY, "1");
    } catch {
      // Private mode: harmless if it shows again next launch.
    }
    window.setTimeout(() => setMascotTip(false), 260);
  }, []);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(MASCOT_TIP_KEY) === "1";
    } catch {
      // Private mode.
    }
    if (seen) return;
    let auto = 0;
    let revealTip = 0;
    const t = window.setTimeout(() => {
      if (placesLenRef.current === 0) return;
      setMascotTip(true);
      revealTip = window.setTimeout(() => setMascotTipShown(true), 30);
      auto = window.setTimeout(dismissMascotTip, 9000);
    }, 3600);
    return () => {
      clearTimeout(t);
      clearTimeout(auto);
      clearTimeout(revealTip);
    };
  }, [dismissMascotTip]);

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

  // The rail narrows by state; an ask narrows by meaning. Both, in that order,
  // and through the SAME ranker the deck uses — so "cheap italian" picks the
  // same places whichever surface you said it on. Seeded constant: the order
  // rankPlaces returns is irrelevant to pins, only its membership is.
  //
  // narrowToAsk, not a filter: it degrades to near-matches rather than handing
  // back an empty map when nothing can be positively confirmed. See lib/decide.ts.
  // One pass, two answers: the pins, and whether the ask could be CONFIRMED
  // against what we know about them or whether these are merely the nearest
  // things to it. Both have to come from the SAME call over the SAME rail-
  // filtered set — deriving them separately let the line claim a confident
  // match while the map showed near-misses from a different pool.
  const asked = useMemo(() => {
    const byRail = filter === "all" ? places : places.filter((p) => displayState(p) === filter);
    if (!askQuery) return { places: byRail, confident: true };
    return narrowToAsk(byRail, askQuery, 1);
  }, [places, filter, askQuery]);
  const visible = asked.places;
  const askConfident = asked.confident;
  const selected = useMemo(
    () => visible.find((p) => p.id === selectedId) ?? null,
    [visible, selectedId]
  );

  return (
    <main
      className={`relative w-full overflow-hidden${reveal ? " reveal-on" : ""}`}
      style={{ width: "100dvw", height: "var(--app-viewport-h)", background: "var(--bg-base)" }}
    >
      <MapView places={visible} selectedId={selectedId} onSelect={setSelectedId} />

      {/* top scrim — light wash so the dark-ink masthead reads over the map */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-28"
        style={{ background: "linear-gradient(180deg, rgba(243,243,240,0.95), rgba(243,243,240,0))" }}
      />

      {/* ===================== MASTHEAD — the app's name, and its mode toggle =====================
          The wordmark is the one thing on screen in BOTH modes, at the same
          coordinates, in the same size — so it is what the mode change happens
          around, and it is what you act on to change it. Double-tap it (or
          flick across it) to open the deck; do the same to come back. On the
          map it sits in dark ink over the paper; in the deck it turns to light
          as the night washes in behind it.

          It outranks the reveal (58) and swipe mode (52) while either is up,
          and drops back to 10 on the map so the sheets can cover it.

          Because it outranks them it must not also CATCH for them: it's a
          full-width transparent box two rows tall, and every tap that landed in
          its empty space died there — including all of them aimed at swipe
          mode's lens chip, which sits on the second line by design and was
          therefore impossible to press. The header takes no pointer events; the
          two things in it that are actually pressable take their own back. */}
      <header
        ref={headerRef}
        className={`pointer-events-none fixed inset-x-0 top-0 ${inDeck ? "z-[59]" : "z-10"} px-5 pt-[max(0.9rem,env(safe-area-inset-top))]`}
      >
        <div className="flex items-center justify-between">
          {/* The name's carriage. The transform lives here and not on the h1
              because the h1 already owns transform twice over — `.press` scales
              it under a thumb, and clearTheStage() compresses it on the way into
              the deck. A travelling name and a pressed one are two different
              motions; they get two different elements. */}
          <div
            style={{
              transform: inDeck ? `translateX(${centerShift}px)` : "none",
              transition: "transform 0.46s cubic-bezier(0.22,0.61,0.36,1) 0.12s",
            }}
          >
            <h1
              ref={titleRef}
              role="button"
              tabIndex={0}
              aria-label={inDeck ? "Back to the map" : "Open the deck"}
              onDoubleClick={(e) => toggleByTitle(e.clientX, e.clientY)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  toggleByTitle(r.left + r.width / 2, r.top + r.height / 2);
                }
              }}
              onPointerDown={(e) => {
                flick.current = { x: e.clientX, t: e.timeStamp };
              }}
              onPointerUp={(e) => {
                const f = flick.current;
                flick.current = null;
                if (f && Math.abs(e.clientX - f.x) > 30 && e.timeStamp - f.t < 600) {
                  toggleByTitle(e.clientX, e.clientY);
                }
              }}
              onPointerCancel={() => {
                flick.current = null;
              }}
              className="press pointer-events-auto font-medium leading-none tracking-[-0.015em]"
              style={{
                touchAction: "pan-y",
                WebkitUserSelect: "none",
                userSelect: "none",
                cursor: "pointer",
                fontFamily: "var(--font-display)",
                // Dark ink on the paper map, light once the night is behind it.
                // The delay lets the wash get going first, so the letters change
                // with the world rather than ahead of it.
                color: inDeck ? "#f4f0ee" : "#16181d",
                transition: "color 0.42s ease 0.12s",
                // Scales so the name never clips against whatever shares its
                // row. "wheredoigo" measures 5.70em wide in Zodiak at this
                // weight — measured, not guessed, and re-measured when the name
                // shortened rather than left describing the old string: canvas
                // gives 5.846em raw, less 0.015em/char of the -0.39px tracking
                // over 10 characters. (The old 18-char name was 10.15em by the
                // same method, which is where that number came from.) The
                // reserve is everything else on the row: both side paddings, the
                // gap, and the control — the 36px menu button on the map, the
                // wider lens chip in the deck, capped at 128px and truncating
                // inside that. At this length the clamp is slack on any phone,
                // so the name simply sits at 26px; it still holds if the
                // reserve ever grows.
                fontSize: "min(26px, calc((100vw - 86px) / 5.7))",
              }}
            >
              wheredoigo
            </h1>
          </div>
          {onMap && (
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Menu"
              className="press pointer-events-auto grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style={GLASS}
            >
              <Menu size={17} style={{ color: "oklch(0.9 0 0)" }} />
            </button>
          )}
        </div>

        {/* Count + where those places actually are. The city was hard-coded to
            Bengaluru, which quietly lied the moment a pin landed anywhere else;
            it is derived now, and says nothing at all rather than guess. It
            describes the MAP, so it leaves with the map. */}
        <div className="mt-1.5 flex items-center gap-3">
          {onMap && (
            <p ref={countRef} className="text-[11px]" style={{ color: "#5b6470" }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
                {askQuery ? visible.length : places.length}
              </span>{" "}
              {(askQuery ? visible.length : places.length) === 1 ? "place" : "places"}
              {askQuery ? (
                /* An ask is hiding pins, so the line that says what you are
                   looking at has to admit it — and be the way back. No new
                   chrome: this is already the "what am I looking at" line. */
                <button
                  onClick={() => {
                    setAskQuery(null);
                    setAskSaid("");
                  }}
                  className="press pointer-events-auto ml-1 inline-flex max-w-[52vw] items-center gap-1 align-middle"
                  style={{ color: "#16181d" }}
                >
                  <span className="truncate">
                    · {askConfident ? "" : "closest to "}“{askSaid}”
                  </span>
                  <X size={10} strokeWidth={3} className="shrink-0" />
                </button>
              ) : (
                where && ` · ${where}`
              )}
            </p>
          )}
          {/* The only teaching left. The arrow that used to sit beside the name
              was a button that switched modes, which is the one thing this
              masthead is not allowed to have — so what it was explaining now
              has to explain itself: the line names the gesture, not a control.
              Fades rather than unmounts, so nothing on this line ever moves.
              The MAP's copy only. Once the name is centred there is no room
              beside it for a right-aligned line — a 26px serif and 22 mono
              characters do not fit across a phone — so the deck teaches the way
              back in its own second line, which it owns anyway. See SwipeMode. */}
          {onMap && (
            <span
              aria-hidden
              className="pointer-events-none ml-auto whitespace-nowrap text-[10.5px]"
              style={{
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
                color: "#8a93a0",
                opacity: tell ? 1 : 0,
                transform: tell ? "none" : "translateX(4px)",
                transition: "opacity 0.32s ease, transform 0.32s ease",
              }}
            >
              double-tap for the deck
            </span>
          )}
        </div>

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
              onClick={() => gate("add", () => setAddOpen(true))}
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
            {mascotTip && (
              <div
                className="pointer-events-auto absolute bottom-full left-5 mb-2 max-w-[260px] px-3 py-2 text-[12.5px] leading-snug"
                style={{
                  ...GLASS,
                  borderRadius: "var(--radius-sm)",
                  color: "oklch(0.94 0 0)",
                  opacity: mascotTipShown ? 1 : 0,
                  transform: mascotTipShown ? "translateY(0)" : "translateY(6px)",
                  transition: "opacity 0.22s ease, transform 0.22s ease",
                }}
              >
                <button
                  onClick={dismissMascotTip}
                  aria-label="Dismiss Ask hint"
                  className="press float-right ml-2 grid h-5 w-5 place-items-center rounded-full"
                  style={{ background: "rgba(255,255,255,0.1)", color: "oklch(0.84 0.01 260)" }}
                >
                  <X size={11} strokeWidth={2.5} />
                </button>
                Can&apos;t decide? Ask me, or use filters to narrow the map.
              </div>
            )}
            <button
              onClick={() => {
                dismissMascotTip();
                setAskOpen(true);
              }}
              aria-label="Ask"
              className="press grid shrink-0 place-items-center overflow-hidden"
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: askQuery ? "var(--accent)" : "oklch(0.97 0 0)",
                border: "1px solid rgba(255,255,255,0.48)",
                boxShadow: "0 8px 22px -8px rgba(0,0,0,0.5)",
              }}
            >
              <Image
                src="/decide-mascot.png"
                alt=""
                width={36}
                height={36}
                className="h-full w-full object-cover"
                draggable={false}
              />
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
              onClick={() => gate("add", () => setAddOpen(true))}
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
          gate("add", () => {
            setAddQuery(carry);
            setAddOpen(true);
          });
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

      <AskSheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        onApply={(q, said) => {
          setAskQuery(q);
          setAskSaid(said);
          setSelectedId(null);
        }}
      />

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

      {signUp && (
        <SignUpSheet
          reason={signUp}
          onClose={() => {
            pendingAction.current = null;
            setSignUp(null);
          }}
          onDone={() => {
            setSignUp(null);
            // Replay what they were trying to do, so signing up returns them to
            // their own intent instead of dropping them back on a bare map.
            const run = pendingAction.current;
            pendingAction.current = null;
            run?.();
          }}
          onToast={showToast}
        />
      )}

      {mode === "swipe" && (
        <SwipeMode
          entrance={reveal ? "fan" : "deal"}
          mastheadBottom={nameBottom}
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
