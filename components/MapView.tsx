"use client";

import Map, { Marker, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/types";
import { displayState } from "@/lib/types";
import { DEFAULT_VIEW } from "@/lib/seed";
import { cityOf } from "@/lib/city";
import { noteGpsFix, noteMapCenter, onGeoGranted } from "@/lib/bias";
import Pin, { type PinVariant } from "./Pin";
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

// The places in whichever city has the most of them — the shared view's
// opening frame. Ties keep the first city seen, which is stable because the
// records arrive in a fixed order.
function largestCity(places: Place[]): Place[] {
  // A plain record, not a Map — `Map` is react-map-gl's component in this file.
  const byCity: Record<string, Place[]> = {};
  for (const p of places) {
    const key = cityOf(p) || "?";
    (byCity[key] ??= []).push(p);
  }
  let best: Place[] = [];
  for (const group of Object.values(byCity)) if (group.length > best.length) best = group;
  return best.length ? best : places;
}

// Zoom → pin detail. The 40px label-sticker pins collide into soup on a
// city-wide view once the map grows, so pins degrade: name cards up close,
// glyph discs at mid zoom, dots city-wide — always, regardless of how many
// places are on the map (even two overlapping label-stickers read as clutter).
// The map opens on you at neighbourhood zoom — close enough to read the street
// you are standing on, not so close that nothing else is on screen.
const ME_ZOOM = 14;
// How long the saved-places fit waits for a location fix before giving up and
// taking the view itself. Long enough for a warm fix, short enough that a denied
// or absent one is not a visible stall.
const LOCATION_GRACE_MS = 1800;

function bandFor(zoom: number): PinVariant {
  return zoom >= 13.5 ? "full" : zoom >= 12 ? "disc" : "dot";
}

export default function MapView({
  places,
  selectedId,
  onSelect,
  shared = false,
}: {
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // The /go share view renders this same map for someone who is not Keerthan.
  // Two things have to change for them and nothing else: the map opens on the
  // PLACES rather than on the viewer (a friend across town would otherwise get
  // their own empty neighbourhood and never see a pin), and the "you are here"
  // marker drops the avatar, because that face is his.
  shared?: boolean;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const [band, setBand] = useState<PinVariant>(() => bandFor(DEFAULT_VIEW.zoom));
  const [ready, setReady] = useState(false);

  // Live "you are here": watch the GPS fix and drop the avatar marker at it.
  // Startup DOES ask for location, deliberately: the avatar is a first-class
  // part of this screen and the map opens on your position, so there is nothing
  // to defer the question for. (An earlier revision gated the watch on an
  // already-granted permission to avoid a startup prompt — that silently
  // removed the marker for anyone who had never been asked.) Only an outright
  // denial stops the watch; the location is used to draw you, never stored.
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;

    let cancelled = false;
    let permission: PermissionStatus | null = null;
    let watchId: number | null = null;

    const clearWatch = () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      setMe(null);
      noteGpsFix(null);
    };

    const startWatch = () => {
      if (watchId != null) return;
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setMe(c);
          noteGpsFix(c); // doubles as the search bias — see lib/bias.ts
        },
        (err) => {
          // A geolocation watch is NOT cancelled by an error — the browser
          // keeps trying. Tearing it down here (what this did) turned one
          // routine indoor TIMEOUT into "no avatar until reload", because
          // nothing restarts it: syncPermission only re-runs on
          // permission.onchange, which a timeout never fires. Only a denial is
          // permanent; a timeout or an unavailable fix is a bad moment, not a
          // bad session. Drop the stale marker either way — a "you are here"
          // pin we can no longer confirm is worse than none.
          if (err.code === err.PERMISSION_DENIED) {
            clearWatch();
            return;
          }
          setMe(null);
          noteGpsFix(null);
        },
        { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 }
      );
    };

    // "Pin where I am" succeeding proves permission exists, in this session, on
    // any browser. Safe to register unconditionally: where the Permissions API
    // works, onchange gets there first and startWatch is idempotent.
    const offGrant = onGeoGranted(() => {
      if (!cancelled) startWatch();
    });

    const syncPermission = () => {
      if (cancelled || !permission) return;
      // "prompt" starts the watch too — that IS the ask. Only a denial is a no.
      if (permission.state === "denied") clearWatch();
      else startWatch();
    };

    // No Permissions API (Safari) — we cannot ask what the state is, so we ask
    // the browser directly. It shows its own prompt once and remembers.
    const withoutPermissionsApi = () => startWatch();

    if (!("permissions" in navigator)) {
      withoutPermissionsApi();
      return;
    }

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (cancelled) return;
        permission = status;
        permission.onchange = syncPermission;
        syncPermission();
      })
      // Safari HAS navigator.permissions but rejects the geolocation name, so
      // this catch — not the branch above — is the live path there.
      .catch(() => {
        if (!cancelled) withoutPermissionsApi();
      });

    return () => {
      cancelled = true;
      if (permission) permission.onchange = null;
      offGrant();
      clearWatch();
    };
  }, []);

  // ---- where the map opens -------------------------------------------------
  // Your own location first: that is the view you want when the app comes up.
  // The saved-places fit is the FALLBACK — for location denied, unavailable, or
  // simply slow — and DEFAULT_VIEW is the last resort behind both. Whichever
  // resolves first wins, and only once.
  const viewSet = useRef(false);

  // 1. Your location, the moment there is a fix. Never on the shared view —
  //    there, the places ARE the subject and the viewer is incidental.
  useEffect(() => {
    if (shared || viewSet.current || !ready || !me) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    viewSet.current = true;
    map.jumpTo({ center: [me.lng, me.lat], zoom: ME_ZOOM });
    setBand(bandFor(ME_ZOOM));
  }, [ready, me, shared]);

  // 2. Fallback: fit the saved places — but give the fix a moment to land
  //    first. Records hydrate from localStorage instantly while a GPS fix takes
  //    seconds, so fitting the moment they arrive would beat location to the
  //    view every single time and you would never open on yourself.
  useEffect(() => {
    if (viewSet.current || !ready || !places.length) return;
    const t = window.setTimeout(() => {
      if (viewSet.current) return; // a fix landed inside the grace window
      const map = mapRef.current?.getMap();
      if (!map) return;
      // mapGooglePlace falls back to `lat: 0, lng: 0` when Google returns no
      // location, so a single such record drags the bounds to Null Island and
      // opens the map on the Atlantic. Fit to the places that actually have a
      // position — and if none do, leave the view unset so the next set of
      // records still gets its chance instead of being locked out forever.
      const locatable = places.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)
      );
      if (!locatable.length) return;
      viewSet.current = true;
      // Fit the biggest CITY, not every pin. Fitting all of them is right for
      // one city and useless across several: a library spanning Bengaluru,
      // Mumbai and Jaipur frames the whole subcontinent, and the share link
      // opens on four grey dots and an ocean. The city with the most places is
      // the one the map is about; the rest are a pan away.
      const fit = shared ? largestCity(locatable) : locatable;
      const lngs = fit.map((p) => p.lng);
      const lats = fit.map((p) => p.lat);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        // Bottom padding clears the docked controls; maxZoom stops a single pin
        // (or a tight cluster) from slamming the camera into the pavement.
        { padding: { top: 96, bottom: 240, left: 48, right: 48 }, maxZoom: 14, duration: 0 }
      );
      setBand(bandFor(map.getZoom()));
    }, shared ? 0 : LOCATION_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [ready, places, shared]);

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
    setReady(true);

    const ink = "#55565a"; // neutral gray ink labels
    const halo = "rgba(247,247,245,0.95)";
    // Neutral off-white (barely warm). Read from the token rather than written
    // here, because the same value paints the canvas behind a standalone PWA's
    // viewport — see --map-land. Two copies of a colour is one colour and one bug.
    const LAND = cssVar("--map-land") || "#f3f3f0";
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
      onZoom={(e) => {
        const b = bandFor(e.viewState.zoom);
        setBand((prev) => (prev === b ? prev : b)); // no re-render unless the band flips
      }}
      // Zoom goes with the centre: lib/bias.ts drops views too wide to mean
      // anything, which is what stops a two-city fit becoming the search bias.
      onMoveEnd={(e) =>
        noteMapCenter(
          { lat: e.viewState.latitude, lng: e.viewState.longitude },
          e.viewState.zoom
        )
      }
      // Touch the map yourself and you own the view: a fix landing a second
      // later must not yank the camera out from under your thumb.
      onDragStart={() => {
        viewSet.current = true;
      }}
      onClick={() => onSelect(null)}
      style={{ position: "absolute", inset: 0 }}
    >
      {places.map((p, i) => {
        const state = displayState(p);
        const active = p.id === selectedId;
        const variant: PinVariant = active ? "full" : band;
        return (
          <Marker
            key={p.id}
            longitude={p.lng}
            latitude={p.lat}
            anchor={variant === "full" ? "bottom" : "center"}
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
                variant={variant}
              />
            </button>
          </Marker>
        );
      })}

      {/* live "you are here" — the avatar at my current GPS fix. Sits above the
          place pins but below a selected one; never intercepts map gestures. */}
      {me && (
        <Marker longitude={me.lng} latitude={me.lat} anchor="bottom" style={{ zIndex: 5, pointerEvents: "none" }}>
          <div className="me-marker light-on" aria-label="You are here">
            <span className="me-pulse" />
            <span className="me-shadow" />
            {shared ? (
              <span
                className="block rounded-full"
                style={{ width: 16, height: 16, background: "#2b6df6", border: "2.5px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.35)" }}
              />
            ) : (
              <img src="/me.png" alt="" className="me-avatar" draggable={false} />
            )}
          </div>
        </Marker>
      )}
    </Map>
  );
}
