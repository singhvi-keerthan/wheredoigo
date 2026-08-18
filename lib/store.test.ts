import { describe, it, expect } from "vitest";
import { findDuplicate, rederiveTypeTags } from "./store";
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


// The boot-time repair for places captured before the type vocabulary covered
// anything but food. The conditions matter as much as the repair: a place that
// is already typed must come back untouched, or a broad migration re-stamps
// updatedAt across the library and beats newer remote records on sync.
describe("rederiveTypeTags", () => {
  it("types a place that had none — the invisible-pin case", () => {
    const fort = mk({ id: "a", tags: [], googleTypes: ["historical_landmark", "tourist_attraction"] });
    const { places, changedIds } = rederiveTypeTags([fort]);
    expect(changedIds).toEqual(["a"]);
    expect(places[0].tags).toEqual([
      { namespace: "type", value: "landmark" },
      { namespace: "type", value: "activity" },
    ]);
  });

  it("does not touch or dirty a place that already has a type tag", () => {
    const typed = mk({
      id: "a",
      tags: [{ namespace: "type", value: "café" }],
      googleTypes: ["historical_landmark"], // would derive `landmark` if it were read
    });
    const { places, changedIds } = rederiveTypeTags([typed]);
    expect(changedIds).toEqual([]);
    expect(places[0]).toBe(typed); // same object → commit()'s diff sees no change
    expect(places[0].tags).toEqual([{ namespace: "type", value: "café" }]);
  });

  it("does not touch a place with no googleTypes to derive from", () => {
    const manual = mk({ id: "a", tags: [], googleTypes: undefined });
    const { places, changedIds } = rederiveTypeTags([manual]);
    expect(changedIds).toEqual([]);
    expect(places[0]).toBe(manual);
  });

  it("does not touch a place whose googleTypes map to nothing in the vocabulary", () => {
    const dentist = mk({ id: "a", tags: [], googleTypes: ["dentist", "point_of_interest"] });
    const { places, changedIds } = rederiveTypeTags([dentist]);
    expect(changedIds).toEqual([]);
    expect(places[0]).toBe(dentist);
  });

  it("preserves existing non-type tags exactly", () => {
    const p = mk({
      id: "a",
      tags: [{ namespace: "vibe", value: "romantic" }, { namespace: "occasion", value: "date" }],
      googleTypes: ["observation_deck"],
    });
    const { places } = rederiveTypeTags([p]);
    expect(places[0].tags).toEqual([
      { namespace: "vibe", value: "romantic" },
      { namespace: "occasion", value: "date" },
      { namespace: "type", value: "viewpoint" },
    ]);
  });

  it("adds only type tags — cuisine and staple are left alone", () => {
    const p = mk({ id: "a", tags: [], googleTypes: ["pizza_restaurant", "italian_restaurant"] });
    const { places } = rederiveTypeTags([p]);
    expect(places[0].tags.every((t) => t.namespace === "type")).toBe(true);
  });

  it("returns the very same array when nothing qualifies — zero records dirtied", () => {
    const input = [
      mk({ id: "a", tags: [{ namespace: "type", value: "bar" }], googleTypes: ["bar"] }),
      mk({ id: "b", tags: [], googleTypes: [] }),
    ];
    const { places, changedIds } = rederiveTypeTags(input);
    expect(changedIds).toEqual([]);
    expect(places).toBe(input);
  });

  it("stamps updatedAt only on the records it rewrites", () => {
    const stale = mk({ id: "a", tags: [], googleTypes: ["museum"], updatedAt: "2020-01-01T00:00:00.000Z" });
    const typed = mk({ id: "b", tags: [{ namespace: "type", value: "bar" }], updatedAt: "2020-01-01T00:00:00.000Z" });
    const { places } = rederiveTypeTags([stale, typed]);
    expect(places[0].updatedAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(places[1].updatedAt).toBe("2020-01-01T00:00:00.000Z");
  });
});
