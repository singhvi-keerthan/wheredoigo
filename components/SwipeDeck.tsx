"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw, Sparkles } from "lucide-react";
import { usePlaces, addPlace, removePlace, toggleNeverAgain } from "@/lib/store";
import { searchDineout, type SwiggyRestaurant } from "@/lib/swiggyClient";
import { buildDeck, type DeckCard, type DeckSource } from "@/lib/deck";
import { bumpSkip, resetSkip, decSkip } from "@/lib/skips";
import { type DecideQuery } from "@/lib/decide";
import SwipeCard from "./SwipeCard";
import NewCardDetail from "./NewCardDetail";
import DeckHint from "./DeckHint";

const HINT_KEY = "imhungry.deckHintSeen.v1"; // first-run swipe coach, shown once

const SWIPE_THRESHOLD = 92; // px past which a release commits (horizontal)
const UP_THRESHOLD = 88; // px up-drag that opens details
const EXIT_MS = 240;

// placeId → reverse a real add on undo; skipId → decrement the skip count on undo
type UndoEntry = { key: string; placeId: string | null; skipId?: string };

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

export default function SwipeDeck({
  source,
  query,
  cuisine,
  keyword,
  onOpenSaved,
  onToast,
  onUndoChange,
}: {
  source: DeckSource;
  query: DecideQuery; // drives the "saved" lens; ignored for "new"
  cuisine: string | null; // cuisine filter for the "new"/"both" lens
  keyword: string; // free-text Swiggy search for "new"/"both"
  onOpenSaved: (id: string) => void; // saved-card details → PlaceDetail (closes the deck sheet)
  onToast: (msg: string) => void;
  // Undo lives in the sheet header (the deck itself is swipe-only), so the deck
  // hands its undo action up whenever one is available, null when not.
  onUndoChange: (undo: (() => void) | null) => void;
}) {
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

  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [exiting, setExiting] = useState<{ dir: "left" | "right"; key: string } | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [detailNew, setDetailNew] = useState<SwiggyRestaurant | null>(null);
  // 2nd-skip escalation: the saved card to offer a permanent hide for.
  const [confirmHide, setConfirmHide] = useState<Extract<DeckCard, { kind: "saved" }> | null>(null);

  // First-run coach — shown once (persisted flag), retires on the first swipe/key
  // or a timeout. Lazy-read here: SwipeDeck only ever mounts client-side (Decide
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
      const { results } = await searchDineout({
        cuisine: cuisine ?? undefined,
        keyword: keyword.trim() || undefined,
      });
      if (!cancelled) {
        setSwiggy(results);
        setLoadingNew(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [source, cuisine, keyword]);

  // Rebuild the ordered deck when the lens changes (source / query / results /
  // seed). Reads places + seen from refs so a mid-session add or a dismiss
  // doesn't reshuffle the stack under the user's thumb.
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
    setDrag(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, queryKey, swiggy, seed]);

  const current = deck[pos] ?? null;

  // ---- actions -----------------------------------------------------------
  const details = () => {
    if (!current) return;
    setDrag(null);
    if (current.kind === "saved") onOpenSaved(current.place.id);
    else setDetailNew(current.r);
  };

  const commit = (dir: "left" | "right") => {
    if (!current || exiting) return;
    const card = current;
    let entry: UndoEntry = { key: card.key, placeId: null };
    let prompt = false; // 2nd skip on a saved card → offer a permanent hide
    if (dir === "right") {
      if (card.kind === "new") {
        entry = { key: card.key, placeId: saveNew(card.r) };
        onToast("Added to watchlist");
      } else {
        resetSkip(card.place.id); // changed your mind — drop the skip ramp
        onToast("Already on your map");
      }
    } else if (card.kind === "saved") {
      // Soft dismiss, but count it: the 2nd skip of the same place prompts.
      const n = bumpSkip(card.place.id);
      entry = { key: card.key, placeId: null, skipId: card.place.id };
      if (n >= 2) prompt = true;
    }
    setUndo((u) => [...u, entry]);
    setExiting({ dir, key: card.key });
    setDrag(null);
    window.setTimeout(() => {
      seenRef.current.add(card.key);
      setPos((p) => p + 1);
      setExiting(null);
      if (prompt && card.kind === "saved") setConfirmHide(card);
    }, EXIT_MS);
  };

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

  // "Not now" — reset the count so it takes two fresh skips to ask again.
  const keepAround = () => {
    if (!confirmHide) return;
    resetSkip(confirmHide.place.id);
    setConfirmHide(null);
  };

  // Add from the New detail sheet — same effect as a right swipe, minus the
  // fly-out (the detail overlay already covers the card), then close.
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
    if (last.skipId) decSkip(last.skipId); // reverse the skip-count bump
    seenRef.current.delete(last.key);
    setUndo((u) => u.slice(0, -1));
    setPos((p) => Math.max(0, p - 1));
  };

  const reshuffle = () => {
    seenRef.current.clear();
    setSeed((s) => s + 1);
  };

  // ---- pointer gestures (top card only) ----------------------------------
  const onPointerDown = (e: ReactPointerEvent) => {
    if (exiting || !current) return;
    dismissHint();
    startRef.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ dx: 0, dy: 0 });
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!startRef.current) return;
    setDrag({ dx: e.clientX - startRef.current.x, dy: e.clientY - startRef.current.y });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!startRef.current) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;
    startRef.current = null;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (adx < 6 && ady < 6) {
      details(); // a tap
      return;
    }
    if (dy < -UP_THRESHOLD && ady > adx) {
      details();
      setDrag(null);
      return;
    }
    if (dx > SWIPE_THRESHOLD) return commit("right");
    if (dx < -SWIPE_THRESHOLD) return commit("left");
    setDrag(null); // spring back
  };

  // ---- keyboard (desktop / PWA — no touch) -------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (detailNew || confirmHide) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "Backspace"].includes(e.key) || e.key.toLowerCase() === "u") {
        dismissHint();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        commit("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        commit("right");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        details();
      } else if (e.key === "Backspace" || e.key.toLowerCase() === "u") {
        e.preventDefault();
        doUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, pos, exiting, detailNew, confirmHide, undo.length]);

  // Publish the current undo action (or null) to the sheet header.
  useEffect(() => {
    onUndoChange(undo.length && !exiting ? doUndo : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo.length, exiting]);

  // ---- render ------------------------------------------------------------
  const stamp = (() => {
    if (!drag) return null;
    const { dx, dy } = drag;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if (dy < 0 && ady > adx) return { label: "Details", color: "var(--accent)", opacity: ady / UP_THRESHOLD };
    if (dx > 0) return { label: "Watchlist", color: "var(--s-watchlist)", opacity: dx / SWIPE_THRESHOLD };
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
      return {
        transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx * 0.05}deg)`,
        transition: "none",
      };
    }
    return { transform: "none", transition: "transform 0.24s cubic-bezier(0.22,1,0.36,1)" };
  };

  const stack = deck.slice(pos, pos + 3);
  const exhausted = deck.length > 0 && pos >= deck.length;
  const empty = deck.length === 0;
  // Busy the whole time a Swiggy fetch is in flight — not just on first load — so
  // a cuisine/keyword change hides the previous pool's cards immediately instead
  // of leaving them swipeable against a lens they no longer match.
  const busy = source !== "saved" && loadingNew;

  return (
    <div className="flex h-full flex-col">
      {/* stage — takes all the space the controls and rail leave */}
      <div className="relative min-h-0 flex-1">
        {busy ? (
          <Centered>
            <Sparkles size={20} className="animate-pulse" style={{ color: "var(--accent)" }} />
            <p className="mt-2 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              Finding places…
            </p>
          </Centered>
        ) : empty ? (
          <Centered>
            <p className="text-[15px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              Nothing matches this filter
            </p>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
              Pick another cuisine, or switch source above.
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
                    transform: `scale(${1 - i * 0.04}) translateY(${i * 12}px)`,
                    opacity: 1 - i * 0.12,
                    transition: "transform 0.24s ease, opacity 0.24s ease",
                  };
              return (
                <div
                  key={card.key}
                  className="absolute inset-0"
                  style={{ zIndex: stack.length - i, ...peek }}
                  onPointerDown={top ? onPointerDown : undefined}
                  onPointerMove={top ? onPointerMove : undefined}
                  onPointerUp={top ? onPointerUp : undefined}
                  onPointerCancel={top ? () => {
                    startRef.current = null;
                    setDrag(null);
                  } : undefined}
                >
                  <SwipeCard card={card} stamp={top ? stamp : null} interactive={top} />
                </div>
              );
            })
            // paint the top card LAST so it wins stacking + receives the pointer
            .reverse()}
            {hintMounted && current && <DeckHint visible={hintVisible} />}
          </>
        )}
      </div>

      {detailNew && (
        <NewCardDetail r={detailNew} onAdd={addFromDetail} onClose={() => setDetailNew(null)} />
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
              You&rsquo;ve skipped it twice. Hiding marks it Skip — it won&rsquo;t show up in recommendations again.
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

