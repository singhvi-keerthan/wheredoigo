// Server-only helpers for the Google Places API (New). Imported by route
// handlers in app/api/places/*. The API key never leaves the server.
import type { OpeningPeriod } from "./types";

const PRICE_LEVEL: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

// The flat shape both routes return and the client maps onto a Place.
export interface GooglePlace {
  placeId: string;
  name: string;
  address: string;
  area: string; // neighbourhood / locality, from addressComponents ("Jayanagar")
  lat: number;
  lng: number;
  googleRating: number | null;
  googlePriceLevel: number | null;
  googleTypes: string[];
  openingPeriods: OpeningPeriod[];
  hoursText: string[];
  photoName: string | null; // first photo resource name (fetched once, on save)
}

// Field mask shared by search + details. `photos` here is just the resource
// NAME (free with the response); the metered Photo media call happens once per
// saved place via /api/places/photo — never on redisplay.
// addressComponents powers the `area` label + area search.
export const FIELD_MASK_DETAIL =
  "id,displayName,formattedAddress,addressComponents,location,rating,priceLevel,types,regularOpeningHours,photos";
export const FIELD_MASK_SEARCH =
  "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.rating,places.priceLevel,places.types,places.regularOpeningHours,places.photos";

// The address-component types that best name a "neighbourhood", best-first. For
// Bengaluru, sublocality_level_1 is the Jayanagar/Koramangala granularity. No
// `locality` fallback on purpose — that would surface the whole city ("Bengaluru")
// as the neighbourhood; better to leave area blank than mislabel it.
const AREA_COMPONENT_TYPES = ["sublocality_level_1", "sublocality", "neighborhood"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function pickArea(components: any[]): string {
  if (!Array.isArray(components)) return "";
  for (const t of AREA_COMPONENT_TYPES) {
    const c = components.find((comp) => comp?.types?.includes(t));
    const label = c?.longText ?? c?.shortText;
    if (label) return label; // skip to the next type if this component has no text
  }
  return "";
}

export function mapGooglePlace(p: any): GooglePlace {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    area: pickArea(p.addressComponents),
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    googleRating: typeof p.rating === "number" ? p.rating : null,
    googlePriceLevel:
      p.priceLevel != null && p.priceLevel in PRICE_LEVEL
        ? PRICE_LEVEL[p.priceLevel]
        : null,
    googleTypes: Array.isArray(p.types) ? p.types : [],
    openingPeriods: Array.isArray(p.regularOpeningHours?.periods)
      ? p.regularOpeningHours.periods.map((per: any) => ({
          open: {
            day: per.open?.day ?? 0,
            hour: per.open?.hour ?? 0,
            minute: per.open?.minute ?? 0,
          },
          ...(per.close
            ? {
                close: {
                  day: per.close.day ?? 0,
                  hour: per.close.hour ?? 0,
                  minute: per.close.minute ?? 0,
                },
              }
            : {}),
        }))
      : [],
    hoursText: Array.isArray(p.regularOpeningHours?.weekdayDescriptions)
      ? p.regularOpeningHours.weekdayDescriptions
      : [],
    photoName: typeof p.photos?.[0]?.name === "string" ? p.photos[0].name : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
