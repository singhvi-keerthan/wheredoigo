"use client";

import Map, { Marker, AttributionControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef } from "react";
import type { Place } from "@/lib/types";
import { displayState } from "@/lib/types";
import { DEFAULT_VIEW } from "@/lib/seed";
import Pin from "./Pin";
import PlaceGlyph from "./PlaceGlyph";

// Keyless light vector style (CARTO positron), retuned to warm ivory/paper.
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const STATE_VAR: Record<string, string> = {
  watchlist: "--s-watchlist",
  visited: "--s-visited",
  favorite: "--s-favorite",
  never_again: "--s-never",
};

// Resolve a CSS custom property to its computed hex (SVG fills can't use var()).
function cssVar(name: string): string {
  if (typeof window === "undefined") return "#ffffff";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#fff";
}

export default function MapView({
  places,
  selectedId,
  onSelect,
}: {
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);

  // Fly to a place when it becomes selected (pin tap or search pick). Bottom
  // padding keeps the pin above the docked sheet.
  useEffect(() => {
    if (!selectedId) return;
    const p = places.find((x) => x.id === selectedId);
    const map = mapRef.current?.getMap();
    if (!p || !map) return;
    map.flyTo({
      center: [p.lng, p.lat],
      zoom: Math.max(map.getZoom(), 14),
      speed: 0.9,
      padding: { top: 0, left: 0, right: 0, bottom: 260 },
    });
  }, [selectedId, places]);

  // Tune the map into a distinct CONTENT PLANE that sits ABOVE the shell in
  // value (land lighter than #0e0f12 shell), with lightened roads and crisp,
  // legible labels. Gives the 3-plane depth the design system requires.
  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    // MapLibre renders the attribution <details> expanded on load — collapse it
    // to a quiet ⓘ (tapping still opens it). Keeps it legally visible, out of
    // the way of the title + the bottom dock.
    const attrib = map.getContainer().querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib");
    if (attrib) {
      attrib.removeAttribute("open");
      attrib.classList.remove("maplibregl-compact-show");
    }
    const ink = "#55565a"; // neutral gray ink labels
    const halo = "rgba(247,247,245,0.95)";
    const LAND = "#f3f3f0"; // neutral off-white (barely warm)
    const WATER = "#dde5e7"; // soft cool water
    const BUILDING = "#e9e9e5";
    const ROAD = "#d4d4ce"; // light neutral streets
    const ROAD_MINOR = "#e6e6e1";

    for (const layer of map.getStyle().layers ?? []) {
      const id = layer.id;
      try {
        if (layer.type === "background") {
          map.setPaintProperty(id, "background-color", LAND);
        } else if (layer.type === "fill") {
          if (/water/i.test(id)) map.setPaintProperty(id, "fill-color", WATER);
          else if (/building/i.test(id)) map.setPaintProperty(id, "fill-color", BUILDING);
          else if (/land|park|wood|grass|cover|use|sand/i.test(id))
            map.setPaintProperty(id, "fill-color", LAND);
        } else if (layer.type === "line") {
          if (/water/i.test(id)) map.setPaintProperty(id, "line-color", WATER);
          else if (/boundary|admin/i.test(id))
            map.setPaintProperty(id, "line-color", "rgba(255,255,255,0.07)");
          else if (/road|transport|street|bridge|tunnel/i.test(id))
            map.setPaintProperty(id, "line-color", /minor|service|path|link/i.test(id) ? ROAD_MINOR : ROAD);
        } else if (layer.type === "symbol") {
          map.setPaintProperty(id, "text-color", ink);
          map.setPaintProperty(id, "text-halo-color", halo);
          map.setPaintProperty(id, "text-halo-width", 1.5);
          map.setPaintProperty(id, "text-halo-blur", 0.1);
        }
      } catch {
        /* layer may lack that paint prop — ignore */
      }
    }
  }, []);

  return (
    <Map
      ref={mapRef}
      initialViewState={DEFAULT_VIEW}
      mapStyle={MAP_STYLE}
      attributionControl={false}
      onLoad={onLoad}
      onClick={() => onSelect(null)}
      style={{ position: "absolute", inset: 0 }}
    >
      {/* Attribution is legally required — park it top-right (the only corner the
          bottom dock doesn't cover). No `compact` prop: explicit compact starts
          EXPANDED, so we let the responsive mode collapse it to a closed ⓘ on
          this narrow (<640px) map. */}
      <AttributionControl position="top-right" />
      {places.map((p, i) => {
        const state = displayState(p);
        const active = p.id === selectedId;
        return (
          <Marker
            key={p.id}
            longitude={p.lng}
            latitude={p.lat}
            anchor="bottom"
            style={{ zIndex: active ? 10 : 1 }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onSelect(p.id);
            }}
          >
            {/* staggered "lights turning on" reveal */}
            <button
              aria-label={p.name}
              className="light-on relative block"
              style={{ animationDelay: `${Math.min(i, 12) * 55 + 150}ms` }}
            >
              <Pin
                name={p.name}
                glyph={<PlaceGlyph place={p} size={17} strokeWidth={2.4} />}
                color={cssVar(STATE_VAR[state])}
                active={active}
              />
            </button>
          </Marker>
        );
      })}
    </Map>
  );
}
