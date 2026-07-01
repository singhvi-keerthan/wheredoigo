"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Search, MapPin, Plus, Navigation2, Star, Loader2 } from "lucide-react";
import { usePlaces, addPlace, findDuplicate } from "@/lib/store";
import { displayState } from "@/lib/types";
import { stateMeta, priceSigns } from "@/lib/format";
import { parseLocation, isUrl } from "@/lib/capture";
import { searchPlaces, type GooglePlace } from "@/lib/places";
import { DEFAULT_VIEW } from "@/lib/seed";

// The one primary surface: search your places, paste a Maps link/coords to pin,
// or add a place manually. Full Google search/enrich lands when the API key does.
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
  const [gResults, setGResults] = useState<GooglePlace[]>([]);
  const [gLoading, setGLoading] = useState(false);

  const query = q.trim();
  const coords = query ? parseLocation(query) : null;
  const label = isUrl(query) ? "Pinned location" : query;
  const textSearch = open && !!query && query.length >= 2 && !coords && !isUrl(query);

  // Live Google text search (debounced). Biased to the map's home city. All
  // state writes happen in deferred callbacks; render gates on `textSearch` so
  // stale results never show once the query stops being a text search.
  useEffect(() => {
    if (!textSearch) return;
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
  }, [query, textSearch]);

  if (!open) return null;

  const pick = (id: string) => {
    onPick(id);
    setQ("");
    onClose();
  };

  const addAt = (lat: number, lng: number, name: string, source: "paste" | "manual") => {
    const dup = findDuplicate({ name, lat, lng });
    if (dup) return pick(dup.id);
    const p = addPlace({
      googlePlaceId: null,
      name: name || "New place",
      address: "",
      lat,
      lng,
      status: "watchlist",
      myRating: null,
      googleRating: null,
      myBudgetPerPerson: null,
      googlePriceLevel: null,
      notes: "",
      tags: [],
      source,
      enrichedAt: null,
    });
    pick(p.id);
  };

  // Add a real Google result — coordinates + rating/price/hours come for free.
  const addGoogle = (r: GooglePlace) => {
    const dup = findDuplicate({ googlePlaceId: r.placeId, name: r.name, lat: r.lat, lng: r.lng });
    if (dup) return pick(dup.id);
    const p = addPlace({
      googlePlaceId: r.placeId,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      status: "watchlist",
      myRating: null,
      googleRating: r.googleRating,
      myBudgetPerPerson: null,
      googlePriceLevel: r.googlePriceLevel,
      notes: "",
      tags: [],
      googleTypes: r.googleTypes,
      openingPeriods: r.openingPeriods,
      hoursText: r.hoursText,
      source: "search",
      enrichedAt: new Date().toISOString(),
    });
    pick(p.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[max(4rem,12vh)]"
      style={{ background: "rgba(10,8,12,0.64)" }}
      onClick={onClose}
    >
      <div
        className="animate-rise w-full max-w-lg overflow-hidden"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Search or add a place" shouldFilter onKeyDown={(e) => e.key === "Escape" && onClose()}>
          <div
            className="flex items-center gap-2.5 px-4"
            style={{ borderBottom: "1px solid var(--ink-line)" }}
          >
            <Search size={17} strokeWidth={2.25} style={{ color: "var(--accent)" }} />
            <Command.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="Search your places, paste a link, or add…"
              className="flex-1 bg-transparent py-3.5 text-[14.5px] outline-none"
              style={{ color: "var(--text-primary)" }}
            />
          </div>

          <Command.List className="scroll-quiet max-h-[50vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-[13px]" style={{ color: "var(--text-tertiary)" }}>
              {gLoading ? "Searching Google…" : "No matches — add it below."}
            </Command.Empty>

            {places.length > 0 && (
              <Command.Group
                heading="Your places"
                className="px-1 text-[11px] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[var(--text-tertiary)]"
              >
                {places.map((p) => {
                  const meta = stateMeta(p);
                  return (
                    <Command.Item
                      key={p.id}
                      value={`${p.name} ${p.tags.map((t) => t.value).join(" ")}`}
                      onSelect={() => pick(p.id)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: meta.color }} />
                      <span className="flex-1 truncate text-[14px]" style={{ color: "var(--text-primary)" }}>
                        {p.name}
                      </span>
                      <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                        {displayState(p) === "visited" ? "been" : meta.label.toLowerCase()}
                      </span>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            {coords && (
              <Command.Group className="mt-1 px-1">
                <Command.Item
                  value={`__pin ${q}`}
                  onSelect={() => addAt(coords.lat, coords.lng, label, "paste")}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2"
                >
                  <Navigation2 size={15} style={{ color: "var(--accent)" }} />
                  <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
                    Pin this location
                  </span>
                  <span className="ml-auto font-[family-name:var(--font-mono)] text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                    {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                  </span>
                </Command.Item>
              </Command.Group>
            )}

            {textSearch && gResults.length > 0 && (
              <Command.Group
                heading="From Google"
                className="mt-1 px-1 text-[11px] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[var(--text-tertiary)]"
              >
                {gResults.map((r) => (
                  <Command.Item
                    key={r.placeId}
                    value={`__g ${q} ${r.name}`}
                    onSelect={() => addGoogle(r)}
                    className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2"
                  >
                    <MapPin size={15} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]" style={{ color: "var(--text-primary)" }}>
                        {r.name}
                      </span>
                      {r.address && (
                        <span className="block truncate text-[11.5px]" style={{ color: "var(--text-tertiary)" }}>
                          {r.address}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 self-center font-[family-name:var(--font-mono)] text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {r.googleRating != null && (
                        <span className="inline-flex items-center gap-0.5" style={{ color: "var(--text-secondary)" }}>
                          <Star size={10} fill="currentColor" strokeWidth={0} /> {r.googleRating.toFixed(1)}
                        </span>
                      )}
                      {r.googlePriceLevel != null && <span className="ml-1.5">{priceSigns(r.googlePriceLevel)}</span>}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {textSearch && (
              <Command.Group className="mt-1 px-1">
                {gLoading && gResults.length === 0 && (
                  <div className="flex items-center gap-2 px-2.5 py-2 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                    <Loader2 size={14} className="animate-spin" /> Searching Google…
                  </div>
                )}
                <Command.Item
                  value={`__add ${q}`}
                  onSelect={() => addAt(DEFAULT_VIEW.latitude, DEFAULT_VIEW.longitude, query, "manual")}
                  className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2"
                >
                  <Plus size={15} style={{ color: "var(--accent)" }} />
                  <span className="text-[14px]" style={{ color: "var(--text-primary)" }}>
                    Add “{query}” manually
                  </span>
                  <MapPin size={13} className="ml-auto" style={{ color: "var(--text-tertiary)" }} />
                </Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
