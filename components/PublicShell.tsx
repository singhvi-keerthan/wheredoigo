"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import { Search, MapPin, X } from "lucide-react";
import { displayState, type DisplayState, type Place } from "@/lib/types";
import { cityLabel } from "@/lib/city";
import { narrowToAsk, type DecideQuery } from "@/lib/decide";
import { useSyncStatus } from "@/lib/sync/client";
import MapView from "./MapView";
import PublicPlaceCard from "./PublicPlaceCard";
import PublicSearch from "./PublicSearch";
import AskSheet from "./AskSheet";
import SignUpSheet from "./SignUpSheet";

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
//
// Ask is here too, and it is the whole point of the page rather than a feature
// on it: it stands in for the phone call. Someone who would have texted "where
// should I go for a birthday dinner under 1500" types that instead, and gets
// back the places Keerthan has actually been, with what he paid and what he
// rated them. It is scoped to THIS map and nothing else — no Swiggy, no
// discovery, no library of their own — because swipe and the New/Both decks
// live in the app, and answering as him is the only job this one has.
//
// It runs the same AskSheet the app runs, so the two can never drift into
// meaning different things by the same name, and narrowToAsk does the
// narrowing exactly as it does on the owner's map.

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
  background: "var(--glass)", // the token, not a copy of it — see --glass
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
  const [askOpen, setAskOpen] = useState(false);
  const [askQuery, setAskQuery] = useState<DecideQuery | null>(null);
  const [askSaid, setAskSaid] = useState("");
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Reading the map is free; asking it costs a model call on Keerthan's key, so
  // Ask is the one thing on this screen that wants a name against it. Sign-up
  // opens instead, and the ask opens the moment they're through it.
  const sync = useSyncStatus();
  // SignUpSheet reports every refusal through onToast — a short password, an
  // unreachable server. Without somewhere to put them the form would just fail
  // silently, so this screen needs the one piece of chrome the app already has.
  const showToast = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2800);
  };
  const openAsk = () => {
    if (sync.connected) setAskOpen(true);
    else setSignUpOpen(true);
  };

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

  // One pass, two answers — the pins, and whether the ask could actually be
  // CONFIRMED against these places or whether they are merely the nearest
  // things to it. Both have to come from the SAME call over the SAME
  // rail-filtered set, exactly as AppShell does it.
  const asked = useMemo(() => {
    const byRail = filter === "all" ? places : places.filter((p) => displayState(p) === filter);
    if (!askQuery) return { places: byRail, confident: true };
    return narrowToAsk(byRail, askQuery, 1);
  }, [places, filter, askQuery]);
  const visible = asked.places;
  const selected = useMemo(() => visible.find((p) => p.id === selectedId) ?? null, [visible, selectedId]);

  return (
    <main className="relative w-full overflow-hidden" style={{ height: "100dvh", background: "var(--bg-base)" }}>
      <MapView places={visible} selectedId={selectedId} onSelect={setSelectedId} shared />

      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-28"
        style={{ background: "linear-gradient(180deg, rgba(243,243,240,0.95), rgba(243,243,240,0))" }}
      />

      <header className="fixed inset-x-0 top-0 z-10 flex items-start gap-3 px-5 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <h1
            className="font-medium leading-none tracking-[-0.015em]"
            style={{
              fontFamily: "var(--font-display)",
              color: "#16181d",
              // Same measured fit as the app's masthead, minus the controls this
              // screen doesn't have — the page padding and the "Your own" pill.
              fontSize: "min(26px, calc((100vw - 132px) / 10.2))",
            }}
          >
            wheredoigokeerthan
          </h1>
          <p className="mt-1.5 text-[11px]" style={{ color: "#5b6470" }}>
            <span style={{ fontFamily: "var(--font-mono)", color: "#16181d", fontWeight: 500 }}>
              {askQuery ? visible.length : places.length}
            </span>{" "}
            {(askQuery ? visible.length : places.length) === 1 ? "place" : "places"}
            {askQuery ? (
              /* An ask is hiding pins, so the line that says what you are
                 looking at has to admit it — and be the way back. Same shape
                 the app uses; no new chrome for the same job. */
              <button
                onClick={() => {
                  setAskQuery(null);
                  setAskSaid("");
                }}
                className="press ml-1 inline-flex max-w-[52vw] items-center gap-1 align-middle"
                style={{ color: "#16181d" }}
              >
                <span className="truncate">
                  · {asked.confident ? "" : "closest to "}“{askSaid}”
                </span>
                <X size={10} strokeWidth={3} className="shrink-0" />
              </button>
            ) : (
              <>
                {where && ` · ${where}`}
                {updatedAgo && ` · updated ${updatedAgo}`}
              </>
            )}
          </p>
        </div>

        {/* The only way off this screen. The app moved to /app and nothing else
            points at it, so without this the share view is a dead end for
            everyone who isn't Keerthan — his own PWA opens /app directly.
            Deliberately quiet: this is a map someone asked him for, not a
            signup page, so it reads as a door rather than a call to action. */}
        <a
          href="/app"
          className="press mt-[3px] shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-semibold no-underline"
          style={{
            color: "#16181d",
            background: "rgba(255,255,255,0.72)",
            border: "1px solid rgba(22,24,29,0.12)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          Your own
        </a>
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
            {/* Ask sits where it sits in the app — left of the filter tray — so
                the two screens don't teach different muscle memory. */}
            <button
              onClick={openAsk}
              aria-label="Ask Keerthan"
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

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[max(6.5rem,env(safe-area-inset-bottom))] z-[60] flex justify-center px-6">
          <p
            className="max-w-[320px] rounded-full px-4 py-2 text-center text-[13px] font-medium"
            style={{ ...GLASS, color: "oklch(0.96 0 0)" }}
          >
            {toast}
          </p>
        </div>
      )}

      <PublicSearch open={searchOpen} places={places} onClose={() => setSearchOpen(false)} onPick={(id) => setSelectedId(id)} />

      <AskSheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        onApply={(q, said) => {
          setAskQuery(q);
          setAskSaid(said);
          setSelectedId(null);
        }}
      />

      {signUpOpen && (
        <SignUpSheet
          reason="ask"
          onClose={() => setSignUpOpen(false)}
          onDone={() => {
            setSignUpOpen(false);
            setAskOpen(true); // straight into what they came for
          }}
          onToast={showToast}
        />
      )}
    </main>
  );
}
