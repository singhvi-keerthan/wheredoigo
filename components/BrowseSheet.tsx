"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, ChevronRight, Star, MapPin, Images, Navigation } from "lucide-react";
import { usePlaces } from "@/lib/store";
import { NAMESPACE_LABELS, type Place, type TagNamespace } from "@/lib/types";
import { coverPhoto, photosSorted, leadRating, stateMeta, hoursPill, directionsUrl } from "@/lib/format";
import PlaceGlyph from "./PlaceGlyph";

// The browse layer — reached from the menu, laid over the map. Four ways into
// the same library that the map+search don't give you: a photo-first Gallery to
// decide by sight, and grouped lists by Cuisine, Staple, and Area. Read-only
// discovery; tapping anything hands the place back to the map (select + open).
export type BrowseMode = "gallery" | "cuisine" | "staple" | "area";

const TITLES: Record<BrowseMode, string> = {
  gallery: "Gallery",
  cuisine: "By cuisine",
  staple: "Staples",
  area: "By area",
};

type Group = { value: string; places: Place[] };

// Places grouped by every value they carry in one tag namespace (a place shows
// under each of its cuisines/staples). Biggest groups first, then alphabetical.
function tagGroups(places: Place[], ns: TagNamespace): Group[] {
  const map = new Map<string, Place[]>();
  for (const p of places) {
    for (const t of p.tags) {
      if (t.namespace !== ns) continue;
      const arr = map.get(t.value) ?? [];
      arr.push(p);
      map.set(t.value, arr);
    }
  }
  return groupsFrom(map);
}

function areaGroups(places: Place[]): Group[] {
  const map = new Map<string, Place[]>();
  for (const p of places) {
    const a = p.area?.trim();
    if (!a) continue;
    const arr = map.get(a) ?? [];
    arr.push(p);
    map.set(a, arr);
  }
  return groupsFrom(map);
}

function groupsFrom(map: Map<string, Place[]>): Group[] {
  return [...map.entries()]
    .map(([value, places]) => ({ value, places }))
    .sort((a, b) => b.places.length - a.places.length || a.value.localeCompare(b.value));
}

type GalleryItem = { key: string; dataUrl: string; place: Place };

export default function BrowseSheet({
  mode,
  onClose,
  onPick,
}: {
  mode: BrowseMode;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const places = usePlaces();
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && lightbox === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, lightbox]);

  const gallery: GalleryItem[] =
    mode === "gallery"
      ? places.flatMap((p) => photosSorted(p).map((ph) => ({ key: ph.id, dataUrl: ph.dataUrl, place: p })))
      : [];

  const groups =
    mode === "cuisine" ? tagGroups(places, "cuisine")
    : mode === "staple" ? tagGroups(places, "staple")
    : mode === "area" ? areaGroups(places)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--sheet)" }}>
      {/* header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]"
        style={{ background: "var(--sheet)", borderBottom: "1px solid var(--ink-line)" }}
      >
        <button
          onClick={onClose}
          aria-label="Back"
          className="press grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)" }}
        >
          <ArrowLeft size={16} strokeWidth={2.25} />
        </button>
        <h1
          className="flex-1 text-[22px] font-medium leading-none tracking-[-0.01em]"
          style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
        >
          {TITLES[mode]}
        </h1>
        <button
          onClick={onClose}
          aria-label="Close"
          className="press grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
        >
          <X size={15} strokeWidth={2.25} />
        </button>
      </header>

      <div className="scroll-quiet flex-1 overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
        {mode === "gallery" ? (
          gallery.length === 0 ? (
            <Empty
              icon={<Images size={22} style={{ color: "var(--accent)" }} />}
              title="No photos yet"
              sub="Add your own shots to any place — every one lands here, so you can decide by sight."
            />
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {gallery.map((it, i) => (
                <button
                  key={it.key}
                  onClick={() => setLightbox(i)}
                  className="press group relative aspect-square overflow-hidden"
                  style={{ borderRadius: "var(--radius-sm)", background: "var(--bg-elevated)" }}
                >
                  <img src={it.dataUrl} alt="" className="h-full w-full object-cover" />
                  <span
                    className="pointer-events-none absolute inset-x-0 bottom-0 truncate px-1.5 py-1 text-left text-[10.5px] font-semibold"
                    style={{
                      color: "#fff",
                      background: "linear-gradient(0deg, rgba(6,7,10,0.8), transparent)",
                    }}
                  >
                    {it.place.name}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : groups.length === 0 ? (
          <Empty
            icon={<MapPin size={22} style={{ color: "var(--accent)" }} />}
            title="Nothing here yet"
            sub={
              mode === "area"
                ? "Places you add from Google carry their neighbourhood — they'll group here."
                : `Tag your places with a ${mode} and they'll group here.`
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.value}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-[15px] font-semibold capitalize tracking-[-0.01em]" style={{ color: "var(--text-primary)" }}>
                    {g.value}
                  </h2>
                  <span className="font-[family-name:var(--font-mono)] text-[12px]" style={{ color: "var(--text-tertiary)" }}>
                    {g.places.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {g.places.map((p) => (
                    <PlaceRow key={p.id} place={p} onPick={onPick} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {lightbox !== null && (
        <GalleryLightbox
          items={gallery}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
          onOpenPlace={(id) => {
            setLightbox(null);
            onPick(id);
          }}
        />
      )}
    </div>
  );
}

// One place in a grouped list — cover photo (or type glyph), name, area, rating.
function PlaceRow({ place, onPick }: { place: Place; onPick: (id: string) => void }) {
  const cover = coverPhoto(place);
  const rating = leadRating(place);
  const meta = stateMeta(place);
  const hours = hoursPill(place);
  return (
    <button
      onClick={() => onPick(place.id)}
      className="press flex items-center gap-3 text-left"
      style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", padding: 8 }}
    >
      <div
        className="relative grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden"
        style={{ borderRadius: "var(--radius-sm)", background: "var(--bg-raised)" }}
      >
        {cover ? (
          <img src={cover.dataUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <PlaceGlyph place={place} size={22} strokeWidth={1.9} style={{ color: "var(--text-tertiary)" }} />
        )}
        <span className="absolute left-1 top-1 h-2 w-2 rounded-[2px]" style={{ background: meta.color, boxShadow: "0 0 0 1.5px var(--bg-raised)" }} />
      </div>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[16px] leading-tight"
          style={{ fontFamily: "var(--font-serif)", color: "var(--text-primary)" }}
        >
          {place.name}
        </span>
        <span className="mt-0.5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
          {place.area && (
            <span className="inline-flex items-center gap-1 truncate">
              <MapPin size={10} strokeWidth={2} />
              {place.area}
            </span>
          )}
          {rating.value != null && (
            <span className="inline-flex items-center gap-0.5" style={{ color: rating.mine ? "var(--star)" : "var(--text-secondary)" }}>
              <Star size={10} strokeWidth={0} fill="currentColor" />
              {rating.value.toFixed(1)}
            </span>
          )}
          {hours && <span style={{ color: hours.color }}>{hours.label}</span>}
        </span>
      </span>
      <ChevronRight size={17} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
    </button>
  );
}

// Cross-place lightbox — swipe every gallery photo (native scroll-snap), the
// place named on each frame with a jump-to-place action. This is the "swipe
// through and decide" loop. Portalled to <body> so `fixed` escapes the sheet.
function GalleryLightbox({
  items,
  startIndex,
  onClose,
  onOpenPlace,
}: {
  items: GalleryItem[];
  startIndex: number;
  onClose: () => void;
  onOpenPlace: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(() => Math.min(startIndex, Math.max(0, items.length - 1)));

  useEffect(() => {
    const el = trackRef.current;
    if (el) el.scrollLeft = index * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;
  const current = items[Math.min(index, items.length - 1)];

  return createPortal(
    <div className="fixed inset-0 z-[70]" style={{ background: "rgba(6,7,10,0.97)" }}>
      <div
        ref={trackRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="scroll-quiet flex h-full w-full snap-x snap-mandatory overflow-x-auto"
      >
        {items.map((it) => (
          <div key={it.key} className="grid h-full w-full shrink-0 snap-center place-items-center px-2" onClick={onClose}>
            <img src={it.dataUrl} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
        ))}
      </div>

      {/* top bar — close + counter */}
      <div className="pointer-events-none fixed inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <button
          onClick={onClose}
          aria-label="Close"
          className="press pointer-events-auto grid h-9 w-9 place-items-center rounded-full"
          style={{ background: "rgba(255,255,255,0.14)", color: "#fff" }}
        >
          <X size={16} strokeWidth={2.25} />
        </button>
        {items.length > 1 && (
          <span className="font-[family-name:var(--font-mono)] text-[12px]" style={{ color: "rgba(255,255,255,0.7)" }}>
            {index + 1}/{items.length}
          </span>
        )}
        <span className="h-9 w-9" />
      </div>

      {/* bottom bar — which place this is + jump to it */}
      <div className="fixed inset-x-0 bottom-0 flex items-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-8" style={{ background: "linear-gradient(0deg, rgba(6,7,10,0.9), transparent)" }}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[19px] leading-tight" style={{ fontFamily: "var(--font-serif)", color: "#fff" }}>
            {current.place.name}
          </span>
          {current.place.area && (
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.6)" }}>{current.place.area}</span>
          )}
        </span>
        <button
          onClick={() => onOpenPlace(current.place.id)}
          className="press flex shrink-0 items-center gap-1.5 px-4 py-2.5 text-[13.5px] font-bold"
          style={{ borderRadius: "var(--radius-chip)", background: "oklch(0.97 0 0)", color: "oklch(0.16 0.006 260)" }}
        >
          <Navigation size={14} strokeWidth={2.5} fill="currentColor" /> Take me there
        </button>
      </div>
    </div>,
    document.body
  );
}

function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="grid place-items-center px-8 pt-[22vh] text-center">
      <div className="flex max-w-[300px] flex-col items-center">
        {icon}
        <p className="mt-3 text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        <p className="mt-1 text-[13px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
          {sub}
        </p>
      </div>
    </div>
  );
}
