// The share view's data source — SERVER ONLY. Never import this from a client
// component.
//
// wheredoigokeerthan is a link Keerthan sends when someone asks him where to
// go, so /go renders his library to anyone who opens it. Two rules make that
// safe, and both live here rather than in the UI:
//
//   1. The owner is resolved from PUBLIC_OWNER_HASH on the server and never
//      leaves it. That hash is not an identifier — /api/sync and /api/photo
//      both accept it as a bearer for WRITES, so shipping it to a browser
//      would hand every visitor the keys to the library.
//   2. `toPublic()` is an allowlist, built field by field. It deliberately
//      never spreads the stored record, so a private field added to Place
//      later is excluded by default instead of being published by omission.
//
// What the allowlist publishes is exactly what the card (components/PlaceCard)
// renders: name, area, state, your rating, what you spent, tags, hours,
// photos, the reel. What it drops is everything that only ever appeared in the
// detail sheet: your notes, the visit timeline, who you went with, and the
// per-dimension ratings.

import { pullLive, syncConfigured } from "@/lib/sync/db";
import type { Photo, Place } from "@/lib/types";

export const publicOwner: string | null = (() => {
  const raw = process.env.PUBLIC_OWNER_HASH?.trim();
  return raw && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
})();

export const publicConfigured = Boolean(publicOwner && syncConfigured);

export interface PublicLibrary {
  places: Place[];
  // Rendered server-side ("15h ago"). Resolving it in the browser instead would
  // mean the server and the client each stamp a different string on first
  // paint — a hydration mismatch — and the page is force-dynamic anyway, so
  // every visitor gets it computed fresh at request time.
  updatedAgo: string | null;
  // Last write this library received from a connected device — NOT the last
  // time a place was edited. A device with no passphrase never pushes, so an
  // edit made there is invisible here until that device connects.
  updatedAt: string | null;
}

// Photo bytes are never inlined: own photos live in private Blob (no public
// URL at all), and Google photos are stored as base64 in the record, which
// would put megabytes of image data into the page's HTML. Both are addressed
// by id and streamed through /api/go/photo instead.
function publicPhotos(placeId: string, photos: Photo[] | undefined): Photo[] {
  return (photos ?? [])
    .filter((ph) => ph.blobUrl || ph.dataUrl)
    .map((ph) => ({
      id: ph.id,
      dataUrl: `/api/go/photo/${encodeURIComponent(placeId)}/${encodeURIComponent(ph.id)}`,
      source: ph.source,
      // A visit photo is published as a plain place photo: the picture is the
      // point of sharing, the visit it belongs to is not.
      scope: "place",
      visitId: null,
      createdAt: ph.createdAt,
    }));
}

export function toPublic(raw: Place): Place {
  return {
    id: raw.id,
    googlePlaceId: raw.googlePlaceId ?? null,
    name: raw.name,
    address: raw.address ?? "", // the restaurant's address — public, and what search matches on
    area: raw.area,
    city: raw.city,
    lat: raw.lat,
    lng: raw.lng,

    // State: the pin colour, and the whole point of scenario "don't go there".
    status: raw.status,
    favorite: Boolean(raw.favorite),
    neverAgain: Boolean(raw.neverAgain),

    // The numbers that make this worth more than a Google Maps listing.
    myRating: raw.myRating ?? null,
    googleRating: raw.googleRating ?? null,
    myBudgetPerPerson: raw.myBudgetPerPerson ?? null,
    googlePriceLevel: raw.googlePriceLevel ?? null,

    tags: raw.tags ?? [],
    photos: publicPhotos(raw.id, raw.photos),
    openingPeriods: raw.openingPeriods, // hours pill
    googleTypes: raw.googleTypes, // pin glyph fallback
    reelUrl: raw.reelUrl,
    source: raw.source, // "Swiggy reference" vs "ggl", and the attribution
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,

    // ---- withheld ----------------------------------------------------------
    // Blanked rather than omitted so the value stays a valid Place and every
    // card helper keeps working untouched.
    notes: "",
    visits: [],
    enrichedAt: null,
    // `ratings`, `summary` and `hoursText` are optional and simply never set.
  };
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export async function getPublicLibrary(): Promise<PublicLibrary> {
  if (!publicOwner || !syncConfigured) return { places: [], updatedAt: null, updatedAgo: null };
  const rows = await pullLive(publicOwner);
  const updatedAt = rows[0]?.updated_at ?? null; // pullLive orders by updated_at desc
  return {
    places: rows.map((r) => toPublic(r.data as Place)),
    updatedAt,
    updatedAgo: updatedAt ? relativeTime(updatedAt) : null,
  };
}

// The raw (unprojected) record for one place — used only by /api/go/photo to
// resolve photo bytes. Never returned to a browser.
export async function rawPublicPlace(placeId: string): Promise<Place | null> {
  if (!publicOwner || !syncConfigured) return null;
  const rows = await pullLive(publicOwner);
  const hit = rows.find((r) => r.id === placeId);
  return hit ? (hit.data as Place) : null;
}
