import { describe, it, expect } from "vitest";
import { buildSearchArgs, SEARCH_LIMIT, mergeRestaurantDetails, parseSearchRows, type SwiggyRestaurant } from "./swiggy";

// Verbatim from a live search_restaurants_dineout call (query "dinner",
// Bengaluru). Kept exactly as Swiggy sent it — trailing double-spaces, empty
// columns and all — because the whole point of this test is to notice when
// Swiggy reflows the sentence the deck is parsed out of.
const LIVE = `Found 38 restaurant(s) matching "dinner", showing 10. 28 more available, call again with offset=10. Some results are non-participating restaurants: no table booking or slots available on Dineout for those, do not offer to book them.
1. Sai Krishna Snacks & Dinner —  | 0★ |  | Kadugodi (ID: 1182592)
2. Vapour Brewpub and Diner —  | 4.1★ |  | Sarjapur Road (ID: 341385)
5. Downtown Diner —  | 4.3★ |  | Residency Road (ID: 737829)
Search coordinates: latitude=12.9279, longitude=77.5937 (use these for get_restaurant_details and downstream calls).

When the user selects a restaurant (by name, number, or clicking), call get_restaurant_details with that restaurant's ID and the same latitude/longitude. Do NOT call search_restaurants_dineout again.

These results are NOT yet shown to the user. Decide which restaurants to show and in what order based on the user's intent (cheapest -> cost, best -> rating, nearest -> distance, else relevance), then call render_restaurants_dineout with restaurantIds in that order plus searches listing every search you ran ({ query, latitude, longitude, entityType? }). ids may span multiple searches.`;

describe("parseSearchRows — search answers in prose, not data", () => {
  it("reads only the numbered rows, ignoring the surrounding instructions", () => {
    const rows = parseSearchRows(LIVE);
    expect(rows.map((r) => r.id)).toEqual(["1182592", "341385", "737829"]);
  });

  it("pulls name, rating and locality out of the pipe columns", () => {
    const [first, , third] = parseSearchRows(LIVE);
    expect(first).toEqual({ id: "1182592", name: "Sai Krishna Snacks & Dinner", rating: 0, area: "Kadugodi" });
    expect(third).toEqual({ id: "737829", name: "Downtown Diner", rating: 4.3, area: "Residency Road" });
  });

  it("returns nothing for prose with no rows at all", () => {
    // The slotless / no-match answer, which must read as an empty list rather
    // than an error — see getAvailableSlots.
    expect(parseSearchRows("No bookable slots for 2026-08-26. Do not retry.")).toEqual([]);
  });

  it("survives a row with blank columns", () => {
    expect(parseSearchRows("3. Some Place —  |  |  |  (ID: 42)")).toEqual([
      { id: "42", name: "Some Place", rating: null, area: "" },
    ]);
  });

  it("keeps a name that contains an em-dash of its own", () => {
    // Lazy matching split this at the FIRST dash and produced "Toit", which
    // then flowed into dedupe, Directions and the Google position lookup.
    expect(parseSearchRows("4. Toit — Brewpub —  | 4.5★ |  | Indiranagar (ID: 999)")).toEqual([
      { id: "999", name: "Toit — Brewpub", rating: 4.5, area: "Indiranagar" },
    ]);
  });

  it("says out loud that the fixture names render_restaurants_dineout", () => {
    // The reason the binding calls render at all — kept in the fixture so the
    // claim is checkable in-repo rather than asserted in a comment.
    expect(LIVE).toContain("call render_restaurants_dineout with restaurantIds");
  });

  it("never mistakes the rating column for the locality", () => {
    // A row that omits the trailing locality must not hand "4.1★" to the area
    // filter, the dedupe check and the saved Place.area.
    expect(parseSearchRows("1. Foo — 4.1★ (ID: 5)")).toEqual([
      { id: "5", name: "Foo", rating: 4.1, area: "" },
    ]);
  });
});

describe("buildSearchArgs — Swiggy New source search shape", () => {
  const user = { lat: 12.972, lng: 77.61 };

  // The tool's contract: "One term, not a sentence, and no location words when
  // latitude/longitude already cover the location." Every case here is a
  // regression guard on the shape that used to return zero rows.
  it("sends one bare term and the page size", () => {
    expect(buildSearchArgs({ term: "Italian" }, user)).toEqual({
      query: "Italian",
      latitude: user.lat,
      longitude: user.lng,
      limit: SEARCH_LIMIT,
    });
  });

  it("never builds a sentence — a locality is its own term, not a suffix", () => {
    expect(buildSearchArgs({ term: "Jayanagar" }, user).query).toBe("Jayanagar");
    expect(buildSearchArgs({ term: "Rooftop" }, user).query).toBe("Rooftop");
  });

  it("does not send entityType at all", () => {
    expect(buildSearchArgs({ term: "Italian" }, user)).not.toHaveProperty("entityType");
  });

  it("asks for the documented maximum page rather than the default 10", () => {
    expect(buildSearchArgs({ term: "Bar" }, user).limit).toBe(30);
  });

  it("passes an explicit offset through for the next page", () => {
    expect(buildSearchArgs({ term: "Biryani", offset: 10 }, user)).toEqual({
      query: "Biryani",
      latitude: user.lat,
      longitude: user.lng,
      limit: SEARCH_LIMIT,
      offset: 10,
    });
  });

  it("falls back to a browsable term rather than an empty query", () => {
    expect(buildSearchArgs({ term: "   " }, user).query).toBe("restaurants");
  });
});

describe("mergeRestaurantDetails — coordinates are never taken from a details answer", () => {
  const base: SwiggyRestaurant = {
    id: "42", name: "Toit", cuisines: ["european"], area: "Indiranagar",
    address: "100 Feet Road", lat: null, lng: null, rating: 4.6,
    priceForTwo: 1600, photo: null,
  };

  it("keeps lat/lng null when the details answer echoes the user's position", () => {
    // get_restaurant_details takes latitude/longitude as INPUT ("use same as
    // search"). Swiggy echoing them back is the phone's position, not the
    // restaurant's — and saveNew reads non-null coords as "exact, don't look
    // it up", so letting the echo through pins the place on the user.
    const merged = mergeRestaurantDetails(base, {
      name: "Toit",
      latitude: 12.972,
      longitude: 77.61,
      description: "Multi-level brewpub with a rooftop terrace.",
    });
    expect(merged.lat).toBeNull();
    expect(merged.lng).toBeNull();
    // Everything else still merges — this drops the coordinates, not the call.
    expect(merged.description).toBe("Multi-level brewpub with a rooftop terrace.");
  });

  it("does not overwrite real coordinates the base card already had", () => {
    const located = { ...base, lat: 12.9784, lng: 77.6408 };
    const merged = mergeRestaurantDetails(located, { latitude: 12.972, longitude: 77.61 });
    expect(merged.lat).toBe(12.9784);
    expect(merged.lng).toBe(77.6408);
  });
});

describe("mergeRestaurantDetails — active Swiggy card enrichment", () => {
  const base: SwiggyRestaurant = {
    id: "42",
    name: "Base Bistro",
    cuisines: ["italian"],
    area: "Indiranagar",
    address: "12th Main, Indiranagar",
    lat: null,
    lng: null,
    rating: 4.1,
    priceForTwo: 1400,
    photo: "https://cdn.example/base.jpg",
  };

  it("keeps search fields while adding gallery and details", () => {
    const merged = mergeRestaurantDetails(base, {
      restaurant: {
        name: "Base Bistro",
        images: ["gallery-one", { imageId: "gallery-two" }],
        description: "A compact dinner spot with a wood-fired menu.",
        highlights: [{ title: "Outdoor seating" }, { label: "Serves cocktails" }],
        offers: [{ offerText: "Flat 20% off on pre-booking" }],
        distanceString: "2.4 km away",
      },
    });

    expect(merged.id).toBe(base.id);
    expect(merged.rating).toBe(base.rating);
    expect(merged.priceForTwo).toBe(base.priceForTwo);
    expect(merged.photos).toHaveLength(3);
    expect(merged.photos?.[0]).toContain("gallery-one");
    expect(merged.photo).toBe(merged.photos?.[0]);
    expect(merged.description).toBe("A compact dinner spot with a wood-fired menu.");
    expect(merged.highlights).toEqual(["Outdoor seating", "Serves cocktails"]);
    expect(merged.offers).toEqual(["Flat 20% off on pre-booking"]);
    expect(merged.distance).toBe("2.4 km away");
  });
});
