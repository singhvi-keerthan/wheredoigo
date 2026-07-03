"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Search,
  Link as LinkIcon,
  LocateFixed,
  ChevronRight,
  ArrowLeft,
  MapPin,
  Star,
  Loader2,
  Navigation2,
  Check,
  CalendarCheck,
} from "lucide-react";
import { addPlace, findDuplicate } from "@/lib/store";
import { parseLocation, isUrl } from "@/lib/capture";
import { searchPlaces, nearbyPlaces, resolveMapsLink, attachGooglePhoto, type GooglePlace } from "@/lib/places";
import { tagsFromGoogleTypes } from "@/lib/googleTags";
import { priceSigns } from "@/lib/format";
import type { CaptureSource } from "@/lib/types";
import { DEFAULT_VIEW } from "@/lib/seed";
import { useSheetDrag } from "./useSheetDrag";

// The + surface = ADDING a place, not searching what's already logged (that's
// the search dock). Three routes, straight from the design: search by name
// (Google), paste a Maps link (short goo.gl links resolve server-side), or pin
// the current location (reverse-matched to the real places around you — raw
// GPS is only the fallback). Each ends on a lightweight "confirm" screen where
// you can drop an optional one-line note.
type Mode = "menu" | "search" | "link" | "nearby" | "confirm";

// A picked-but-not-yet-saved place. `commit(notes)` creates it and returns its id;
// `backTo` is the route to return to if you back out of the confirm screen.
type Pending = { name: string; sub?: string; backTo: Mode; commit: (notes: string) => string };

const TITLES: Record<Mode, string> = {
  menu: "Add a place",
  search: "Search by name",
  link: "Paste a link",
  nearby: "Pin where I am",
  confirm: "Add a note",
};

export default function AddPlaceSheet({
  open,
  onClose,
  onAdded,
  initialQuery,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (id: string, opts?: { duplicate?: boolean; beenAlready?: boolean }) => void;
  initialQuery?: string;
}) {
  const [mode, setMode] = useState<Mode>(initialQuery ? "search" : "menu");
  const [q, setQ] = useState(initialQuery ?? "");
  const [gResults, setGResults] = useState<GooglePlace[]>([]);
  const [gLoading, setGLoading] = useState(false);
  const [link, setLink] = useState("");
  // Keyed by the exact URL it resolved, so a changed input never shows stale
  // results and the effect body never sets state synchronously.
  const [resolved, setResolved] = useState<{
    q: string;
    results: GooglePlace[];
    coords: { lat: number; lng: number } | null;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [nearby, setNearby] = useState<{ lat: number; lng: number; results: GooglePlace[] } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { sheetRef, handleProps } = useSheetDrag(onClose);

  // Focus the field when entering a text route (mounted fresh each open, so
  // state starts at the menu — no reset effect needed).
  useEffect(() => {
    if (mode === "search" || mode === "link") inputRef.current?.focus();
  }, [mode]);

  const query = q.trim();
  const showResults = mode === "search" && query.length >= 2;

  // Live Google text search (debounced), biased to the home city. Only "new"
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
      const { results } = await searchPlaces(
        query,
        { lat: DEFAULT_VIEW.latitude, lng: DEFAULT_VIEW.longitude },
        ctrl.signal
      );
      if (active && !ctrl.signal.aborted) {
        setGResults(results);
        setGLoading(false);
      }
    }, 350);
    return () => {
      active = false;
      ctrl.abort();
      clearTimeout(t);
    };
  }, [query, showResults]);

  // Pasted URL → expand server-side (handles maps.app.goo.gl), then text-search
  // the extracted name so the pin lands on a real place, not viewport coords.
  // All state writes are deferred into the timeout (React 19 lint) and keyed to
  // the query, so stale resolutions never leak onto a changed input.
  const linkTrimmed = link.trim();
  const localCoords = linkTrimmed ? parseLocation(linkTrimmed) : null;
  useEffect(() => {
    if (mode !== "link" || !isUrl(linkTrimmed)) return;
    let active = true;
    const t = setTimeout(async () => {
      if (!active) return;
      setResolving(true);
      const r = await resolveMapsLink(linkTrimmed);
      if (!active) return;
      const coords = r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null;
      let results: GooglePlace[] = [];
      if (r.name) {
        ({ results } = await searchPlaces(
          r.name,
          coords ?? { lat: DEFAULT_VIEW.latitude, lng: DEFAULT_VIEW.longitude }
        ));
        if (!active) return;
      }
      setResolved({ q: linkTrimmed, results, coords });
      setResolving(false);
    }, 500);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [mode, linkTrimmed]);

  const linkResults = resolved && resolved.q === linkTrimmed ? resolved.results : [];
  const linkCoords = resolved && resolved.q === linkTrimmed ? resolved.coords : null;
  const resolveFailed =
    !!resolved && resolved.q === linkTrimmed && resolved.results.length === 0 && !resolved.coords;

  if (!open) return null;

  const finish = (id: string, opts?: { duplicate?: boolean; beenAlready?: boolean }) => {
    onAdded(id, opts);
    onClose();
  };

  // Move to the confirm screen (optional note), unless it's already saved.
  const toConfirm = (name: string, sub: string | undefined, backTo: Mode, commit: (notes: string) => string) => {
    setNote("");
    setPending({ name, sub, backTo, commit });
    setMode("confirm");
  };

  const addAt = (lat: number, lng: number, name: string, source: CaptureSource, backTo: Mode) => {
    const dup = findDuplicate({ name, lat, lng });
    if (dup) return finish(dup.id, { duplicate: true });
    toConfirm(name, undefined, backTo, (notes) =>
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
        tags: [],
        source,
        enrichedAt: null,
      }).id
    );
  };

  // Add a real Google result — coords + rating/price/hours come for free, and
  // its first Google photo is pulled once in the background.
  const addGoogle = (r: GooglePlace, backTo: Mode) => {
    const dup = findDuplicate({ googlePlaceId: r.placeId, name: r.name, lat: r.lat, lng: r.lng });
    if (dup) return finish(dup.id, { duplicate: true });
    toConfirm(r.name, r.area || r.address || undefined, backTo, (notes) => {
      const place = addPlace({
        googlePlaceId: r.placeId,
        name: r.name,
        address: r.address,
        area: r.area,
        lat: r.lat,
        lng: r.lng,
        status: "watchlist",
        myRating: null,
        googleRating: r.googleRating,
        myBudgetPerPerson: null,
        googlePriceLevel: r.googlePriceLevel,
        notes,
        // Auto-derived from Google's types so it's searchable immediately.
        tags: tagsFromGoogleTypes(r.googleTypes),
        googleTypes: r.googleTypes,
        openingPeriods: r.openingPeriods,
        hoursText: r.hoursText,
        source: "search",
        enrichedAt: new Date().toISOString(),
      });
      void attachGooglePhoto(place.id, r.photoName);
      return place.id;
    });
  };

  const saveConfirm = (beenAlready = false) => {
    if (pending) finish(pending.commit(note.trim()), { beenAlready });
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
        const { latitude: lat, longitude: lng } = pos.coords;
        const { results } = await nearbyPlaces(lat, lng);
        setLocating(false);
        if (results.length) {
          setNearby({ lat, lng, results });
          setMode("nearby");
        } else {
          addAt(lat, lng, "Pinned location", "manual", "menu");
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
            <div className="h-[4px] w-10 rounded-full" style={{ background: "var(--ink-line)" }} />
          </div>
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              {mode !== "menu" && (
                <button
                  onClick={() => setMode(mode === "confirm" && pending ? pending.backTo : "menu")}
                  aria-label="Back"
                  className="press grid h-7 w-7 place-items-center rounded-full"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
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
              className="press grid h-7 w-7 place-items-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </div>
        </div>

        <div className="px-5 pt-1">
          {mode === "menu" && (
            <div className="flex flex-col gap-2.5 pb-2">
              <MenuRow
                icon={<Search size={20} strokeWidth={2.5} />}
                title="Search by name"
                sub="Saw it in a reel? Type the name"
                onClick={() => setMode("search")}
              />
              <MenuRow
                icon={<LinkIcon size={19} strokeWidth={2.25} />}
                title="Paste a link"
                sub="A Google Maps link someone sent"
                onClick={() => setMode("link")}
              />
              <MenuRow
                icon={locating ? <Loader2 size={19} className="animate-spin" /> : <LocateFixed size={19} strokeWidth={2.25} />}
                title="Pin where I am"
                sub={locating ? "Finding places around you…" : "Use your current location"}
                onClick={pinHere}
              />
              {geoError && (
                <p className="px-1 text-[12.5px]" style={{ color: "var(--s-never, #e5786f)" }}>
                  {geoError}
                </p>
              )}
            </div>
          )}

          {mode === "search" && (
            <div className="pb-2">
              <div
                className="flex items-center gap-2.5 px-3.5"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
              >
                <Search size={17} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="e.g. Blue Tokai, Koramangala"
                  className="flex-1 bg-transparent py-3.5 text-[14.5px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                {gLoading && <Loader2 size={15} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />}
              </div>

              <div className="mt-2 flex flex-col gap-1.5">
                {showResults && gResults.map((r) => (
                  <ResultRow key={r.placeId} r={r} onPick={() => addGoogle(r, "search")} />
                ))}
                {showResults && !gLoading && gResults.length === 0 && (
                  <p className="px-1 py-4 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    No matches — check the spelling or paste a link instead.
                  </p>
                )}
              </div>
            </div>
          )}

          {mode === "link" && (
            <div className="pb-2">
              <div
                className="flex items-center gap-2.5 px-3.5"
                style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
              >
                <LinkIcon size={17} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
                <input
                  ref={inputRef}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="Paste a Google Maps link or lat, lng"
                  className="flex-1 bg-transparent py-3.5 text-[14.5px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                {resolving && <Loader2 size={15} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />}
              </div>

              {linkResults.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {linkResults.map((r) => (
                    <ResultRow key={r.placeId} r={r} onPick={() => addGoogle(r, "link")} />
                  ))}
                </div>
              )}

              {(() => {
                const coords = localCoords ?? linkCoords;
                if (!coords || linkResults.length > 0) return null;
                return (
                  <button
                    onClick={() => addAt(coords.lat, coords.lng, "Pinned location", "paste", "link")}
                    className="press mt-2.5 flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-3.5 py-3"
                    style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)" }}
                  >
                    <Navigation2 size={16} strokeWidth={2.5} />
                    <span className="text-[14.5px] font-semibold">Pin this location</span>
                    <span className="ml-auto font-[family-name:var(--font-mono)] text-[11.5px]" style={{ opacity: 0.6 }}>
                      {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                    </span>
                  </button>
                );
              })()}

              {!localCoords && !linkCoords && linkResults.length === 0 && !resolving && (
                <p className="mt-2.5 px-1 text-[12.5px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
                  {resolveFailed
                    ? "Couldn’t read that link — try searching the place by name instead."
                    : <>Paste any Google Maps link — including short <span style={{ color: "var(--text-secondary)" }}>maps.app.goo.gl</span> shares — or raw <span style={{ color: "var(--text-secondary)" }}>lat, lng</span>.</>}
                </p>
              )}
            </div>
          )}

          {mode === "nearby" && nearby && (
            <div className="pb-2">
              <p className="mb-2 px-1 text-[12.5px]" style={{ color: "var(--text-tertiary)" }}>
                Places around you — pick the one you’re at.
              </p>
              <div className="flex flex-col gap-1.5">
                {nearby.results.map((r) => (
                  <ResultRow key={r.placeId} r={r} onPick={() => addGoogle(r, "nearby")} />
                ))}
              </div>
              <button
                onClick={() => addAt(nearby.lat, nearby.lng, "Pinned location", "manual", "nearby")}
                className="press mt-2.5 flex w-full items-center justify-center gap-2 py-3 text-[13.5px] font-semibold"
                style={{ borderRadius: "var(--radius-chip)", border: "1px dashed var(--border-strong)", color: "var(--text-secondary)" }}
              >
                <MapPin size={15} /> None of these — just drop a pin here
              </button>
            </div>
          )}

          {mode === "confirm" && pending && (
            <div className="pb-2">
              {/* what you're saving */}
              <div className="mb-3 rounded-[var(--radius-sm)] px-3.5 py-3" style={{ background: "var(--bg-elevated)" }}>
                <div className="flex items-center gap-2">
                  <MapPin size={15} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
                  <span className="truncate text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                    {pending.name}
                  </span>
                </div>
                {pending.sub && (
                  <p className="mt-0.5 truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                    {pending.sub}
                  </p>
                )}
              </div>

              {/* optional one-liner — the assistant reads this */}
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note — “saw on insta, the pizza looked unreal”"
                rows={3}
                className="w-full resize-none px-3.5 py-3 text-[15px] leading-relaxed outline-none"
                style={{
                  color: "var(--text-primary)",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-sm)",
                }}
              />
              <p className="mt-1.5 px-1 text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
                Why you saved it — searchable later, so “pizza” finds this place.
              </p>

              <button
                onClick={() => saveConfirm()}
                className="press mt-3 flex w-full items-center justify-center gap-2 py-3 text-[14.5px] font-bold"
                style={{ background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)", borderRadius: "var(--radius-chip)" }}
              >
                <Check size={16} strokeWidth={2.75} /> Save to watchlist
              </button>
              <button
                onClick={() => saveConfirm(true)}
                className="press mt-2 flex w-full items-center justify-center gap-2 py-3 text-[14.5px] font-semibold"
                style={{ borderRadius: "var(--radius-chip)", border: "1px solid var(--border-strong)", color: "var(--text-primary)" }}
              >
                <CalendarCheck size={16} strokeWidth={2.25} /> I've already been here
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One Google result row — shared by search, link, and nearby modes.
function ResultRow({ r, onPick }: { r: GooglePlace; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="press flex items-start gap-2.5 rounded-[var(--radius-sm)] px-3 py-2.5 text-left"
      style={{ background: "var(--bg-elevated)" }}
    >
      <MapPin size={16} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px]" style={{ color: "var(--text-primary)" }}>
          {r.name}
        </span>
        {r.address && (
          <span className="block truncate text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            {r.address}
          </span>
        )}
      </span>
      <span className="ml-auto shrink-0 self-center font-[family-name:var(--font-mono)] text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
        {r.googleRating != null && (
          <span className="inline-flex items-center gap-0.5" style={{ color: "var(--text-secondary)" }}>
            <Star size={10} fill="currentColor" strokeWidth={0} /> {r.googleRating.toFixed(1)}
          </span>
        )}
        {r.googlePriceLevel != null && <span className="ml-1.5">{priceSigns(r.googlePriceLevel)}</span>}
      </span>
    </button>
  );
}

// One route row on the menu — matches the design: icon tile, title, subtitle,
// chevron. Every tile shares the same dark background and inverts to white
// (icon → dark) on hover/press — the state the screenshot captured on row 1.
function MenuRow({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="press group flex w-full items-center gap-3.5 rounded-[var(--radius)] px-3.5 py-3.5 text-left"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--ink-line)" }}
    >
      <span
        className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-[var(--ink-line)] bg-[var(--bg-raised)] text-[var(--text-secondary)] transition-colors group-hover:border-transparent group-hover:bg-[oklch(0.97_0_0)] group-hover:text-[oklch(0.16_0.006_260)] group-active:border-transparent group-active:bg-[oklch(0.97_0_0)] group-active:text-[oklch(0.16_0.006_260)]"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        <span className="block truncate text-[13px]" style={{ color: "var(--text-tertiary)" }}>
          {sub}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
    </button>
  );
}
