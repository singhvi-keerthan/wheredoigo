"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Search, X, Loader2, Navigation2 } from "lucide-react";
import { usePlaces } from "@/lib/store";
import { displayState, TAG_OPTIONS, type Place } from "@/lib/types";
import { stateMeta } from "@/lib/format";
import { searchPlaces } from "@/lib/places";
import { distanceKm, isAreaResult } from "@/lib/geo";
import { DEFAULT_VIEW } from "@/lib/seed";

// Search across the places you've ALREADY saved — nothing else. Adding lives on
// the + sheet. Two behaviours in one box:
//   • text  → substring match on name / tags / area ("pizza", "date", "toit").
//   • area  → if the query geocodes to a neighbourhood ("jayanagar"), switch to
//             a radius view: saved places within ~2.5km, nearest first.
const CITY = { lat: DEFAULT_VIEW.latitude, lng: DEFAULT_VIEW.longitude };
const RADIUS_KM = 2.5;
const ALL_TAG_VALUES = Object.values(TAG_OPTIONS).flat();

// Records the geocode outcome for one exact query so we neither refetch nor let a
// stale area leak onto a changed query.
type AreaState = { q: string; hit: { name: string; lat: number; lng: number } | null };

export default function CommandPalette({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const places = usePlaces();
  const [q, setQ] = useState("");
  const [area, setArea] = useState<AreaState | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);

  const trimmed = q.trim();
  const ql = trimmed.toLowerCase();

  // Geocode when the query could be an area: long enough and not a controlled
  // tag word ("date", "café"). We deliberately do NOT skip on place-name matches
  // — a place literally named "Jayanagar Bakery" must not suppress the radius
  // view for the neighbourhood "jayanagar".
  const looksLikeTag = ql.length > 0 && ALL_TAG_VALUES.some((v) => v.startsWith(ql));
  const shouldGeo = trimmed.length >= 3 && !looksLikeTag;

  // Debounced geocode. All state writes are deferred into the timeout so the
  // effect body itself never setState (React 19 lint) and stale requests abort.
  useEffect(() => {
    if (!open || !shouldGeo) return;
    const ctrl = new AbortController();
    let active = true;
    const t = setTimeout(async () => {
      if (!active) return;
      setGeoLoading(true);
      const { results } = await searchPlaces(trimmed, CITY, ctrl.signal);
      if (!active || ctrl.signal.aborted) return;
      // Scan for the first neighbourhood-typed result — Google often ranks a POI
      // (e.g. "Jayanagar Metro Station") above the locality itself.
      const top = results.find((r) => isAreaResult(r.googleTypes));
      const hit = top ? { name: top.name, lat: top.lat, lng: top.lng } : null;
      setArea({ q: trimmed, hit });
      setGeoLoading(false);
    }, 450);
    return () => {
      active = false;
      ctrl.abort();
      clearTimeout(t);
    };
  }, [open, trimmed, shouldGeo]);

  if (!open) return null;

  // Reset on every exit — the component stays mounted (parent toggles `open`),
  // so without this the query + stale area results leak into the next open.
  const close = () => {
    setQ("");
    setArea(null);
    onClose();
  };
  const pick = (id: string) => {
    onPick(id);
    close();
  };

  const activeArea = area && area.q === trimmed ? area.hit : null;
  // We intend to geocode this query but haven't resolved it yet — show a
  // "searching" state instead of flashing "No matches".
  const geoPending = shouldGeo && (!area || area.q !== trimmed);

  // Area mode: everything within the radius of the geocoded centroid, nearest
  // first (catches adjacent neighbourhoods, not just an exact name match).
  const near = activeArea
    ? places
        .map((p) => ({ p, d: distanceKm(activeArea, { lat: p.lat, lng: p.lng }) }))
        .filter((x) => x.d <= RADIUS_KM)
        .sort((a, b) => a.d - b.d)
    : [];

  // Text mode: substring across name / area / address / tag values / note — so
  // a one-liner like "saw on insta, pizza looked unreal" is found by "pizza".
  const matches = (p: Place) =>
    p.name.toLowerCase().includes(ql) ||
    !!p.area?.toLowerCase().includes(ql) ||
    p.address.toLowerCase().includes(ql) ||
    p.notes.toLowerCase().includes(ql) ||
    p.tags.some((t) => t.value.toLowerCase().includes(ql));
  const text = trimmed ? places.filter(matches) : places;

  const fmtDist = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

  return (
    <div className="fixed inset-0 z-50" style={{ background: "rgba(6,7,10,0.62)" }} onClick={close}>
      <div
        className="absolute inset-x-0 bottom-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{
          background: "var(--bg-raised)",
          borderTopLeftRadius: "var(--radius-lg)",
          borderTopRightRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          label="Search your places"
          shouldFilter={false}
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="flex flex-col"
        >
          {/* handle + search field */}
          <div className="shrink-0 px-4 pt-2">
            <div className="mx-auto mb-2.5 h-[4px] w-9 rounded-full" style={{ background: "var(--ink-line)" }} />
            <div
              className="flex items-center gap-2.5 px-3.5"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)" }}
            >
              <Search size={16} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
              <Command.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder="Name, tag, or area — “jayanagar”, “date”…"
                className="flex-1 bg-transparent py-3 text-[15px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              {geoLoading && shouldGeo && <Loader2 size={14} className="animate-spin" style={{ color: "var(--text-tertiary)" }} />}
              <button
                onClick={close}
                aria-label="Close"
                className="press grid h-6 w-6 shrink-0 place-items-center rounded-full"
                style={{ background: "var(--bg-raised)", color: "var(--text-tertiary)" }}
              >
                <X size={13} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          <Command.List className="scroll-quiet max-h-[44vh] overflow-y-auto px-3 pb-1 pt-2">
            {activeArea ? (
              <>
                <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--text-tertiary)" }}>
                  <Navigation2 size={11} /> Around {activeArea.name}
                </div>
                {near.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    Nothing saved around {activeArea.name} yet.
                  </p>
                ) : (
                  near.map(({ p, d }) => <Row key={p.id} place={p} right={fmtDist(d)} onPick={pick} />)
                )}
              </>
            ) : text.length === 0 ? (
              <p className="px-2 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                {geoPending
                  ? `Searching “${trimmed}”…`
                  : places.length === 0
                    ? "No saved places yet — add one with +."
                    : "No matches."}
              </p>
            ) : (
              text.map((p) => {
                const meta = stateMeta(p);
                return (
                  <Row
                    key={p.id}
                    place={p}
                    right={displayState(p) === "visited" ? "been" : meta.label.toLowerCase()}
                    onPick={pick}
                  />
                );
              })
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

// One compact result row — a single line: state dot · name · area, with a
// right-aligned label (state, or distance in area mode).
function Row({ place, right, onPick }: { place: Place; right: string; onPick: (id: string) => void }) {
  const meta = stateMeta(place);
  return (
    <Command.Item
      value={place.id}
      onSelect={() => onPick(place.id)}
      className="mb-1 flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2"
      style={{ background: "var(--bg-elevated)" }}
    >
      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: meta.color }} />
      <span className="min-w-0 flex-1 truncate text-[14px]">
        <span style={{ color: "var(--text-primary)" }}>{place.name}</span>
        {place.area && <span style={{ color: "var(--text-tertiary)" }}> · {place.area}</span>}
      </span>
      <span className="shrink-0 text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
        {right}
      </span>
    </Command.Item>
  );
}
