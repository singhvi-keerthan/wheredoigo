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
  lat: number;
  lng: number;
  googleRating: number | null;
  googlePriceLevel: number | null;
  googleTypes: string[];
  openingPeriods: OpeningPeriod[];
  hoursText: string[];
}

// Field mask shared by search + details. No `photos` field on purpose —
// the Photos SKU is the tightest free bucket; we enrich text/rating/hours only.
export const FIELD_MASK_DETAIL =
  "id,displayName,formattedAddress,location,rating,priceLevel,types,regularOpeningHours";
export const FIELD_MASK_SEARCH =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.types,places.regularOpeningHours";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapGooglePlace(p: any): GooglePlace {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
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
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
