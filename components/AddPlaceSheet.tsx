"use client";

import { createElement, useEffect, useRef, useState } from "react";
import {
  X,
  Search,
  LocateFixed,
  ArrowLeft,
  MapPin,
  Star,
  Loader2,
  Navigation2,
  Check,
  Clapperboard,
} from "lucide-react";
import { addPlace, findDuplicate, getPlace, updatePlace } from "@/lib/store";
import { parseLocation, isUrl } from "@/lib/capture";
import { searchPlaces, nearbyPlaces, resolveMapsLink, enrichPlaceFromGoogle, type GooglePlace } from "@/lib/places";
import { tagsFromGoogleTypes } from "@/lib/googleTags";
import { priceSigns } from "@/lib/format";
import { TAG_OPTIONS, type CaptureSource, type Tag } from "@/lib/types";
import { searchBias, noteGpsFix, noteGeoGranted } from "@/lib/bias";
import { glyphFor } from "./PlaceGlyph";
import Pin from "./Pin";
import { useSheetDrag } from "./useSheetDrag";
import { WHITE_ACTION, INK_PILL, IgDot } from "./placeChrome";

// The + surface = ADDING a place, not searching what's already logged (that's
// the search dock). It opens on one field — the map's search dock, continued —
// which takes a name (Google text search) or a pasted Maps link (short goo.gl
// links resolve server-side) alike; "pin where I am" sits under it as the one
// other way in, reverse-matched to the real places around you (raw GPS is only
// the fallback). Every route ends on the same confirm screen, where the pick is
// shown as the sticker it is about to become on the map.
type Mode = "search" | "nearby" | "confirm";

// A picked-but-not-yet-saved place. `commit()` creates it and returns its id;
// `backTo` is the route to return to if you back out of confirm. `baseTags` is
// whatever Google implied MINUS the type — the type is picked on the confirm
// screen, so it is passed back in separately rather than baked in here.
type Pending = {
  name: string;
  sub?: string;
  backTo: Mode;
  baseTags: Tag[];
  seedTypes: string[]; // Google's guess at the type, pre-selected but editable
  commit: (notes: string, reelUrl: string | undefined, types: string[]) => string;
};

const TITLES: Record<Mode, string> = {
  search: "Add a place",
  nearby: "Around you",
  confirm: "Save it",
};

export type AddedOpts = {
  duplicate?: boolean;
  beenAlready?: boolean;
  // A shared reel on a place already saved: "added" to it, or "kept" the one it had.
  reel?: "added" | "kept";
};

export default function AddPlaceSheet({
  open,
  onClose,
  onAdded,
  initialQuery,
  initialReel,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string, opts?: AddedOpts) => void;
  initialQuery?: string;
  // A reel shared in from another app (Android's share sheet, lib/share.ts):
  // the link is already known, so the sheet opens straight on the name.
  initialReel?: string;
}) {
  const [mode, setMode] = useState<Mode>("search");
  const [q, setQ] = useState(initialQuery ?? "");
  const [gResults, setGResults] = useState<GooglePlace[]>([]);
  const [gLoading, setGLoading] = useState(false);
  // Keyed by the exact URL it resolved, so a changed input never shows stale
  // results and the effect body never sets state synchronously.
  const [resolved, setResolved] = useState<{
    q: string;
    results: GooglePlace[];
    coords: { lat: number; lng: number } | null;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [nearby, setNearby] = useState<{ lat: number; lng: number; results: GooglePlace[]; accuracy?: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  // Escape mirrors the Back button rather than closing outright: this sheet is
  // a couple of screens deep (search/nearby → confirm) and a blunt dismiss
  // halfway through would throw away a place you'd already picked. Step back
  // one level; from the field, leave. Same target the ArrowLeft uses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "search") onClose();
      else setMode(mode === "confirm" && pending ? pending.backTo : "search");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, pending, onClose]);
  const [note, setNote] = useState("");
  const [reel, setReel] = useState(initialReel ?? ""); // optional Instagram reel link, taken on confirm
  // What kind of place this is. Seeded from Google's types where it knows, but
  // always editable and always offered — this app maps viewpoints and museums,
  // not only somewhere to eat, and Google is silent on plenty of them.
  const [types, setTypes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  // Focus the field whenever the search screen is showing (mounted fresh each
  // open, so state starts there — no reset effect needed).
  useEffect(() => {
    if (mode === "search") inputRef.current?.focus();
  }, [mode]);

  // One field, three readings: a URL resolves as a link, "lat, lng" pins
  // straight away, anything else is a name to search.
  const query = q.trim();
  const urlMode = isUrl(query);
  const localCoords = query ? parseLocation(query) : null;
  const showResults = mode === "search" && !urlMode && !localCoords && query.length >= 2;

  // Live Google text search (debounced), biased to where you are. Only "new"
  // places here — no local list, so the + never re-surfaces what you've logged.
  // All state writes happen inside the deferred callback; the render gates on
  // `showResults` so stale results never show once the query drops below 2.
  useEffect(() => {
    if (!showResults) return;
    const ctrl = new AbortController();
    let active = true;
    const t = setTimeout(async () => {
      if (!active) return;
      setGLoading(true);
      const { results } = await searchPlaces(query, searchBias(), ctrl.signal);
      if (active && !ctrl.signal.aborted) {
        setGResults(results);
        setGLoading(false);
      }
    }, 350);
    return () => {
      active = false;
      ctrl.abort();
      clearTimeout(t);
      // A search cut short (the text changed, or became a link) must not
      // leave its spinner behind.
      setGLoading(false);
    };
  }, [query, showResults]);

  // Pasted URL → expand server-side (handles maps.app.goo.gl), then text-search
  // the extracted name so the pin lands on a real place, not viewport coords.
  // All state writes are deferred into the timeout (React 19 lint) and keyed to
  // the query, so stale resolutions never leak onto a changed input.
  useEffect(() => {
    if (mode !== "search" || !urlMode) return;
    let active = true;
    const t = setTimeout(async () => {
      if (!active) return;
      setResolving(true);
      const r = await resolveMapsLink(query);
      if (!active) return;
      const coords = r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
      let results: GooglePlace[] = [];
      if (r.name) {
        // The link's own coordinates beat everything when it carried any.
        ({ results } = await searchPlaces(r.name, coords ?? searchBias()));
        if (!active) return;
      }
      setResolved({ q: query, results, coords });
      setResolving(false);
    }, 500);
    return () => {
      active = false;
      clearTimeout(t);
      setResolving(false);
    };
  }, [mode, urlMode, query]);

  const linkResults = urlMode && resolved && resolved.q === query ? resolved.results : [];
  const linkCoords = urlMode && resolved && resolved.q === query ? resolved.coords : null;
  const resolveFailed =
    urlMode && !!resolved && resolved.q === query && resolved.results.length === 0 && !resolved.coords;

  if (!open) return null;

  const finish = (id: string, opts?: AddedOpts) => {
    onAdded(id, opts);
    onClose();
  };

  // A shared reel that turns out to be about a place already on your map goes
  // onto that place — unless it already has a reel, which is never replaced
  // silently (the old link was saved on purpose).
  const finishDuplicate = (id: string) => {
    if (!initialReel) return finish(id, { duplicate: true });
    const existing = getPlace(id)?.reelUrl;
    if (!existing) updatePlace(id, { reelUrl: initialReel });
    finish(id, { duplicate: true, reel: existing ? "kept" : "added" });
  };

  // Move to the confirm screen (type + optional note), unless it's already saved.
  const toConfirm = (
    name: string,
    sub: string | undefined,
    backTo: Mode,
    baseTags: Tag[],
    seedTypes: string[],
    commit: (notes: string, reelUrl: string | undefined, chosen: string[]) => string
  ) => {
    setNote("");
    // A shared reel is the reason this sheet opened; it survives picking a place.
    setReel(initialReel ?? "");
    setTypes(seedTypes);
    setPending({ name, sub, backTo, baseTags, seedTypes, commit });
    setMode("confirm");
  };

  const addAt = (lat: number, lng: number, name: string, source: CaptureSource, backTo: Mode) => {
    const dup = findDuplicate({ name, lat, lng });
    if (dup) return finishDuplicate(dup.id);
    toConfirm(name, undefined, backTo, [], [], (notes, reelUrl, chosen) =>
      addPlace({
        googlePlaceId: null,
        name,
        address: "",
        lat,
        lng,
        status: "watchlist",
        myRating: null,
        googleRating: null,
        myBudgetPerPerson: null,
        googlePriceLevel: null,
        notes,
        reelUrl,
        tags: chosen.map((value) => ({ namespace: "type" as const, value })),
        source,
        enrichedAt: null,
      }).id
    );
  };

  // Add a real Google result — coords + rating/price/hours come for free, and
  // its first Google photo is pulled once in the background.
  const addGoogle = (r: GooglePlace, backTo: Mode) => {
    const dup = findDuplicate({ googlePlaceId: r.placeId, name: r.name, lat: r.lat, lng: r.lng });
    if (dup) return finishDuplicate(dup.id);
    // Google's guess splits two ways: the type seeds the chips (editable), and
    // everything else it inferred (cuisine, staple…) rides along untouched.
    const derived = tagsFromGoogleTypes(r.googleTypes);
    const seedTypes = derived.filter((t) => t.namespace === "type").map((t) => t.value);
    const baseTags = derived.filter((t) => t.namespace !== "type");
    toConfirm(r.name, r.area || r.address || undefined, backTo, baseTags, seedTypes, (notes, reelUrl, chosen) => {
      const place = addPlace({
        googlePlaceId: r.placeId,
        name: r.name,
        address: r.address,
        area: r.area,
        city: r.city,
        lat: r.lat,
        lng: r.lng,
        status: "watchlist",
        myRating: null,
        googleRating: r.googleRating,
        googleReviewCount: r.googleReviewCount,
        myBudgetPerPerson: null,
        googlePriceLevel: r.googlePriceLevel,
        notes,
        reelUrl,
        // What you picked on the confirm screen, plus the rest of what Google
        // implied — searchable immediately either way.
        tags: [...chosen.map((value) => ({ namespace: "type" as const, value })), ...baseTags],
        googleTypes: r.googleTypes,
        openingPeriods: r.openingPeriods,
        hoursText: r.hoursText,
        source: "search",
        enrichedAt: new Date().toISOString(),
      });
      // Enrich-once from Place Details: the editorial "lowdown", refreshed
      // hours, and a cover photo — the research the assistant reads later.
      void enrichPlaceFromGoogle(place.id, r.placeId);
      return place.id;
    });
  };

  const saveConfirm = (beenAlready = false) => {
    if (pending) finish(pending.commit(note.trim(), reel.trim() || undefined, types), { beenAlready });
  };

  // "Pin where I am": reverse-match the GPS fix to the real places around it.
  // Only if nothing matches (or there's no API key) does it fall back to a raw
  // dropped pin — location is used for the lookup, not stored as the place.
  const pinHere = () => {
    if (!("geolocation" in navigator)) {
      setGeoError("Location isn’t available on this device.");
      return;
    }
    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        // The one place the app is allowed to ask for location is also the only
        // proof of permission some browsers will ever give us — bank both the
        // fix and the fact that it was granted. See lib/bias.ts.
        noteGpsFix({ lat, lng });
        noteGeoGranted();
        const { results } = await nearbyPlaces(lat, lng, accuracy);
        setLocating(false);
        if (results.length) {
          setNearby({ lat, lng, results, accuracy });
          setMode("nearby");
        } else {
          addAt(lat, lng, "Pinned location", "manual", "search");
        }
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn’t get your location — try again."
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  const coords = localCoords ?? linkCoords;
  // The glyph the sticker will carry: the type picked on this screen, else
  // whatever Google implied. A lucide icon is a component, so it is rendered
  // with createElement rather than as a JSX tag chosen during render.
  const pendingGlyph = pending
    ? createElement(
        glyphFor({ tags: [...types.map((value) => ({ namespace: "type" as const, value })), ...pending.baseTags] }),
        { size: 16, strokeWidth: 2.25 }
      )
    : null;

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(10,8,12,0.64)" }} onClick={onClose}>
      <div
        ref={sheetRef}
        className="scroll-quiet absolute inset-x-0 bottom-0 max-h-[94dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* handle + header */}
        <div className="sticky top-0 z-10 px-5 pt-2" style={{ background: "var(--bg-raised)" }}>
          <div {...handleProps} className="flex cursor-grab touch-none justify-center pb-3 pt-0.5">
            <span className="h-[5px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
          </div>
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2.5">
              {mode !== "search" && (
                <button
                  onClick={() => setMode(mode === "confirm" && pending ? pending.backTo : "search")}
                  aria-label="Back"
                  className="press grid h-8 w-8 place-items-center rounded-full"
                  style={{ background: "rgba(255,255,255,0.07)", color: "var(--text-secondary)" }}
                >
                  <ArrowLeft size={15} strokeWidth={2.25} />
                </button>
              )}
              <h1
                className="text-[22px] font-medium leading-none tracking-[-0.01em]"
                style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
              >
                {TITLES[mode]}
              </h1>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press grid h-8 w-8 place-items-center rounded-full"
              style={{ background: "rgba(255,255,255,0.07)", color: "var(--text-secondary)" }}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-1">
          {mode === "search" && (
            <div className="pb-2">
              {initialReel && reel === initialReel && (
                <p className="mb-3 flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
                  <Clapperboard size={13} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
                  Reel attached — now find the place it’s about
                </p>
              )}
              {/* the field: the map's search dock, continued */}
              <div
                className="flex h-12 items-center gap-2.5 pl-4 pr-3"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-chip)" }}
              >
                <Search size={17} strokeWidth={2.25} className="shrink-0" style={{ color: "var(--accent)" }} />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, or a Google Maps link"
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                {/* fixed slot — the spinner never nudges the field */}
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  {((showResults && gLoading) || (urlMode && resolving)) && (
                    <Loader2 size={15} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />
                  )}
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  onClick={pinHere}
                  disabled={locating}
                  className="press inline-flex h-11 items-center gap-1.5 px-4 text-[13px] font-semibold disabled:opacity-70"
                  style={INK_PILL}
                >
                  {locating ? <Loader2 size={15} className="animate-spin" /> : <LocateFixed size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />}
                  {locating ? "Finding places around you…" : "Pin where I am"}
                </button>
                {geoError && (
                  <span className="text-[12.5px]" style={{ color: "var(--s-favorite)" }}>{geoError}</span>
                )}
              </div>

              {/* The panel holds its height from the moment this screen opens,
                  not from the first result. The sheet is bottom-anchored, so a
                  panel that only appears on the second keystroke shoves the
                  field — and the thumb already resting on it — a third of the
                  screen upward mid-word. Reserved up front, only the CONTENTS
                  switch as you type. CommandPalette's list does the same. */}
              <div className="scroll-quiet mt-3 flex h-[42vh] flex-col overflow-y-auto">
                {!showResults && !urlMode && !coords && (
                  <p className="px-1 py-5 text-center text-[13px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                    Saw it in a reel? Type the name.
                    <br />
                    Or paste any Google Maps link someone sent.
                  </p>
                )}
                {showResults && gResults.map((r) => (
                  <ResultRow key={r.placeId} r={r} onPick={() => addGoogle(r, "search")} />
                ))}
                {showResults && !gLoading && gResults.length === 0 && (
                  <p className="px-1 py-5 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    No matches — check the spelling or paste a link instead.
                  </p>
                )}

                {linkResults.map((r) => (
                  <ResultRow key={r.placeId} r={r} onPick={() => addGoogle(r, "search")} />
                ))}
                {coords && linkResults.length === 0 && (
                  <button
                    onClick={() => addAt(coords.lat, coords.lng, "Pinned location", "paste", "search")}
                    className="press mt-1 flex h-12 w-full items-center gap-2.5 px-4"
                    style={WHITE_ACTION}
                  >
                    <Navigation2 size={16} strokeWidth={2.5} />
                    <span className="text-[14.5px] font-semibold">Pin this location</span>
                    <span className="ml-auto text-[11.5px]" style={{ fontFamily: "var(--font-mono)", opacity: 0.6 }}>
                      {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                    </span>
                  </button>
                )}
                {urlMode && !coords && linkResults.length === 0 && !resolving && (
                  <p className="px-1 py-5 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    {resolveFailed ? "Couldn’t read that link — try the place’s name instead." : "Reading the link…"}
                  </p>
                )}
              </div>
            </div>
          )}

          {mode === "nearby" && nearby && (
            <div className="pb-2">
              <p className="mb-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                Pick the one you’re at.
              </p>
              {/* GPS on the first fix (or indoors) can land 100s of m off —
                  say so rather than let a wrong pick look confident. */}
              {nearby.accuracy != null && nearby.accuracy > 300 && (
                <p className="mb-1 text-[12px]" style={{ color: "var(--s-favorite)" }}>
                  Location is approximate (±{Math.round(nearby.accuracy)}m) — pick carefully, or drop a pin instead.
                </p>
              )}
              <div className="flex flex-col">
                {nearby.results.map((r) => (
                  <ResultRow key={r.placeId} r={r} onPick={() => addGoogle(r, "nearby")} />
                ))}
              </div>
              <button
                onClick={() => addAt(nearby.lat, nearby.lng, "Pinned location", "manual", "nearby")}
                className="press mt-3 inline-flex h-10 items-center gap-1.5 text-[13px] font-medium"
                style={{ color: "var(--text-tertiary)" }}
              >
                <MapPin size={14} /> None of these — just drop a pin here
              </button>
            </div>
          )}

          {mode === "confirm" && pending && (
            <div className="pb-2">
              {/* what lands on the map: the sticker, on a scrap of the paper */}
              <div
                className="grid h-[140px] w-full place-items-center overflow-hidden"
                style={{
                  borderRadius: "var(--radius)",
                  background: "radial-gradient(rgba(20,16,24,0.13) 1px, transparent 1.2px) 0 0 / 14px 14px, #f3f3f0",
                }}
              >
                <div className="pointer-events-none max-w-[86%]">
                  <Pin
                    name={pending.name}
                    glyph={pendingGlyph}
                    color="var(--s-watchlist)"
                    active
                    maxWidth={240}
                  />
                </div>
              </div>
              {pending.sub && (
                <p className="mt-2.5 truncate text-center text-[12.5px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                  {pending.sub}
                </p>
              )}

              {/* What kind of place. Asked every time rather than inferred and
                  hidden: this map is for viewpoints and museums as much as for
                  dinner, and Google has no type at all for plenty of them.
                  Pre-selected where Google was confident, always editable. */}
              <p className="mt-5 text-[13.5px]" style={{ color: "var(--text-secondary)" }}>What kind of place is it?</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TAG_OPTIONS.type.map((v) => {
                  const on = types.includes(v);
                  return (
                    <button
                      key={v}
                      onClick={() => setTypes((prev) => (on ? prev.filter((x) => x !== v) : [...prev, v]))}
                      className="press inline-flex items-center gap-1 px-3 py-[7px] text-[13px] font-medium transition-colors"
                      style={{
                        borderRadius: "var(--radius-chip)",
                        background: on ? "oklch(0.97 0 0)" : "rgba(255,255,255,0.07)",
                        color: on ? "oklch(0.16 0.006 260)" : "var(--text-secondary)",
                      }}
                    >
                      {on && <Check size={11} strokeWidth={3} />}
                      {v}
                    </button>
                  );
                })}
              </div>

              {/* optional one-liner — the assistant reads this. No autoFocus:
                  the type chips sit above it, and a keyboard opening on arrival
                  would cover the question you're meant to answer first. */}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why you saved it — “the courtyard looked unreal”"
                rows={2}
                className="mt-5 w-full resize-none bg-transparent pb-2 text-[16px] italic leading-snug outline-none"
                style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)", borderBottom: "1px solid var(--border-strong)" }}
              />

              {/* optional reel link — most saves start on a reel; this is the
                  "go back and see why" handle, shown later as Watch on Instagram */}
              <div className="mt-2 flex items-center gap-2.5" style={{ borderBottom: "1px solid var(--border-strong)" }}>
                {/* Once a link is in, its dot is the way to open it and check
                    it is about the place you picked — a shared reel arrives
                    unseen by this sheet. */}
                {reel.trim() ? (
                  <a
                    href={/^https?:\/\//i.test(reel.trim()) ? reel.trim() : `https://${reel.trim()}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Watch the reel"
                    className="press grid h-11 w-8 shrink-0 place-items-center"
                  >
                    <IgDot size={18} />
                  </a>
                ) : (
                  <Clapperboard size={16} strokeWidth={2} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                )}
                <input
                  value={reel}
                  onChange={(e) => setReel(e.target.value)}
                  inputMode="url"
                  placeholder="The reel it came from — optional"
                  className="min-w-0 flex-1 bg-transparent py-3 text-[14px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
              </div>

              <button
                onClick={() => saveConfirm()}
                className="press mt-5 flex h-12 w-full items-center justify-center gap-2 text-[14.5px] font-bold"
                style={WHITE_ACTION}
              >
                <Check size={16} strokeWidth={2.75} /> Save to watchlist
              </button>
              <button
                onClick={() => saveConfirm(true)}
                className="press mt-1 flex h-11 w-full items-center justify-center gap-1.5 text-[13.5px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                I’ve already been here
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One Google result — shared by search, link, and nearby. Drawn as the pin it
// would become: the watchlist disc with the type Google implied, the name, the
// address, the reference numbers in mono. Rows are separated by a hairline, not
// boxed: a list of places, not a list of cards.
function ResultRow({ r, onPick }: { r: GooglePlace; onPick: () => void }) {
  const glyph = createElement(glyphFor({ tags: tagsFromGoogleTypes(r.googleTypes) }), { size: 18, strokeWidth: 2 });
  return (
    <button
      onClick={onPick}
      className="press flex w-full items-center gap-3 py-2.5 text-left"
      style={{ borderTop: "1px solid var(--ink-line)" }}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center" style={{ borderRadius: 12, background: "var(--s-watchlist)", color: "#fff" }}>
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>
          {r.name}
        </span>
        {r.address && (
          <span className="block truncate text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
            {r.address}
          </span>
        )}
      </span>
      {(r.googleRating != null || r.googlePriceLevel != null) && (
        <span className="ml-auto shrink-0 text-[11.5px]" style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
          {r.googleRating != null && (
            <span className="inline-flex items-center gap-0.5" style={{ color: "var(--text-secondary)" }}>
              <Star size={10} fill="currentColor" strokeWidth={0} /> {r.googleRating.toFixed(1)}
            </span>
          )}
          {r.googlePriceLevel != null && <span className="ml-1.5">{priceSigns(r.googlePriceLevel)}</span>}
        </span>
      )}
    </button>
  );
}
