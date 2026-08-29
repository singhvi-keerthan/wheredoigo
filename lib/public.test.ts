import { describe, expect, it } from "vitest";
import { toPublic } from "./public";
import type { Place } from "./types";

function mk(over: Partial<Place> = {}): Place {
  return {
    id: "p1",
    googlePlaceId: null,
    name: "Place",
    address: "",
    area: "Ashok Nagar",
    lat: 12.97,
    lng: 77.6,
    status: "watchlist",
    favorite: false,
    neverAgain: false,
    myRating: null,
    googleRating: null,
    myBudgetPerPerson: null,
    googlePriceLevel: null,
    notes: "private",
    tags: [],
    photos: [],
    visits: [],
    source: "swiggy",
    enrichedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("toPublic", () => {
  it("preserves approximate-location state for shared cards", () => {
    expect(toPublic(mk({ approxLocation: true })).approxLocation).toBe(true);
  });
});
