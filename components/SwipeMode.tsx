"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCcw, Sparkles, X, Heart, Check } from "lucide-react";
import { usePlaces, addPlace, removePlace, toggleNeverAgain } from "@/lib/store";
import {
  searchDineout,
  FALLBACK_COORDS,
  type SwiggyRestaurant,
  type SwiggyError,
  type UserCoords,
} from "@/lib/swiggyClient";
import { searchBias } from "@/lib/bias";
import { buildDeck, type DeckCard, type DeckSource } from "@/lib/deck";
import { bumpSkip, resetSkip, decSkip, peekSkip, setSkip } from "@/lib/skips";
import { type DecideQuery } from "@/lib/decide";
import SwipeCard, { FOOTER_SPACE } from "./SwipeCard";
import NewCardDetail from "./NewCardDetail";
import DeckHint from "./DeckHint";
import { useCardSwipe, DY_DAMP } from "./useCardSwipe";

const HINT_KEY = "wheredoigokeerthan.deckHintSeen.v1"; // first-run swipe coach, shown once

const SWIPE_THRESHOLD = 92; // px past which a release commits (horizontal)
const EXIT_MS = 240;
// A fast flick commits before the distance threshold — so a confident wrist
// flick sends the card without dragging it all the way across.
const FLICK_VELOCITY = 0.55; // px/ms
const FLICK_MIN = 44; // px — ignore taps / jitter below this travel
const CARD_INSET = 10; // px of surround, so the next card peeks and it still reads as a card

// placeId → reverse a real add on undo; skipId → the place whose skip count the
// undo has to put right; restoreSkip → the exact count to put back (a right
// swipe RESETS the count, and neither decSkip nor a second reset can undo that),
// absent when the swipe merely bumped it and a decrement is the reverse.
type UndoEntry = { key: string; placeId: string | null; skipId?: string; restoreSkip?: number };

export type SwipeLaunch = {
  source: DeckSource;
  query: DecideQuery;
  cuisine: string | null;
  keyword: string;
};

// Maps a Swiggy result to the app's Place shape — same mapping the old Swiggy
// panel used, so a swipe-saved find is consistent with places added any way.
function saveNew(r: SwiggyRestaurant): string {
  const created = addPlace({
    googlePlaceId: null,
    name: r.name,
    address: r.address,
    area: r.area,
    lat: r.lat,
    lng: r.lng,
    status: "watchlist",
    myRating: null,
    googleRating: r.rating,
    myBudgetPerPerson: null,
    googlePriceLevel: null,
    notes: "",
    tags: r.cuisines.map((c) => ({ namespace: "cuisine" as const, value: c })),
    source: "swiggy",
    enrichedAt: null,
  });
  return created.id;
}

// Swipe mode: its own full-screen surface, launched from DecideSheet with a
// frozen lens (source + query + filters). Decide stays the place you SET UP a
// session; this is the place you run it. Closing returns to Decide with the
// filters still there, so "refine and go again" is one tap.
export default function SwipeMode({
  launch,
  onClose,
  onOpenSaved,
  onToast,
}: {
  launch: SwipeLaunch;
  onClose: () => void;
  onOpenSaved: (id: string) => void; // the escape hatch — full place screen
  onToast: (msg: string) => void;
}) {
  const { source, query, cuisine, keyword } = launch;
  const places = usePlaces();
  // Latest-places snapshot read only at deck-build time — kept in a ref (updated
  // in an effect, never during render) so a mid-session add doesn't reshuffle
  // the stack under the user's thumb.
  const placesRef = useRef(places);
  useEffect(() => {
    placesRef.current = places;
  });

  const seenRef = useRef<Set<string>>(new Set()); // session dismiss/decided ledger
  const [deck, setDeck] = useState<DeckCard[]>([]);
  const [pos, setPos] = useState(0);
  const [seed, setSeed] = useState(1);
  const [undo, setUndo] = useState<UndoEntry[]>([]);

  const [swiggy, setSwiggy] = useState<SwiggyRestaurant[]>([]);
  const [loadingNew, setLoadingNew] = useState(false);
  const [newError, setNewError] = useState<SwiggyError | null>(null);
  // Every Swiggy tool takes the same coordinate pair from search through slots
  // to booking. Use whatever bias the app already has (GPS only if permission
  // was previously granted, otherwise the map centre), then fall back. Swipe
  // mode must not trigger a browser location prompt just by opening.
  const [coords] = useState<UserCoords>(() => searchBias() ?? FALLBACK_COORDS);

  const [exiting, setExiting] = useState<{ dir: "left" | "right"; key: string } | null>(null);
  const [detailNew, setDetailNew] = useState<SwiggyRestaurant | null>(null);
  // 3rd-skip escalation: the saved card to offer a permanent hide for.
  const [confirmHide, setConfirmHide] = useState<Extract<DeckCard, { kind: "saved" }> | null>(null);

  // First-run coach — shown once (persisted flag), retires on the first swipe/key
  // or a timeout. Lazy-read here: this only ever mounts client-side (swipe mode
  // is opened by a tap), so localStorage is available and there's no SSR of it.
  const [hintMounted, setHintMounted] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== "1";
    } catch {
      return false;
    }
  });
  const [hintVisible, setHintVisible] = useState(hintMounted);
  const hintDoneRef = useRef(!hintMounted);
  const dismissHint = () => {
    if (hintDoneRef.current) return;
    hintDoneRef.current = true;
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* private mode — worst case it shows again, harmless */
    }
    setHintVisible(false);
    window.setTimeout(() => setHintMounted(false), 480); // fade out, then unmount
  };
  useEffect(() => {
    if (hintDoneRef.current) return;
    const auto = window.setTimeout(dismissHint, 6500); // retire on its own if untouched
    return () => clearTimeout(auto);
  }, []);

  // Fetch Swiggy's catalog for New/Both whenever the source or cuisine changes.
  useEffect(() => {
    if (source === "saved") return; // buildDeck ignores swiggy for "saved"
    let cancelled = false;
    const run = async () => {
      setLoadingNew(true);
      const { results, error } = await searchDineout({
        cuisine: cuisine ?? undefined,
        keyword: keyword.trim() || undefined,
        lat: coords.lat,
        lng: coords.lng,
      });
      if (!cancelled) {
        setSwiggy(results);
        setNewError(error ?? null);
        setLoadingNew(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [source, cuisine, keyword, coords]);

  // Rebuild the ordered deck when the lens changes (results / seed). The lens
  // itself is frozen at launch, so in practice this is the Swiggy fetch landing
  // and the "start over" reshuffle.
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    setDeck(
      buildDeck({
        source,
        places: placesRef.current,
        query,
        swiggy,
        seed,
        seen: seenRef.current,
      })
    );
    setPos(0);
    setUndo([]);
    setExiting(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, queryKey, swiggy, seed]);

  const current = deck[pos] ?? null;

  // ---- actions -----------------------------------------------------------
  const commit = (dir: "left" | "right") => {
    if (!current || exiting) return;
    const card = current;
    let entry: UndoEntry = { key: card.key, placeId: null };
    let prompt = false; // 3rd skip on a saved card → offer a permanent hide
    if (dir === "right") {
      if (card.kind === "new") {
        entry = { key: card.key, placeId: saveNew(card.r) };
        onToast("Added to watchlist");
      } else {
        // Changed your mind — drop the skip ramp, but remember where it was so
        // Undo genuinely reverses the swipe instead of quietly keeping the reset.
        const prior = peekSkip(card.place.id);
        resetSkip(card.place.id);
        entry = { key: card.key, placeId: null, skipId: card.place.id, restoreSkip: prior };
        onToast("Already on your map");
      }
    } else if (card.kind === "saved") {
      // Soft dismiss, but count it: the 3rd skip of the same place prompts.
      const n = bumpSkip(card.place.id);
      entry = { key: card.key, placeId: null, skipId: card.place.id };
      if (n >= 3) prompt = true;
    }
    setUndo((u) => [...u, entry]);
    setExiting({ dir, key: card.key });
    // No drag reset needed here: useCardSwipe clears its own state before it
    // calls onCommit, and the keyboard/button paths never had a drag.
    window.setTimeout(() => {
      seenRef.current.add(card.key);
      setPos((p) => p + 1);
      setExiting(null);
      if (prompt && card.kind === "saved") setConfirmHide(card);
    }, EXIT_MS);
  };

  const swipe = useCardSwipe({
    enabled: !exiting && !!current,
    threshold: SWIPE_THRESHOLD,
    flickVelocity: FLICK_VELOCITY,
    flickMin: FLICK_MIN,
    onCommit: (dir) => {
      dismissHint();
      commit(dir);
    },
  });
  const drag = swipe.drag;

  // "Hide for good" — the escalation's yes. The card is already dismissed; this
  // just also flags neverAgain so it never surfaces anywhere again, and drops
  // the now-meaningless undo (you can't un-skip your way back to a hidden place).
  const hideForGood = () => {
    if (!confirmHide) return;
    toggleNeverAgain(confirmHide.place.id);
    resetSkip(confirmHide.place.id);
    setUndo((u) => u.slice(0, -1));
    onToast("Hidden — won’t show again");
    setConfirmHide(null);
  };

  // "Not now" — reset the count so it takes three fresh skips to ask again.
  const keepAround = () => {
    if (!confirmHide) return;
    resetSkip(confirmHide.place.id);
    setConfirmHide(null);
  };

  // Add from the booking sheet — same effect as a right swipe, minus the
  // fly-out (the sheet already covers the card), then close.
  const addFromDetail = () => {
    if (current?.kind !== "new") {
      setDetailNew(null);
      return;
    }
    const card = current;
    const placeId = saveNew(card.r); // side effect kept out of the state updater
    setUndo((u) => [...u, { key: card.key, placeId }]);
    onToast("Added to watchlist");
    seenRef.current.add(card.key);
    setPos((p) => p + 1);
    setDetailNew(null);
  };

  const doUndo = () => {
    if (exiting || !undo.length) return;
    const last = undo[undo.length - 1];
    // Side effects run here in the handler — never inside a setState updater
    // (React runs those during render, and store writes fan out to other
    // components mid-render).
    if (last.placeId) removePlace(last.placeId); // reverse the add
    if (last.skipId) {
      // A right swipe reset the count (restore it exactly); a left swipe bumped
      // it by one (step it back).
      if (last.restoreSkip != null) setSkip(last.skipId, last.restoreSkip);
      else decSkip(last.skipId);
    }
    seenRef.current.delete(last.key);
    setUndo((u) => u.slice(0, -1));
    setPos((p) => Math.max(0, p - 1));
  };

  const reshuffle = () => {
    seenRef.current.clear();
    setSeed((s) => s + 1);
  };

  // ---- keyboard (desktop / PWA — no touch) -------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (detailNew || confirmHide) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (detailNew) setDetailNew(null);
          else keepAround();
        }
        return;
      }
      if (["ArrowLeft", "ArrowRight", "Backspace"].includes(e.key) || e.key.toLowerCase() === "u") {
        dismissHint();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        commit("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        commit("right");
      } else if (e.key === "Backspace" || e.key.toLowerCase() === "u") {
        e.preventDefault();
        doUndo();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, pos, exiting, detailNew, confirmHide, undo.length]);

  // ---- render ------------------------------------------------------------
  // A right swipe does two different things, so it can't wear one label. On a
  // NEW card it genuinely adds to the watchlist. On a SAVED card it adds
  // nothing — the place is already on your map (it may be visited, or a
  // favourite); the swipe just picks it and clears its skip ramp. Promising
  // "Add to watchlist" there is a lie the stamp, the button and the coach were
  // all telling.
  const isNewCard = current?.kind === "new";
  const rightStamp = isNewCard ? "Watchlist" : "Yes";
  const rightAction = isNewCard ? "Add to watchlist" : "Yes, I’d go";

  const stamp = (() => {
    if (!drag) return null;
    const { dx } = drag;
    if (dx > 0) return { label: rightStamp, color: "var(--s-watchlist)", opacity: dx / SWIPE_THRESHOLD };
    if (dx < 0) return { label: "Nope", color: "var(--s-favorite)", opacity: -dx / SWIPE_THRESHOLD };
    return null;
  })();

  const topTransform = (): CSSProperties => {
    if (exiting) {
      return {
        transform: `translateX(${exiting.dir === "right" ? "140%" : "-140%"}) rotate(${exiting.dir === "right" ? 18 : -18}deg)`,
        opacity: 0,
        transition: `transform ${EXIT_MS}ms ease, opacity ${EXIT_MS}ms ease`,
      };
    }
    if (drag) {
      // The axis lock guarantees this only ever runs on a horizontal gesture,
      // so dy here is thumb-arc, not scroll intent — damped hard to keep the
      // card level. Rotation is coupled to horizontal travel and clamped.
      const rot = Math.max(-15, Math.min(15, drag.dx * 0.055));
      return {
        transform: `translate(${drag.dx}px, ${drag.dy * DY_DAMP}px) rotate(${rot}deg)`,
        transition: "none",
      };
    }
    // Snappy, slightly springy return — reads as "tight", not floaty.
    return { transform: "none", transition: "transform 0.34s var(--ease-spring)" };
  };

  const stack = deck.slice(pos, pos + 3);
  const exhausted = deck.length > 0 && pos >= deck.length;
  const empty = deck.length === 0;
  // Busy the whole time a Swiggy fetch is in flight — not just on first load — so
  // a cuisine/keyword change hides the previous pool's cards immediately instead
  // of leaving them swipeable against a lens they no longer match.
  const busy = source !== "saved" && loadingNew;
  // A Swiggy failure has to read differently from "no matches" — the deck is
  // empty either way, but only one of them is fixable by changing the filter.
  const newFailed = source !== "saved" && newError !== null;
  const showCards = !busy && !newFailed && !empty && !exhausted;

  const lens = source === "saved" ? "Your map" : source === "new" ? "New · Swiggy" : "Everything";

  return (
    <div className="fixed inset-0 z-[52]" style={{ background: "var(--bg-base)" }}>
      {/* ---- card stage: the whole screen ---- */}
      <div className="absolute" style={{ inset: CARD_INSET }}>
        {busy ? (
          <Centered>
            <Sparkles size={20} className="animate-pulse" style={{ color: "var(--accent)" }} />
            <p className="mt-2 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Finding places…
            </p>
          </Centered>
        ) : newFailed ? (
          <Centered>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              {newError === "swiggy_reauth" ? "Swiggy needs reconnecting" : "Swiggy didn’t answer"}
            </p>
            <p className="mt-1 text-[12.5px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              {newError === "swiggy_reauth"
                ? "Access tokens last 5 days. Run npm run swiggy:auth to sign in again."
                : "Dineout is unreachable right now — your saved places still work."}
            </p>
          </Centered>
        ) : empty ? (
          <Centered>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              Nothing matches this filter
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
              Close and pick another lens.
            </p>
          </Centered>
        ) : exhausted ? (
          <Centered>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              That&rsquo;s everyone
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
              You&rsquo;ve seen every place in this lens.
            </p>
            <button
              onClick={reshuffle}
              className="press mt-4 flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-semibold"
              style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
            >
              <RotateCcw size={14} /> Start over
            </button>
          </Centered>
        ) : (
          <>
            {stack
              .map((card, i) => {
                const top = i === 0;
                const peek: CSSProperties = top
                  ? topTransform()
                  : {
                      transform: `scale(${1 - i * 0.03}) translateY(${i * 10}px)`,
                      opacity: 1 - i * 0.14,
                      transition: "transform 0.24s ease, opacity 0.24s ease",
                    };
                return (
                  <div
                    key={card.key}
                    className="absolute inset-0"
                    style={{ zIndex: stack.length - i, ...peek }}
                    // The cards underneath are decoration until they're on top:
                    // inert keeps their Directions/Full-details controls out of
                    // the tab order and out of a screen reader, which otherwise
                    // reads three stacked copies of every card.
                    inert={!top}
                    {...(top ? swipe.handlers : {})}
                  >
                    <SwipeCard
                      card={card}
                      stamp={top ? stamp : null}
                      interactive={top}
                      wasDrag={swipe.wasDrag}
                      onOpenDetails={() => {
                        if (card.kind === "saved") onOpenSaved(card.place.id);
                      }}
                      onBook={() => {
                        if (card.kind === "new") setDetailNew(card.r);
                      }}
                    />
                  </div>
                );
              })
              // paint the top card LAST so it wins stacking + receives the pointer
              .reverse()}
            {hintMounted && current && <DeckHint visible={hintVisible} rightLabel={rightStamp} />}
          </>
        )}
      </div>

      {/* Scrim under the floating header. Without it the hero's title slides
          under the close button mid-scroll and gets sliced in half. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          zIndex: 9,
          height: 120,
          background: "linear-gradient(180deg, rgba(6,7,10,0.75) 0%, rgba(6,7,10,0) 100%)",
        }}
      />

      {/* ---- header: close + the lens you launched with ---- */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{ zIndex: 10 }}
      >
        <button
          onClick={onClose}
          aria-label="Close swipe mode"
          className="press pointer-events-auto grid h-10 w-10 place-items-center rounded-full"
          style={{
            background: "var(--glass)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
            color: "var(--text-primary)",
          }}
        >
          <X size={17} strokeWidth={2.25} />
        </button>
        <span
          className="pointer-events-auto rounded-full px-3 py-1.5 text-[12px] font-semibold"
          style={{
            background: "var(--glass)",
            backdropFilter: "blur(22px)",
            WebkitBackdropFilter: "blur(22px)",
            color: "var(--text-secondary)",
          }}
        >
          {lens}
        </span>
      </div>

      {/* ---- action bar: pinned, so it never scrolls away with the card ---- */}
      {/* Undo has to outlive the cards. Gating the whole bar on showCards meant
          mis-swiping the LAST card unmounted the only touch affordance for
          taking it back — "That's everyone" would render over a deck you never
          meant to finish, with recovery available on desktop keys alone. The
          bar now also renders whenever there is something to undo; skip/like
          simply go inert with no card under them. */}
      {(showCards || undo.length > 0) && (
        <div
          className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          style={{ zIndex: 10, height: FOOTER_SPACE }}
        >
          <ActionCircle
            onClick={() => {
              dismissHint();
              commit("left");
            }}
            label="Skip"
            color="var(--s-favorite)"
            size={60}
            disabled={!current || !!exiting}
          >
            <X size={26} strokeWidth={2.75} />
          </ActionCircle>

          <ActionCircle
            onClick={doUndo}
            label="Undo last swipe"
            color="var(--text-tertiary)"
            size={46}
            disabled={!undo.length || !!exiting}
          >
            <RotateCcw size={18} strokeWidth={2.5} />
          </ActionCircle>

          <ActionCircle
            onClick={() => {
              dismissHint();
              commit("right");
            }}
            label={rightAction}
            color="var(--s-watchlist)"
            size={60}
            disabled={!current || !!exiting}
          >
            {isNewCard ? (
              <Heart size={24} strokeWidth={2.5} fill="currentColor" />
            ) : (
              // A heart over a place you already saved reads as "save it" too —
              // same false promise as the label, so the glyph branches with it.
              <Check size={26} strokeWidth={3} />
            )}
          </ActionCircle>
        </div>
      )}

      {detailNew && (
        <NewCardDetail
          r={detailNew}
          coords={coords}
          onAdd={addFromDetail}
          onClose={() => setDetailNew(null)}
        />
      )}

      {confirmHide && (
        <div className="fixed inset-0 z-[56] grid place-items-center px-8" style={{ background: "rgba(6,7,10,0.72)" }}>
          <div
            className="w-full max-w-[320px] p-5 text-center"
            style={{ background: "var(--bg-raised)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-sheet)" }}
          >
            <p className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Hide {confirmHide.place.name} for good?
            </p>
            <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
              You&rsquo;ve skipped it three times. Hiding marks it Skip — it won&rsquo;t show up in recommendations again.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={hideForGood}
                className="press w-full py-3 text-[14px] font-bold"
                style={{ background: "var(--s-favorite)", color: "#fff", borderRadius: "var(--radius-chip)" }}
              >
                Yes, hide it
              </button>
              <button
                onClick={keepAround}
                className="press w-full py-3 text-[14px] font-semibold"
                style={{ border: "1px solid var(--border-strong)", color: "var(--text-primary)", borderRadius: "var(--radius-chip)" }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Dark-glass circle over the card — the state colour rides the glyph, never a
// fill, so the deck's existing stamp vocabulary (amber = watchlist, red = nope)
// carries through to the buttons without turning them into coloured actions.
function ActionCircle({
  onClick,
  label,
  color,
  size,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  color: string;
  size: number;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className="press grid place-items-center rounded-full disabled:opacity-35"
      style={{
        height: size,
        width: size,
        color,
        background: "var(--glass)",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-pop)",
      }}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 grid place-items-center px-8 text-center"
      style={{ borderRadius: "var(--radius-lg)", border: "1px dashed var(--border-strong)" }}
    >
      <div className="flex flex-col items-center">{children}</div>
    </div>
  );
}
