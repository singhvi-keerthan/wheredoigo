import { describe, it, expect } from "vitest";
import { buildSearchArgs, SEARCH_LIMIT, mergeRestaurantDetails, parseSearchRows, swiggyPhotoUrl, type SwiggyRestaurant } from "./swiggy";

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
    // Not "restaurants": that is a NAME match on this catalogue (see
    // DEFAULT_SEARCH_TERM), which browses nothing.
    expect(buildSearchArgs({ term: "   " }, user).query).toBe("Casual Dining");
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
    // The search photo stays the cover the card was dealt on; the gallery
    // follows it, so details landing never swap the picture under the card.
    expect(merged.photos?.[0]).toBe(base.photo);
    expect(merged.photos?.[1]).toContain("gallery-one");
    expect(merged.photo).toBe(base.photo);
    expect(merged.description).toBe("A compact dinner spot with a wood-fired menu.");
    expect(merged.highlights).toEqual(["Outdoor seating", "Serves cocktails"]);
    expect(merged.offers).toEqual(["Flat 20% off on pre-booking"]);
    expect(merged.distance).toBe("2.4 km away");
  });

  it("reads the details masthead into the gallery, capped, and leaves menu photos out", () => {
    // The shape get_restaurant_details returns (measured 2026-09-14, id 341385).
    const masthead = Array.from({ length: 12 }, (_, i) => `https://media-assets.swiggy.com/swiggy/image/upload/DINEOUT/m${i}.JPG`);
    const merged = mergeRestaurantDetails(base, {
      restaurantId: "42",
      restaurant: { id: "42", name: "Base Bistro", imageUrl: masthead[0], mastheadImageUrls: masthead },
      menuImages: [{ imageUrl: "https://dineout-media-assets.swiggy.com/swiggy/image/upload/DINEOUT/menu1.JPG" }],
    });
    expect(merged.photo).toBe(base.photo); // the cover the card was dealt on
    expect(merged.photos?.[0]).toBe(base.photo);
    // Every gallery URL goes through the card-size transform (swiggyPhotoUrl).
    expect(merged.photos?.slice(1, 4)).toEqual(masthead.slice(0, 3).map(swiggyPhotoUrl));
    expect(merged.photos).toHaveLength(8);
    expect(merged.photos?.some((p) => p.includes("menu"))).toBe(false);
  });

  it("keeps the gallery's own first photo as the cover when it differs from `photo`", () => {
    const first = "https://cdn.example/first.jpg";
    const merged = mergeRestaurantDetails(
      { ...base, photos: [first, "https://cdn.example/base.jpg"] },
      { restaurant: { images: ["gallery-one"] } }
    );
    expect(merged.photos?.[0]).toBe(first);
    expect(merged.photo).toBe(first);
  });
});

describe("render rows — offers, the headline deal and the rating count", () => {
  // The shape of a live render_restaurants_dineout row (The Pizza Bakery,
  // Indiranagar, 2026-10-07), trimmed to the fields under test.
  const row = {
    id: "686844",
    name: "The Pizza Bakery - Indiranagar",
    cuisine: ["Pizza", "Beverages"],
    locality: "Indiranagar",
    rating: { value: "4.3", count: 7008 },
    costForTwo: "₹1500 for two",
    offers: [{ offerTitle: "Flat 15% off", offerDescription: "Total bill" }],
    offerHeadline: { title: "Flat 15% off", kind: "deal", subtitle: "on pre-booking", subtext: "+1 offer" },
  };
  const base: SwiggyRestaurant = {
    id: "686844", name: "x", cuisines: [], area: "", address: "", lat: null, lng: null,
    rating: null, priceForTwo: null, photo: null,
  };

  it("reads Swiggy's own offer objects instead of dropping them", () => {
    expect(mergeRestaurantDetails(base, row).offers).toEqual(["Flat 15% off · total bill"]);
  });

  it("keeps the headline deal and how many ratings are behind the rating", () => {
    const r = mergeRestaurantDetails(base, row);
    expect(r.deal).toBe("Flat 15% off on pre-booking");
    expect(r.ratingCount).toBe(7008);
    expect(r.rating).toBe(4.3);
  });

  it("leaves both empty on a row that has neither", () => {
    const r = mergeRestaurantDetails(base, { id: "1", name: "Y", rating: { value: "0", count: 0 } });
    expect(r.deal ?? null).toBeNull();
    expect(r.ratingCount ?? null).toBeNull();
  });
});

describe("swiggyPhotoUrl — a full media URL gets the card-size transform", () => {
  const BASE = "https://media-assets.swiggy.com/swiggy/image/upload/";

  // The shape the search payload actually sends (measured 2026-09-14): a full
  // URL, no transform, which the CDN serves as a 262px thumbnail.
  it("inserts the transform after /upload/ on a bare path", () => {
    expect(swiggyPhotoUrl(`${BASE}DINEOUT_ALL_RESTAURANTS/IMAGES/x.JPG`)).toBe(
      `${BASE}fl_lossy,f_auto,q_auto,w_800/DINEOUT_ALL_RESTAURANTS/IMAGES/x.JPG`
    );
  });

  it("leaves a URL alone when it already carries a transform segment", () => {
    const done = `${BASE}fl_lossy,f_auto,q_auto,w_800/DINEOUT/a.jpg`;
    expect(swiggyPhotoUrl(done)).toBe(done);
    const other = `${BASE}w_400/DINEOUT/a.jpg`;
    expect(swiggyPhotoUrl(other)).toBe(other);
  });

  // Cloudinary requires the transform BEFORE a version segment.
  it("puts the transform ahead of a v123 version segment", () => {
    expect(swiggyPhotoUrl(`${BASE}v1700000000/DINEOUT/a.jpg`)).toBe(
      `${BASE}fl_lossy,f_auto,q_auto,w_800/v1700000000/DINEOUT/a.jpg`
    );
  });

  it("passes any other host straight through", () => {
    const g = "https://lh3.googleusercontent.com/p/abc=s800";
    expect(swiggyPhotoUrl(g)).toBe(g);
    const menu = "https://dineout-media-assets.swiggy.com/swiggy/image/upload/DINEOUT/menu1.JPG";
    // A sibling host with the same path shape gets the same treatment — it is
    // the same CDN. (Menu images are never read by the card; this just pins
    // the host rule.)
    expect(swiggyPhotoUrl(menu)).toBe(
      "https://dineout-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_800/DINEOUT/menu1.JPG"
    );
  });
});
