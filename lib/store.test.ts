import { describe, it, expect } from "vitest";
import { findDuplicate } from "./store";
import type { Place } from "./types";

function mk(over: Partial<Place>): Place {
  return {
    id: "p1",
    googlePlaceId: null,
    name: "Blue Tokai Coffee Roasters",
    address: "",
    lat: 12.9716,
    lng: 77.6411,
    status: "watchlist",
    favorite: false,
    neverAgain: false,
    myRating: null,
    googleRating: null,
    myBudgetPerPerson: null,
    googlePriceLevel: null,
    notes: "",
    tags: [],
    photos: [],
    visits: [],
    source: "search",
    enrichedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("findDuplicate", () => {
  it("matches an exact googlePlaceId anywhere", () => {
    const list = [mk({ googlePlaceId: "gid-1", lat: 12.9, lng: 77.5 })];
    const dup = findDuplicate({ googlePlaceId: "gid-1", name: "x", lat: 13.1, lng: 77.7 }, list);
    expect(dup?.id).toBe("p1");
  });

  it("does NOT treat a second chain outlet (same name, different place id) as a dupe", () => {
    const list = [mk({ googlePlaceId: "gid-indiranagar" })];
    // Same brand name, different Google id, ~5km away (Koramangala outlet).
    const far = findDuplicate(
      { googlePlaceId: "gid-koramangala", name: "Blue Tokai Coffee Roasters", lat: 12.9341, lng: 77.6253 },
      list
    );
    expect(far).toBeNull();
    // Even side by side: distinct Google ids are distinct places.
    const near = findDuplicate(
      { googlePlaceId: "gid-koramangala", name: "Blue Tokai Coffee Roasters", lat: 12.9717, lng: 77.6412 },
      list
    );
    expect(near).toBeNull();
  });

  it("requires proximity for fuzzy name matches", () => {
    const list = [mk({})];
    const far = findDuplicate({ name: "Blue Tokai Coffee Roasters", lat: 12.9341, lng: 77.6253 }, list);
    expect(far).toBeNull();
    const near = findDuplicate({ name: "Blue Tokai Coffee Roasters", lat: 12.9717, lng: 77.6412 }, list);
    expect(near?.id).toBe("p1");
  });

  it("fuzzy-matches a close-by name prefix (manual pin vs saved place)", () => {
    const list = [mk({})];
    const dup = findDuplicate({ name: "Blue Tokai", lat: 12.9716, lng: 77.6411 }, list);
    expect(dup?.id).toBe("p1");
  });
});
