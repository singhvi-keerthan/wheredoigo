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
  city: string; // the city itself, from addressComponents ("Bengaluru", "Jaipur")
  lat: number;
  lng: number;
  googleRating: number | null;
  googleReviewCount: number | null; // how many ratings sit behind googleRating
  googlePriceLevel: number | null;
  googleTypes: string[];
  openingPeriods: OpeningPeriod[];
  hoursText: string[];
  summary: string; // Google's one-line editorial summary — the "lowdown"
  photoName: string | null; // first photo resource name (fetched once, on save)
}

// Field masks. `photos` here is just the resource NAME (free with the response);
// the metered Photo media call happens once per saved place via
// /api/places/photo — never on redisplay. addressComponents powers the `area`
// label + area search. `editorialSummary` (the "lowdown") is on the DETAIL mask
// only: the details call runs once per place on save/refresh, so it doesn't
// raise the SKU tier of the high-frequency search typeahead + geocode probes.
// `userRatingCount` sits in the same Enterprise SKU as priceLevel and
// regularOpeningHours (both already on both masks), so it costs no tier change.
export const FIELD_MASK_DETAIL =
  "id,displayName,formattedAddress,addressComponents,location,rating,userRatingCount,priceLevel,types,regularOpeningHours,editorialSummary,photos";
export const FIELD_MASK_SEARCH =
  "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.rating,places.userRatingCount,places.priceLevel,places.types,places.regularOpeningHours,places.photos";

// The address-component types that best name a "neighbourhood", best-first. For
// Bengaluru, sublocality_level_1 is the Jayanagar/Koramangala granularity. No
// `locality` fallback on purpose — that would surface the whole city ("Bengaluru")
// as the neighbourhood; better to leave area blank than mislabel it.
const AREA_COMPONENT_TYPES = ["sublocality_level_1", "sublocality", "neighborhood"];

// The city, kept SEPARATE from `area` on purpose. `locality` is deliberately
// absent from the list above — as a neighbourhood label it would say
// "Bengaluru", which is useless. As a city label it is exactly right, and it is
// what lets the app stop claiming every pin is in one city.
const CITY_COMPONENT_TYPES = ["locality", "postal_town", "administrative_area_level_2"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function pickComponent(components: any[], wanted: string[]): string {
  if (!Array.isArray(components)) return "";
  for (const t of wanted) {
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
    area: pickComponent(p.addressComponents, AREA_COMPONENT_TYPES),
    city: pickComponent(p.addressComponents, CITY_COMPONENT_TYPES),
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    googleRating: typeof p.rating === "number" ? p.rating : null,
    googleReviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
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
    summary: typeof p.editorialSummary?.text === "string" ? p.editorialSummary.text : "",
    photoName: typeof p.photos?.[0]?.name === "string" ? p.photos[0].name : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
