import { describe, it, expect } from "vitest";
import { facetVerdict, matchedValue, carriesAny, knownValues } from "./facets";
import { narrowToAsk } from "./decide";
import { tagsFromGoogleTypes } from "./googleTags";
import type { Place } from "./types";

// Places exactly as the app creates them from a Google search: tags come only
// from tagsFromGoogleTypes, nothing hand-set. This is the shape that made the
// old hard gate return zero pins for every ask.
const mk = (
  name: string,
  gtypes: string[],
  summary = "",
  notes = "",
  extra: Partial<Place> = {}
): Place =>
  ({
    id: name,
    name,
    area: "Indiranagar",
    lat: 12.97,
    lng: 77.61,
    status: "watchlist",
    favorite: false,
    neverAgain: false,
    tags: tagsFromGoogleTypes(gtypes),
    visits: [],
    notes,
    photos: [],
    myRating: null,
    googleRating: 4.4,
    myBudgetPerPerson: null,
    googlePriceLevel: 2,
    googleTypes: gtypes,
    summary,
    source: "manual",
    enrichedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }) as unknown as Place;

const TOIT = mk("Toit", ["bar", "restaurant", "pub"], "Lively brewpub with a rooftop terrace and wood-fired pizza.");
const VB = mk("Vidyarthi Bhavan", ["restaurant", "south_indian_restaurant"], "Iconic eatery famed for its benne masala dosa.");
const THIRD_WAVE = mk("Third Wave", ["cafe", "coffee_shop"], "Quiet specialty coffee bar with laptop-friendly seating.");
const MEGHANA = mk("Meghana Foods", ["restaurant", "indian_restaurant"], "Andhra-style spot famous for its boneless biryani.");
const ALL = [TOIT, VB, THIRD_WAVE, MEGHANA];

describe("facetVerdict — three answers, not two", () => {
  it("says yes from a tag", () => {
    expect(facetVerdict(TOIT, "type", ["bar"])).toBe(true);
  });

  it("says yes from the place's own words when no tag can carry it", () => {
    // `vibe` has almost no Google mapping — this is the namespace that made
    // "somewhere romantic" return nothing at all.
    expect(knownValues(TOIT, "vibe").has("rooftop")).toBe(false);
    expect(facetVerdict(TOIT, "vibe", ["rooftop"])).toBe(true);
  });

  it("says NOTHING KNOWN rather than no when the namespace is empty", () => {
    // The whole bug in one assertion: an untagged vibe used to read as "no".
    expect(facetVerdict(MEGHANA, "vibe", ["cozy"])).toBe(null);
  });

  it("says no when the tag set is filled in and disagrees", () => {
    expect(facetVerdict(VB, "cuisine", ["italian"])).toBe(false);
  });

  it("does not let text produce a NO", () => {
    // Third Wave's summary says "quiet"; that is silence about rooftop, not a
    // denial of it.
    expect(facetVerdict(THIRD_WAVE, "vibe", ["rooftop"])).toBe(null);
  });

  it("matches whole words only — 'bar' must not fire on 'barbeque'", () => {
    // No type tags at all, so the ONLY thing that could say yes here is the
    // text. If the matcher were a substring check, "Barbeque" would answer for
    // "bar" and every grill house would show up under an ask for bars.
    const bbq = mk("Barbeque Nation", [], "All-you-can-eat grill and buffet.");
    expect(knownValues(bbq, "type").size).toBe(0);
    expect(facetVerdict(bbq, "type", ["bar"])).toBe(null);
    // A real bar in the same shape still resolves from its words.
    const real = mk("The Permit Room", [], "All-day bar and diner.");
    expect(facetVerdict(real, "type", ["bar"])).toBe(true);
  });

  it("answers no when a filled-in tag set disagrees, even if text is silent", () => {
    const bbq = mk("Barbeque Nation", ["restaurant"], "All-you-can-eat grill.");
    expect(facetVerdict(bbq, "type", ["bar"])).toBe(false);
  });
});

describe("googleTags — the mappings that were missing", () => {
  it("gives south indian places a cuisine tag", () => {
    expect(knownValues(VB, "cuisine").has("south-indian")).toBe(true);
  });

  it("leaves a bare indian_restaurant UNMAPPED so it can never answer a hard no", () => {
    // Guessing a region here was worse than the original bug: a guessed tag
    // fills the namespace, and a filled namespace can say `false`. Mapping it
    // to north-indian made a dosa place answer FALSE to "south indian".
    expect(knownValues(MEGHANA, "cuisine").size).toBe(0);
    const udupi = mk("Brahmins Coffee Bar", ["restaurant", "indian_restaurant"], "Benne masala dosa and filter coffee.");
    expect(facetVerdict(udupi, "cuisine", ["south-indian"])).toBe(true);
    expect(facetVerdict(MEGHANA, "cuisine", ["south-indian"])).not.toBe(false);
  });
});

// The failures this module's own phrase table introduced. Each one was measured
// on the real code before it was fixed.
describe("text evidence — precision guards", () => {
  it("does not read 'non-vegetarian' as vegetarian", () => {
    const meat = mk("Meat House", ["restaurant"], "Famous non-vegetarian grills and steaks.");
    expect(facetVerdict(meat, "practical", ["vegetarian"])).toBe(null);
  });

  it("does not read a salad bar as a bar", () => {
    const salads = mk("Green Theory", [], "All-day cafe with a salad bar and bowls.");
    expect(facetVerdict(salads, "type", ["bar"])).toBe(null);
  });

  it("does not read a ground-floor terrace as a rooftop", () => {
    const ground = mk("Ground Floor Cafe", [], "A leafy ground-floor terrace.");
    expect(facetVerdict(ground, "vibe", ["rooftop"])).toBe(null);
  });

  it("does not read a car park as a park", () => {
    const mall = mk("Garuda Mall", [], "Shopping centre with a multi-level car park.");
    expect(facetVerdict(mall, "type", ["park-garden"])).toBe(null);
  });

  it("still resolves the real thing in each case", () => {
    expect(facetVerdict(mk("The Permit Room", [], "All-day bar and diner."), "type", ["bar"])).toBe(true);
    expect(facetVerdict(mk("Cubbon Park", [], "A large public park in the centre."), "type", ["park-garden"])).toBe(true);
    expect(facetVerdict(mk("Skyye", [], "Rooftop lounge on the 16th floor."), "vibe", ["rooftop"])).toBe(true);
  });
});

describe("carriesAny — text may confirm, never delete", () => {
  it("does not exclude a salad bar under 'no bars'", () => {
    const salads = mk("Green Theory", [], "All-day cafe with a salad bar.");
    expect(carriesAny(salads, "type", ["bar"])).toBe(false);
  });

  it("does not exclude a cafe from a 'no work spots' ask because it mentions wifi", () => {
    const cafe = mk("Third Wave", ["cafe"], "Free wifi and single-origin espresso.");
    expect(carriesAny(cafe, "occasion", ["work"])).toBe(false);
  });

  it("still excludes on a real tag", () => {
    expect(carriesAny(TOIT, "type", ["bar"])).toBe(true);
  });
});

describe("matchedValue — reasons name the value that actually matched", () => {
  it("returns the matching value, not the first one asked for", () => {
    const korean = mk("Soban", [], "Kimchi stews and bibimbap.");
    expect(matchedValue(korean, "cuisine", ["japanese", "korean"])).toBe("korean");
  });
  it("returns null when nothing matched", () => {
    expect(matchedValue(VB, "cuisine", ["korean"])).toBe(null);
  });
});

describe("narrowToAsk — the map never comes back empty by accident", () => {
  it("shows only confident matches when there are any", () => {
    const { places, confident } = narrowToAsk(ALL, { lifecycle: "any", types: ["bar"], vibes: ["rooftop"] }, 1);
    expect(confident).toBe(true);
    expect(places.map((p) => p.name)).toEqual(["Toit"]);
  });

  it("finds a dish through the summary when no staple tag exists", () => {
    const { places, confident } = narrowToAsk(ALL, { lifecycle: "any", staples: ["biryani"] }, 1);
    expect(confident).toBe(true);
    expect(places.map((p) => p.name)).toEqual(["Meghana Foods"]);
  });

  it("degrades to near-matches instead of returning nothing", () => {
    // Nothing here is korean, and nothing can be confirmed as korean either.
    const { places, confident } = narrowToAsk(ALL, { lifecycle: "any", cuisines: ["korean"] }, 1);
    expect(confident).toBe(false);
    expect(places.length).toBeGreaterThan(0);
    // …but the places whose cuisine tags actively disagree are still gone.
    expect(places.map((p) => p.name)).not.toContain("Vidyarthi Bhavan");
  });

  it("still drops what an exclude names", () => {
    const { places } = narrowToAsk(ALL, { lifecycle: "any", excludeTypes: ["bar"] }, 1);
    expect(places.map((p) => p.name)).not.toContain("Toit");
  });

  it("is a no-op when the ask names no facets", () => {
    const { places, confident } = narrowToAsk(ALL, { lifecycle: "any" }, 1);
    expect(confident).toBe(true);
    expect(places).toHaveLength(ALL.length);
  });
});
