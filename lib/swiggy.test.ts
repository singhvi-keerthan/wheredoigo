import { describe, it, expect } from "vitest";
import { buildSearchArgs, parseSearchRows } from "./swiggy";

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

  it("keeps the cuisine entityType path when no area is selected", () => {
    expect(buildSearchArgs({ cuisine: "italian" }, user)).toEqual({
      query: "italian",
      entityType: "CUISINE",
      latitude: user.lat,
      longitude: user.lng,
    });
  });

  it("puts a selected area inside the Swiggy query", () => {
    expect(buildSearchArgs({ area: "Jayanagar" }, user)).toEqual({
      query: "restaurants in Jayanagar",
      latitude: user.lat,
      longitude: user.lng,
    });
  });

  it("does not send entityType when cuisine and area share the one query slot", () => {
    expect(buildSearchArgs({ cuisine: "italian", area: "Indiranagar" }, user)).toEqual({
      query: "italian restaurants in Indiranagar",
      latitude: user.lat,
      longitude: user.lng,
    });
  });
});
