import { describe, it, expect } from "vitest";
import { salvagePlaces } from "./recover";
import type { Place } from "./types";

// salvagePlaces is the only hand-rolled parser in the app, and it runs on the
// one input that matters most: a library localStorage could not hand back. It
// was verified once by hand in a browser; these are those cases, kept.

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

const arrayOf = (...parts: string[]) => `[${parts.join(",")}]`;

describe("salvagePlaces", () => {
  it("recovers every complete record from a write cut off mid-record", () => {
    // The failure it exists for: setItem died partway through, so the array
    // never closed. JSON.parse rejects all of it; the intact records are still
    // sitting there.
    const raw =
      "[" +
      JSON.stringify(mk({ id: "a", name: "Legacy Brewing Company" })) +
      "," +
      JSON.stringify(mk({ id: "b", name: "Third Wave Coffee" })) +
      ',{"id":"c","name":"Cut Off Mid-Wri';

    expect(() => JSON.parse(raw)).toThrow(); // precondition: genuinely unparseable
    const out = salvagePlaces(raw);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0].name).toBe("Legacy Brewing Company");
  });

  it("does not end a record early on a brace inside a place name", () => {
    // A naive depth counter closes the object at the "}" in the NAME, turning
    // one good record into two unparseable halves.
    const raw = arrayOf(
      JSON.stringify(mk({ id: "a", name: "Legacy Brewing {Company}" })),
      JSON.stringify(mk({ id: "b" }))
    );
    const out = salvagePlaces(raw);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0].name).toBe("Legacy Brewing {Company}");
  });

  it("handles escaped quotes and backslashes in a note", () => {
    const notes = 'He said "the {best} coffee" — path C:\\\\temp';
    const raw = arrayOf(JSON.stringify(mk({ id: "a", notes })), JSON.stringify(mk({ id: "b" })));
    const out = salvagePlaces(raw);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out[0].notes).toBe(notes);
  });

  it("keeps the good records around one that is individually corrupt", () => {
    // A single unsalvageable object costs that object, not the batch.
    const raw = arrayOf(
      JSON.stringify(mk({ id: "a" })),
      '{"id":"bad","name":"x","lat":,,}',
      JSON.stringify(mk({ id: "c" }))
    );
    expect(salvagePlaces(raw).map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("rejects objects that are not places, including nested ones", () => {
    // Photos and visits are nested objects inside a record; they must never be
    // mistaken for records themselves.
    const withNested = mk({
      id: "a",
      photos: [
        { id: "ph1", dataUrl: "", source: "mine", scope: "place", visitId: null, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      visits: [{ id: "v1", at: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }],
    } as Partial<Place>);
    const raw = arrayOf(JSON.stringify(withNested), '{"hello":"world"}');
    const out = salvagePlaces(raw);
    expect(out.map((p) => p.id)).toEqual(["a"]);
    expect(out[0].photos).toHaveLength(1);
  });

  it("returns nothing for input with no recoverable record", () => {
    expect(salvagePlaces("")).toEqual([]);
    expect(salvagePlaces("[")).toEqual([]);
    expect(salvagePlaces("not json at all")).toEqual([]);
    expect(salvagePlaces('[{"id":"a"}]')).toEqual([]); // no name/lat/lng → not a place
  });
});
