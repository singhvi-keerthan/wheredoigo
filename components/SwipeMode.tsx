"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RotateCcw, Sparkles, X, Heart, Check, SlidersHorizontal } from "lucide-react";
import { usePlaces, addPlace, removePlace, updatePlace, getPlace, toggleNeverAgain } from "@/lib/store";
import {
  searchDineout,
  FALLBACK_COORDS,
  type SwiggyRestaurant,
  type SwiggyError,
  type UserCoords,
} from "@/lib/swiggyClient";
import { searchBias } from "@/lib/bias";
import { searchPlaces, geocodeArea } from "@/lib/places";
import { buildDeck, type DeckCard } from "@/lib/deck";
import { bumpSkip, resetSkip, decSkip, peekSkip, setSkip } from "@/lib/skips";
import SwipeCard from "./SwipeCard";
import NewCardDetail from "./NewCardDetail";
import { useCardSwipe, DY_DAMP } from "./useCardSwipe";
import LensPanel, { useLens } from "./LensPanel";

const SWIPE_THRESHOLD = 92; // px past which a release commits (horizontal)
const EXIT_MS = 240;
// A fast flick commits before the distance threshold — so a confident wrist
// flick sends the card without dragging it all the way across.
const FLICK_VELOCITY = 0.55; // px/ms
const FLICK_MIN = 44; // px — ignore taps / jitter below this travel
// The deck is the screen, not a card on it.
//
// It was inset 10px on every side — a rounded, bordered, shadowed rectangle
// sitting on a near-black field — and read as a card floating on the phone
// rather than as the app. Framing it under the masthead (which fixed a photo
// that used to start above the status bar) only made that worse: more gutter,
// more float. So the gutters are gone. The photo runs to both edges and to the
// bottom of the glass, and the only inset left is the top — where the app's own
// name sits, on the app's own surface, which reads as chrome instead of as a
// gap.
//
// What that costs: the next card no longer peeks out from behind the top one.
// The deck says "deck" through motion instead — the deal on arrival, and the
// card that scales up behind the one you just sent away.
//
// The top inset is the masthead: the status bar, the wordmark at its full 26px,
// and the line under it that says what you're being dealt. That second line is
// 11px of quiet type, not a control — see the lens below.
const STAGE_TOP = "calc(max(0.9rem, env(safe-area-inset-top)) + 3.1rem)";
const OUT_MS = 190; // the mode's own fade-out, before AppShell unmounts it

// ---- the opening beat -----------------------------------------------------
// Every run of the deck opens the same way: the cards are dealt, then the two
// decisions introduce themselves by DOING them — the top card leans left under
// a Nope stamp, comes back, leans right under the other one. Then the controls
// retire and the deck is yours. They are a coach, not furniture: a permanent
// pair of buttons under a gesture-first surface just tells you, every second of
// every session, that the gesture wasn't obvious. Any touch or key skips the
// whole thing instantly — the first person who already knows never sits
// through it twice.
const DEAL_MS = 700; // cards land (0.52s animation + 120ms of stagger)
const FAN_MS = 790; // the reveal's beat 6 (0.66s animation + 110ms of stagger)
const COACH_AT = 640;
const DEMO_LEFT_IN = 900;
const DEMO_LEFT_OUT = 1400;
const DEMO_RIGHT_IN = 1650;
const DEMO_RIGHT_OUT = 2150;
const COACH_FADE = 2500;
const COACH_GONE = 2860;
// How far the demo leans the card. Kept small on purpose: the card is only
// 10px narrower than the screen on each side, so a lean big enough to feel like
// a swipe slices the place's own name off the edge — it reads as breakage when
// the card is holding still rather than travelling. 24px plus a degree and a
// half is a lean; the stamp and the lit button carry the rest of the meaning.
// The coach bar's own height. It used to live on the card as reserved padding,
// because the buttons were permanent and the card had to stay clear of them.
// Nothing is reserved now — the bar floats over the card for its couple of
// seconds and the card's content runs the full height either side of that.
const COACH_BAR_H = 124;
const DEMO_DX = 24;
const DEMO_ROT = 0.07; // deg per px of lean
type Phase = "deal" | "coach" | "done";

// placeId → reverse a real add on undo; skipId → the place whose skip count the
// undo has to put right; restoreSkip → the exact count to put back (a right
// swipe RESETS the count, and neither decSkip nor a second reset can undo that),
// absent when the swipe merely bumped it and a decrement is the reverse.
type UndoEntry = { key: string; placeId: string | null; skipId?: string; restoreSkip?: number };

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduced;
}

const normName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

// Either name containing the other whole. Prefix rules break on the honorifics
// and branch suffixes these two catalogues disagree about.
const nameCarries = (a: string, b: string) => {
  const x = normName(a);
  const y = normName(b);
  return x !== "" && y !== "" && (x.includes(y) || y.includes(x));
};

// Swiggy publishes no restaurant coordinates (see the note on SwiggyRestaurant),
// so a saved Swiggy find has no position of its own. Google does know it: one
// Text Search on "<name>, <area>" returns coordinates AND a placeId — which
// also upgrades the record off the null googlePlaceId the Swiggy path used to
// store, so it enriches and re-photos like any place added any other way.
//
// Deliberately fire-and-forget and AFTER the place exists: a swipe must never
// wait on a network call. The place is stored at your own position and the pin
// moves to the real one a moment later.
async function fixSwiggyPosition(placeId: string, r: SwiggyRestaurant) {
  const query = [r.name, r.area].filter(Boolean).join(", ");
  const { results, error } = await searchPlaces(query, searchBias());
  if (error) {
    // A failed request is not "no such restaurant" — don't let it fall through
    // to the centroid as though Google had answered.
    console.warn("[swiggy] position lookup failed", error);
    return;
  }
  const hit = results[0];
  // Text Search returns a plausible neighbour when it can't find the exact
  // place, and a confidently wrong pin is worse than a vague one — so the names
  // must contain one another whole, in either direction. A leading-prefix rule
  // failed real cases: Google answers "Bengaluru Brewery" for "The Bengaluru
  // Brewery", and "Toit" for "Toit - Indiranagar".
  if (hit && nameCarries(hit.name, r.name)) {
    if (!getPlace(placeId)) return; // undone while we were away
    updatePlace(placeId, { lat: hit.lat, lng: hit.lng, googlePlaceId: hit.placeId });
    return;
  }

  // Google has never heard of it, or what it found isn't it. Leaving the seed
  // in place would pin the restaurant at YOUR position — and with no
  // googlePlaceId the enrichment path never runs, so it would sit at your house
  // forever, indistinguishable from a real pin. The locality centroid is still
  // approximate, but it's approximate in the neighbourhood the card already
  // names, which is the honest version of "we don't know exactly where".
  if (!r.area) return;
  const centroid = await geocodeArea(r.area);
  // removePlace is a soft delete, and updatePlace patches by id regardless — so
  // a right-swipe you immediately undid would otherwise get these coordinates
  // written into its tombstone, bumping updatedAt and making the deleted row
  // the newer record on the next sync push.
  if (centroid && getPlace(placeId)) updatePlace(placeId, { lat: centroid.lat, lng: centroid.lng });
}

// Maps a Swiggy result to the app's Place shape — same mapping the old Swiggy
// panel used, so a swipe-saved find is consistent with places added any way.
function saveNew(r: SwiggyRestaurant, seed: UserCoords): string {
  const created = addPlace({
    googlePlaceId: null,
    name: r.name,
    address: r.address,
    area: r.area,
    // A Place must have a position, and holding the save until Google answers
    // would put a round-trip inside the swipe — so seed with where you are and
    // let fixSwiggyPosition correct it.
    lat: r.lat ?? seed.lat,
    lng: r.lng ?? seed.lng,
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
  // Fire-and-forget, but never unhandled: updatePlace writes to localStorage,
  // which throws on a full or read-only store.
  if (r.lat == null || r.lng == null) {
    void fixSwiggyPosition(created.id, r).catch((e) =>
      console.warn("[swiggy] position lookup failed", e)
    );
  }
  return created.id;
}

// Swipe mode — one of the app's two ways of looking at your places, not a
// feature of the other one. There is no mode control in here, or anywhere: the
// wordmark AppShell renders above both modes is the toggle, and it holds its
// position while the world behind it changes. That's what the entrance animates
// around. Because this is a mode and not a destination, it carries its own lens
// (source + ask + filters) instead of being handed one on the way in.
export default function SwipeMode({
  entrance = "deal",
  closing,
  onRequestClose,
  onClosed,
  onOpenSaved,
  onToast,
}: {
  // "fan" = we were opened by the reveal, so the cards are thrown out of its
  // flare (beat 6, see ModeReveal). "deal" = the plain arrival, which is also
  // what every LATER run of the deck uses — a lens change or a reshuffle isn't
  // a reveal and shouldn't pretend to be one.
  entrance?: "fan" | "deal";
  closing: boolean; // AppShell has asked us to leave — play the outro
  onRequestClose: () => void; // Escape, from in here
  onClosed: () => void; // outro finished; safe to unmount
  onOpenSaved: (id: string) => void; // the escape hatch — full place screen
  onToast: (msg: string) => void;
}) {
  const lens = useLens();
  const { source, query, cuisine, keyword } = lens;
  const [lensOpen, setLensOpen] = useState(false);
  const places = usePlaces();
  const reduced = usePrefersReducedMotion();
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

  // ---- the opening beat's state -----------------------------------------
  const [dealing, setDealing] = useState(true);
  // The entrance we were MOUNTED with. Captured, not read live: AppShell drops
  // the reveal layer at the end of the sequence, flipping the prop back to
  // "deal", and a live read would re-arm mode-in and flash the screen a second
  // after you arrived. `firstRun` is the other half — only the first run of the
  // deck came out of the flash; a lens change or a reshuffle is just a rebuild.
  const [entryKind] = useState(entrance);
  const [firstRun, setFirstRun] = useState(true);
  const [phase, setPhase] = useState<Phase>("deal");
  const [coachOut, setCoachOut] = useState(false);
  const [demo, setDemo] = useState<"left" | "right" | null>(null);
  const coachTimers = useRef<number[]>([]);
  const clearCoach = () => {
    coachTimers.current.forEach(clearTimeout);
    coachTimers.current = [];
  };
  // Skip the rest of the coach. Called by the first touch, the first key, and
  // by any decision — the moment you act, you've been taught.
  const endCoach = () => {
    if (phase === "done") return;
    clearCoach();
    setDemo(null);
    setCoachOut(true);
    coachTimers.current.push(
      window.setTimeout(() => {
        setPhase("done");
        setCoachOut(false);
      }, 320)
    );
  };

  // Leaving: AppShell keeps us mounted for the outro, then drops us. onClosed
  // is read through a ref because AppShell passes a fresh closure every render,
  // and a re-armed timer would never fire.
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => onClosedRef.current(), OUT_MS);
    return () => clearTimeout(t);
  }, [closing]);

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
        entry = { key: card.key, placeId: saveNew(card.r, coords) };
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
      endCoach();
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
    const placeId = saveNew(card.r, coords); // side effect kept out of the state updater
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
      if (detailNew || confirmHide || lensOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (lensOpen) setLensOpen(false);
          else if (detailNew) setDetailNew(null);
          else keepAround();
        }
        return;
      }
      if (["ArrowLeft", "ArrowRight", "Backspace"].includes(e.key) || e.key.toLowerCase() === "u") {
        endCoach();
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
        if (lensOpen) setLensOpen(false);
        else onRequestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, pos, exiting, detailNew, confirmHide, lensOpen, undo.length, phase]);

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

  // The coach runs once per RUN of the deck — opening the mode, changing the
  // lens, starting over — and only once there are actually cards to teach on.
  const runKey = `${source}|${queryKey}|${seed}`;
  useEffect(() => {
    if (!showCards) return;
    // The deal is not part of the coach and is never cancelled: it is the
    // arrival itself, and cutting it mid-flight would snap the cards.
    const deal = window.setTimeout(
      () => setDealing(false),
      entryKind === "fan" && firstRun ? FAN_MS : DEAL_MS
    );

    const at = (ms: number, fn: () => void) => coachTimers.current.push(window.setTimeout(fn, ms));
    at(COACH_AT, () => setPhase("coach"));
    if (!reduced) {
      // Show, don't tell: the card leans the way each button sends it.
      at(DEMO_LEFT_IN, () => setDemo("left"));
      at(DEMO_LEFT_OUT, () => setDemo(null));
      at(DEMO_RIGHT_IN, () => setDemo("right"));
      at(DEMO_RIGHT_OUT, () => setDemo(null));
    }
    at(COACH_FADE, () => setCoachOut(true));
    at(COACH_GONE, () => {
      setPhase("done");
      setCoachOut(false);
    });

    // Winding a run down is also what arms the next one: the state goes back to
    // the top HERE rather than at the head of the effect, so a run never opens
    // by setting four pieces of state during its own first commit.
    return () => {
      clearTimeout(deal);
      clearCoach();
      setFirstRun(false);
      setDealing(true);
      setPhase("deal");
      setCoachOut(false);
      setDemo(null);
    };
  }, [runKey, showCards, reduced]);

  // What a release right now would commit to. During the coach's demo the same
  // stamp appears with no finger behind it — soft, so it fades rather than
  // snapping in.
  const stamp = (() => {
    if (drag) {
      const { dx } = drag;
      if (dx > 0) return { label: rightStamp, color: "var(--s-watchlist)", opacity: dx / SWIPE_THRESHOLD };
      if (dx < 0) return { label: "Nope", color: "var(--s-favorite)", opacity: -dx / SWIPE_THRESHOLD };
      return null;
    }
    if (demo === "right") return { label: rightStamp, color: "var(--s-watchlist)", opacity: 0.75, soft: true };
    if (demo === "left") return { label: "Nope", color: "var(--s-favorite)", opacity: 0.75, soft: true };
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
    if (demo) {
      const dx = demo === "right" ? DEMO_DX : -DEMO_DX;
      return {
        transform: `translateX(${dx}px) rotate(${dx * DEMO_ROT}deg)`,
        transition: "transform 0.42s var(--ease-spring)",
      };
    }
    // Snappy, slightly springy return — reads as "tight", not floaty.
    return { transform: "none", transition: "transform 0.34s var(--ease-spring)" };
  };

  // What the collapsed trigger says. Never just "filters" — the mode should be
  // able to tell you what it is dealing you without being opened up.
  const sourceLabel = source === "saved" ? "Your map" : source === "new" ? "New · Swiggy" : "Everything";

  return (
    <div
      className={`fixed inset-0 z-[52] ${closing ? "mode-out" : entryKind === "fan" ? "" : "mode-in"}`}
      // The deck's own ground, not the map's. It matches the card body exactly,
      // which is what makes the strip iOS leaves below a standalone PWA's
      // viewport read as more screen instead of as a gap under a card.
      style={{ background: "var(--deck-bg)" }}
    >
      {/* ---- card stage: everything below the masthead, edge to edge ---- */}
      <div className="absolute" style={{ top: STAGE_TOP, left: 0, right: 0, bottom: 0 }}>
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
          stack
            .map((card, i) => {
              const top = i === 0;
              const peek: CSSProperties = top
                ? topTransform()
                : {
                    transform: `scale(${1 - i * 0.03}) translateY(${i * 10}px)`,
                    opacity: 1 - i * 0.14,
                    transition: "transform 0.24s ease, opacity 0.24s ease",
                  };
              // The deal animation and the stack transform can't share an
              // element — a CSS animation owns `transform` outright and would
              // drop the peek offset the moment it finished. Outer deals, inner
              // stacks; the gesture stays on the outer, which is what
              // useCardSwipe captures the pointer on.
              const fanning = dealing && entryKind === "fan" && firstRun;
              // Thrown out of the flare and fanned wide before squaring up. The
              // top card lands dead centre; the two behind it are the ones that
              // spread, so the card you actually decide on never does tricks.
              const FAN = [
                { x: "0px", y: "0px", rot: "-5deg" },
                { x: "62px", y: "16px", rot: "24deg" },
                { x: "-64px", y: "26px", rot: "-26deg" },
              ][i] ?? { x: "0px", y: "0px", rot: "0deg" };
              return (
                <div
                  key={card.key}
                  className={`absolute inset-0${dealing ? (fanning ? " fan-in" : " deal-in") : ""}`}
                  style={
                    {
                      zIndex: stack.length - i,
                      // Back card first: the stack builds UNDER the one you
                      // decide on, so the top card is the last thing to land.
                      "--deal-delay": `${(stack.length - 1 - i) * 60}ms`,
                      "--deal-rot": i % 2 === 0 ? "6deg" : "-7deg",
                      "--fan-delay": `${(stack.length - 1 - i) * 55}ms`,
                      "--fan-x": FAN.x,
                      "--fan-y": FAN.y,
                      "--fan-rot": FAN.rot,
                    } as CSSProperties
                  }
                  // The cards underneath are decoration until they're on top:
                  // inert keeps their Directions/Full-details controls out of
                  // the tab order and out of a screen reader, which otherwise
                  // reads three stacked copies of every card.
                  inert={!top}
                  {...(top
                    ? {
                        ...swipe.handlers,
                        onPointerDown: (e: React.PointerEvent) => {
                          endCoach(); // you touched it — the lesson is over
                          swipe.handlers.onPointerDown(e);
                        },
                      }
                    : {})}
                >
                  <div className="absolute inset-0" style={peek}>
                    <SwipeCard
                      card={card}
                      stamp={top ? stamp : null}
                      interactive={top}
                      entering={top && dealing}
                      wasDrag={swipe.wasDrag}
                      onOpenDetails={() => {
                        if (card.kind === "saved") onOpenSaved(card.place.id);
                      }}
                      onBook={() => {
                        if (card.kind === "new") setDetailNew(card.r);
                      }}
                    />
                  </div>
                </div>
              );
            })
            // paint the top card LAST so it wins stacking + receives the pointer
            .reverse()
        )}
      </div>

      {/* The 120px scrim that used to live here is gone with the reason for it:
          the wordmark and the lens chip no longer sit over the photo, they sit
          above the card on the deck's own surface, which is already dark. */}

      {/* ---- what this mode is showing.
          It was a glass pill hung under the wordmark, and it looked it: a
          chunky UI capsule stranded under a delicate serif, two design
          languages colliding in the same corner. It is the same KIND of thing
          the map already puts on that line — "3 places · Bengaluru", the line
          that says what you're looking at — so it's written in that voice now:
          11px, quiet, no capsule, sitting on the wordmark's own left margin.
          Line one is the name, line two is what you're being dealt, in both
          modes. Still the way into the filters; the whole line is the target,
          and the glyph is what says so. */}
      <div
        className="absolute left-5 top-[calc(max(0.9rem,env(safe-area-inset-top))+2rem)] flex"
        style={{ zIndex: 10, maxWidth: "calc(100% - 160px)" }}
      >
        <button
          onClick={() => setLensOpen(true)}
          className="press flex max-w-full items-center gap-1.5"
          style={{ color: "rgba(244,240,238,0.66)" }}
        >
          <SlidersHorizontal size={10.5} strokeWidth={2.5} className="shrink-0" />
          <span className="truncate text-[11px]" style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.01em" }}>
            {sourceLabel}
            {lens.summary.length > 0 && (
              <span className="capitalize"> · {lens.summary.join(" · ")}</span>
            )}
          </span>
        </button>
      </div>

      {/* ---- the coach: which way is which, shown once per run ---- */}
      {phase === "coach" && current && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            zIndex: 12,
            height: COACH_BAR_H,
            opacity: coachOut ? 0 : 1,
            transition: "opacity 0.32s ease",
          }}
        >
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(0deg, rgba(6,7,10,0.9) 20%, rgba(6,7,10,0))" }}
          />
          <div className="relative flex h-full items-start justify-center gap-16">
            <CoachAction
              arrow="←"
              way="Left"
              means="Nope"
              color="var(--s-favorite)"
              label="Skip"
              delay={0}
              lit={demo === "left"}
              disabled={!!exiting}
              onClick={() => {
                endCoach();
                commit("left");
              }}
            >
              <X size={26} strokeWidth={2.75} />
            </CoachAction>

            <CoachAction
              arrow="→"
              way="Right"
              means={rightStamp}
              color="var(--s-watchlist)"
              label={rightAction}
              delay={70}
              lit={demo === "right"}
              disabled={!!exiting}
              onClick={() => {
                endCoach();
                commit("right");
              }}
            >
              {isNewCard ? (
                <Heart size={24} strokeWidth={2.5} fill="currentColor" />
              ) : (
                // A heart over a place you already saved reads as "save it" too —
                // same false promise as the label, so the glyph branches with it.
                <Check size={26} strokeWidth={3} />
              )}
            </CoachAction>
          </div>
        </div>
      )}

      {/* Undo is not one of the two decisions and doesn't retire with them: it
          only exists once there IS something to take back, and it has to
          outlive the cards — mis-swiping the LAST card would otherwise leave a
          touch user with no way back at all. */}
      {undo.length > 0 && phase !== "coach" && (
        <div
          className="absolute inset-x-0 bottom-0 flex justify-end pr-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          style={{ zIndex: 11 }}
        >
          <button
            onClick={doUndo}
            disabled={!!exiting}
            aria-label="Undo last swipe"
            className="press animate-rise flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-40"
            style={{
              background: "var(--glass)",
              backdropFilter: "blur(22px) saturate(1.3)",
              WebkitBackdropFilter: "blur(22px) saturate(1.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 10px 28px -12px rgba(0,0,0,0.5)",
              color: "oklch(0.86 0 0)",
            }}
          >
            <RotateCcw size={14} strokeWidth={2.5} /> Undo
          </button>
        </div>
      )}

      {lensOpen && <LensPanel lens={lens} onClose={() => setLensOpen(false)} />}

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

// One side of the coach: the button, the direction it stands for, and what that
// direction does to THIS card. Dark-glass circle, state colour on the glyph
// only — the deck's stamp vocabulary (amber = watchlist/yes, red = nope) reads
// the same on the stamp, the button and the caption. `lit` is the demo passing
// through: the button the card is leaning towards brightens with it, so the
// lean and the control are visibly the same thing.
function CoachAction({
  arrow,
  way,
  means,
  color,
  label,
  delay,
  lit,
  disabled,
  onClick,
  children,
}: {
  arrow: string;
  way: string;
  means: string;
  color: string;
  label: string; // the real accessible name — "Skip" / "Add to watchlist"
  delay: number;
  lit: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="coach-in flex flex-col items-center"
      style={{ "--coach-delay": `${delay}ms` } as CSSProperties}
    >
      <button
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
        className="press pointer-events-auto grid place-items-center rounded-full disabled:opacity-35"
        style={{
          height: 60,
          width: 60,
          color,
          background: "var(--glass)",
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          border: `1px solid ${lit ? color : "var(--border-strong)"}`,
          boxShadow: lit ? `0 0 0 4px color-mix(in oklch, ${color} 22%, transparent)` : "var(--shadow-pop)",
          transform: lit ? "scale(1.08)" : "none",
          transition: "transform 0.3s var(--ease-spring), box-shadow 0.3s ease, border-color 0.3s ease",
        }}
      >
        {children}
      </button>
      <span
        className="mt-2 text-[11.5px] font-bold"
        style={{ color, opacity: lit ? 1 : 0.9, transition: "opacity 0.3s ease" }}
      >
        {arrow === "←" ? `${arrow} ${way}` : `${way} ${arrow}`}
      </span>
      <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.6)" }}>
        {means}
      </span>
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
