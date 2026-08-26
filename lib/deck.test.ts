import { describe, it, expect } from "vitest";
import { buildDeck } from "./deck";
import type { SwiggyRestaurant } from "./swiggy";
import type { Place } from "./types";

let pn = 0;
function mk(over: Partial<Place>): Place {
  pn++;
  return {
    id: `p${pn}`,
    googlePlaceId: null,
    name: `Place ${pn}`,
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

let n = 0;
function sw(over: Partial<SwiggyRestaurant>): SwiggyRestaurant {
  n++;
  return {
    id: `sw${n}`,
    name: `Swiggy ${n}`,
    cuisines: [],
    area: "Indiranagar",
    address: "",
    lat: 12.9719,
    lng: 77.6412,
    rating: 4.4,
    priceForTwo: 1600, // ₹800/person
    photo: null,
    ...over,
  };
}

const deck = (swiggy: SwiggyRestaurant[], query = {}) =>
  buildDeck({ source: "new", places: [], query, swiggy, seed: 1, seen: new Set() }).map((c) => c.key);

// The standard filters have to mean the same thing on the Swiggy half of the
// deck as they do on your own places — see newMatches in deck.ts.
describe("buildDeck — standard filters on Swiggy cards", () => {
  it("gates new cards by area name", () => {
    const here = sw({ area: "Indiranagar" });
    const there = sw({ area: "Whitefield" });
    expect(deck([here, there], { area: "Indiranagar" })).toEqual([`new:${here.id}`]);
  });

  it("halves cost-for-two into the per-person budget cap", () => {
    const under = sw({ priceForTwo: 1600 }); // ₹800pp — clears a ₹1000 cap
    const over = sw({ priceForTwo: 2400 }); // ₹1200pp — doesn't
    expect(deck([under, over], { maxBudget: 1000 })).toEqual([`new:${under.id}`]);
  });

  it("keeps a card with no price under a budget cap", () => {
    // Matches rankPlaces: unknown cost is not KNOWN to be over.
    const r = sw({ priceForTwo: null });
    expect(deck([r], { maxBudget: 500 })).toEqual([`new:${r.id}`]);
  });

  it("drops unrated and under-rated cards at a rating floor", () => {
    const good = sw({ rating: 4.5 });
    const meh = sw({ rating: 3.8 });
    const unrated = sw({ rating: null });
    expect(deck([good, meh, unrated], { minRating: 4 })).toEqual([`new:${good.id}`]);
  });

  it("leaves cuisine to the Swiggy search rather than re-filtering here", () => {
    // A pool Swiggy already narrowed must not be emptied by a vocabulary
    // mismatch between its cuisine strings and the app's ten tag values.
    const r = sw({ cuisines: ["modern-indian"] });
    expect(deck([r], { cuisines: ["north-indian"] })).toEqual([`new:${r.id}`]);
  });
});

// Live Swiggy rows arrive without coordinates, so the ~120m proximity gate has
// nothing to measure and the locality stands in for it — see alreadySaved.
describe("buildDeck — deduping a Swiggy row that has no coordinates", () => {
  const deckWith = (places: Place[], swiggy: SwiggyRestaurant[]) =>
    buildDeck({ source: "new", places, query: {}, swiggy, seed: 1, seen: new Set() }).map((c) => c.key);

  it("hides a coordinate-less row already on your map in the same area", () => {
    const r = sw({ name: "Downtown Diner", area: "Residency Road", lat: null, lng: null });
    const saved = mk({ name: "Downtown Diner", area: "Residency Road" });
    expect(deckWith([saved], [r])).toEqual([]);
  });

  it("keeps a same-named row in a different area", () => {
    const r = sw({ name: "Downtown Diner", area: "Whitefield", lat: null, lng: null });
    const saved = mk({ name: "Downtown Diner", area: "Residency Road" });
    expect(deckWith([saved], [r])).toEqual([`new:${r.id}`]);
  });

  it("keeps a different restaurant that merely shares a name prefix", () => {
    // Without coordinates the locality is the only other gate, so a 5-char
    // prefix rule would hide this: norm("The Bluebop Cafe") contains "thebl".
    const r = sw({ name: "The Black Pearl", area: "Indiranagar", lat: null, lng: null });
    const saved = mk({ name: "The Bluebop Cafe", area: "Indiranagar" });
    expect(deckWith([saved], [r])).toEqual([`new:${r.id}`]);
  });

  it("matches localities that are spelled apart", () => {
    // Google's sublocality says "Indira Nagar"; Swiggy's prose says
    // "Indiranagar". Same place, and a plain lowercase compare misses it.
    const r = sw({ name: "Copper & Char", area: "Indiranagar", lat: null, lng: null });
    const saved = mk({ name: "Copper & Char", area: "Indira Nagar" });
    expect(deckWith([saved], [r])).toEqual([]);
  });

  it("still uses proximity when the row does carry coordinates", () => {
    // Same name, same coordinates, DIFFERENT area text: the coordinate path
    // must not start consulting the locality.
    const r = sw({ name: "Copper & Char", area: "Indiranagar", lat: 12.9719, lng: 77.6412 });
    const saved = mk({ name: "Copper & Char", area: "somewhere else entirely", lat: 12.9719, lng: 77.6412 });
    expect(deckWith([saved], [r])).toEqual([]);
  });
});
