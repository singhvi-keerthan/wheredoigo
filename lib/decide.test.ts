import { describe, it, expect } from "vitest";
import { rankPlaces } from "./decide";
import type { Place } from "./types";

let n = 0;
function mk(over: Partial<Place>): Place {
  n++;
  return {
    id: `p${n}`,
    googlePlaceId: null,
    name: `Place ${n}`,
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

const ids = (r: ReturnType<typeof rankPlaces>) => r.map((x) => x.place.id);

describe("rankPlaces", () => {
  it("never surfaces a never_again place", () => {
    const out = rankPlaces([mk({ neverAgain: true })], {}, 1);
    expect(out).toHaveLength(0);
  });

  it("hard-drops excluded tag values", () => {
    const bar = mk({ tags: [{ namespace: "type", value: "bar" }] });
    const cafe = mk({ tags: [{ namespace: "type", value: "café" }] });
    const out = rankPlaces([bar, cafe], { excludeTypes: ["bar"] }, 1);
    expect(ids(out)).toEqual([cafe.id]);
  });

  it("applies the budget cap via Google price level when your spend is unknown", () => {
    const pricey = mk({ googlePriceLevel: 4 }); // est ₹2500
    const cheap = mk({ googlePriceLevel: 2 }); // est ₹800
    const out = rankPlaces([pricey, cheap], { maxBudget: 1500 }, 1);
    expect(ids(out)).toEqual([cheap.id]);
  });

  it("prefers your logged spend over the price-level estimate", () => {
    // Level says ₹2500 but you actually spend ₹900 → passes a ₹1500 cap.
    const p = mk({ status: "visited", googlePriceLevel: 4, myBudgetPerPerson: 900 });
    const out = rankPlaces([p], { maxBudget: 1500 }, 1);
    expect(out).toHaveLength(1);
  });

  it("drops places beyond ~4km of the asked area and keeps close ones", () => {
    const inArea = mk({ lat: 12.9716, lng: 77.6411 });
    const outArea = mk({ lat: 13.1, lng: 77.75 }); // ~18km away
    const query = { area: "indiranagar", areaCenter: { lat: 12.9719, lng: 77.6412 } };
    const out = rankPlaces([inArea, outArea], query, 1);
    expect(ids(out)).toEqual([inArea.id]);
  });

  it("gates lifecycle (watchlist only)", () => {
    const seen = mk({ status: "visited" });
    const fresh = mk({ status: "watchlist" });
    const out = rankPlaces([seen, fresh], { lifecycle: "watchlist" }, 1);
    expect(ids(out)).toEqual([fresh.id]);
  });

  it("ranks a note keyword match above an otherwise identical place", () => {
    const noted = mk({ notes: "saw on insta, the pizza looked unreal" });
    const plain = mk({});
    // keyword +15 beats the ±8 variety noise at any seed
    for (const seed of [1, 2, 3, 99]) {
      const out = rankPlaces([plain, noted], { keywords: ["pizza"] }, seed);
      expect(out[0].place.id).toBe(noted.id);
    }
  });
});
