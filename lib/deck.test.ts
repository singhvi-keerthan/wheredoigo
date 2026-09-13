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

const deck = (swiggy: SwiggyRestaurant[], query = {}, newMemory = {}) =>
  buildDeck({ source: "new", places: [], query, swiggy, seed: 1, seen: new Set(), newMemory }).map((c) => c.key);

const fullDeck = (swiggy: SwiggyRestaurant[], query = {}, newMemory = {}) =>
  buildDeck({ source: "new", places: [], query, swiggy, seed: 1, seen: new Set(), newMemory });

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

  it("enforces hard negative cuisines when Swiggy exposes the cuisine", () => {
    const italian = sw({ cuisines: ["italian"] });
    const thai = sw({ cuisines: ["thai"] });
    expect(deck([italian, thai], { excludeCuisines: ["italian"] })).toEqual([`new:${thai.id}`]);
  });
});

// A New card's score is a provider POSITION with bounded nudges — see rankNew.
describe("buildDeck — ranking Swiggy cards", () => {
  it("does not let cheapness, media and one swipe carry a 3.7★ past a 4.5★ behind it", () => {
    // The reproduced failure. Under the old point sum this pair scored 61 to
    // 41 with the far card on top: ₹600/head (+8), a photo and a blurb (+5),
    // one prior right-swipe sharing all three attributes (+15).
    const far = sw({
      cuisines: ["north-indian"],
      area: "Whitefield",
      rating: 3.7,
      priceForTwo: 1200,
      photo: "hero",
      description: "a blurb",
    });
    const near = sw({ cuisines: ["italian"], area: "Koramangala", rating: 4.5, priceForTwo: 2400 });
    const oneSwipe = { "cuisine:northindian": 1, "area:whitefield": 1, "price:budget": 1 };
    expect(deck([far, near], {}, oneSwipe)).toEqual([`new:${near.id}`, `new:${far.id}`]);
  });

  it("keeps Swiggy's order when quality and intent are comparable", () => {
    const rows = [sw({ rating: 4.4 }), sw({ rating: 4.4 }), sw({ rating: 4.3 })];
    expect(deck(rows)).toEqual(rows.map((r) => `new:${r.id}`));
  });

  it("lets a rating move a card a bounded number of positions, not any number", () => {
    // +2 for 4.5★ and up: from one place back a 4.8 overtakes a 4.0 …
    const [a, b] = [sw({ rating: 4.0 }), sw({ rating: 4.8 })];
    expect(deck([a, b])[0]).toBe(`new:${b.id}`);
    // … and from three back it does not reach the top.
    const rows = [sw({ rating: 4.0 }), sw({ rating: 4.0 }), sw({ rating: 4.0 }), sw({ rating: 4.8 })];
    expect(deck(rows)[0]).toBe(`new:${rows[0].id}`);
  });

  it("penalises an unrated card six positions and gives it no quality reason", () => {
    const [card] = fullDeck([sw({ rating: null })]);
    expect(card.score).toBe(-6);
    expect(card.reasons).toEqual(["New on Swiggy"]);
  });

  it("names an area or cuisine match without scoring it", () => {
    // The area is a filter and the cuisine is the search term — every card in
    // the pool already has them, so a boost would be the same boost for all.
    const plain = sw({ cuisines: ["thai"], area: "Indiranagar", rating: 4.4 });
    const matched = sw({ cuisines: ["italian"], area: "Indiranagar", rating: 4.4 });
    const cards = fullDeck([plain, matched], { area: "Indiranagar", cuisines: ["italian"] });
    expect(cards.map((c) => c.key)).toEqual([`new:${plain.id}`, `new:${matched.id}`]);
    expect(cards[1]?.reasons).toEqual(["Near Indiranagar", "italian match", "4.4 on Swiggy"]);
    expect((cards[0]?.score ?? 0) - (cards[1]?.score ?? 0)).toBe(1); // one provider position, nothing else
  });

  it("moves a card at most one position on swipe history, however strong", () => {
    const generic = sw({ rating: 4.4, cuisines: ["thai"], area: "Whitefield" });
    const between = sw({ rating: 4.4, cuisines: ["mexican"], area: "Whitefield" });
    const familiar = sw({ rating: 4.4, cuisines: ["italian"], area: "Indiranagar" });
    // Memory at its ceiling on BOTH of familiar's attributes (+6 each, +12
    // affinity — the old ranker paid +18 for less). Worth one position.
    const maxed = { "cuisine:italian": 6, "area:indiranagar": 6 };
    expect(deck([generic, between, familiar], {}, maxed)).toEqual(
      [generic, between, familiar].map((r) => `new:${r.id}`)
    );
  });

  it("says 'Matches your swipes' only after two net-positive swipes on a cuisine or locality", () => {
    const r = sw({ cuisines: ["italian"], area: "Indiranagar", priceForTwo: 1600 });
    const reasonsWith = (memory: Record<string, number>) => fullDeck([r], {}, memory)[0]?.reasons ?? [];
    expect(reasonsWith({ "cuisine:italian": 1 })).not.toContain("Matches your swipes");
    expect(reasonsWith({ "price:mid": 3 })).not.toContain("Matches your swipes");
    expect(reasonsWith({ "cuisine:italian": 2 })).toContain("Matches your swipes");
    expect(reasonsWith({ "area:indiranagar": 2 })).toContain("Matches your swipes");
  });

  it("orders new cards identically at every seed", () => {
    const rows = [sw({ rating: 4.1 }), sw({ rating: 4.6 }), sw({ rating: null }), sw({ rating: 3.9 }), sw({ rating: 4.4 })];
    const at = (seed: number) =>
      buildDeck({ source: "new", places: [], query: {}, swiggy: rows, seed, seen: new Set() }).map((c) => c.key);
    for (const seed of [2, 3, 99]) expect(at(seed)).toEqual(at(1));
  });

  it("never inserts an exploration card: a neutral row stays where Swiggy put it", () => {
    const liked = Array.from({ length: 5 }, (_, i) =>
      sw({ id: `liked-${i}`, name: `Liked ${i}`, cuisines: ["italian"], rating: 4.4, priceForTwo: 1800 })
    );
    const neutral = sw({ id: "neutral", name: "Neutral", cuisines: ["thai"], rating: 4.4, priceForTwo: 1800 });
    // The fifth slot used to be reserved for it.
    expect(deck([...liked, neutral], {}, { "cuisine:italian": 4 })).toEqual(
      [...liked, neutral].map((r) => `new:${r.id}`)
    );
  });

  it("puts score and reasons on new cards", () => {
    const r = sw({
      cuisines: ["italian"],
      area: "Indiranagar",
      rating: 4.6,
      priceForTwo: 1800,
    });
    const [card] = fullDeck([r], {
      area: "Indiranagar",
      cuisines: ["italian"],
      maxBudget: 1000,
      minRating: 4,
    });
    expect(card?.kind).toBe("new");
    if (card?.kind !== "new") throw new Error("expected new card");
    expect(card.score).toBeGreaterThan(0);
    expect(card.reasons).toEqual(["Near Indiranagar", "italian match", "Under ₹1,000/head"]);
  });
});

// Your own places, ranked for a deck: rankPlaces' order, then two corrections
// that are true only of "where do I go NOW" — see rankSaved.
describe("buildDeck — your saved places, from where you are", () => {
  const HERE = { lat: 12.9716, lng: 77.6411 }; // mk()'s default position
  const GPS = { ...HERE, source: "gps" as const };
  const JAIPUR = { lat: 26.9124, lng: 75.7873 };
  const savedDeck = (places: Place[], query = {}, anchor?: typeof GPS) =>
    buildDeck({ source: "saved", places, query, swiggy: [], seed: 1, seen: new Set(), anchor });
  const keys = (places: Place[], query = {}, anchor?: typeof GPS) =>
    savedDeck(places, query, anchor).map((c) => c.key);

  it("demotes a cross-city pin behind anything viable nearby, without dropping it", () => {
    const jaipur = mk({ ...JAIPUR, googleRating: 4.8 });
    const local = mk({ googleRating: 4.3 });
    expect(keys([jaipur, local], {}, GPS)).toEqual([`saved:${local.id}`, `saved:${jaipur.id}`]);
  });

  it("scores no distance at all without a verified position", () => {
    // SwipeMode's Bengaluru fallback never reaches here: with no anchor the
    // 4.8 in Jaipur leads on rating, exactly as it did before.
    const jaipur = mk({ ...JAIPUR, googleRating: 4.8 });
    const local = mk({ googleRating: 4.3 });
    expect(keys([local, jaipur])).toEqual([`saved:${jaipur.id}`, `saved:${local.id}`]);
  });

  it("adds no second distance term when the lens already carries an area centre", () => {
    // rankPlaces gates at 4km and pays proximity inside; the deck must not
    // charge for the same kilometres again. Same score with and without GPS.
    const p = mk({ lat: HERE.lat + 0.027, lng: HERE.lng, googleRating: 4.2 }); // ~3km out
    const lens = { area: "Indiranagar", areaCenter: HERE };
    const [withGps] = savedDeck([p], lens, GPS);
    const [withoutGps] = savedDeck([p], lens);
    expect(withGps?.score).toBe(withoutGps?.score);
    // …but the anchor still measures, so the card can say how far.
    expect(withGps?.kind === "saved" ? withGps.distanceKm : undefined).toBeCloseTo(3, 0);
  });

  it("keeps a place you love ahead of a middling one next door at a moderate distance", () => {
    // 5★ from you, favourite, ~5km out: 40 + 12 - 4. A 4.0 watchlist place at
    // the anchor: 32 + 14. (At 11km the same favourite scores ~39 and the
    // watchlist place still 46 — the discovery bias wins there, by design.)
    const loved = mk({ status: "visited", favorite: true, myRating: 5, lat: HERE.lat + 0.045, lng: HERE.lng });
    const meh = mk({ googleRating: 4.0 });
    expect(keys([meh, loved], {}, GPS)).toEqual([`saved:${loved.id}`, `saved:${meh.id}`]);
  });

  it("gives an unrated place no synthetic quality, while its watchlist and favourite evidence still count", () => {
    const unrated = mk({ googleRating: null, favorite: true }); // 0 + 14 + 12
    const modest = mk({ googleRating: 3.0 }); // 24 + 14
    // rankPlaces alone scores the unrated one 54 (+28 for "unknown ≈ 3.5").
    expect(keys([unrated, modest])).toEqual([`saved:${modest.id}`, `saved:${unrated.id}`]);
    expect(savedDeck([unrated])[0]?.score).toBe(26);
  });

  it("gives an unrated place no quality reason either — not even the ranker's fallback", () => {
    // A visited place you never rated, with nothing else to say: rankPlaces
    // fills the empty reasons with "A solid shout", which beside "Unrated" is
    // an endorsement out of thin air. The rated twin keeps it.
    const unrated = mk({ status: "visited", myRating: null, googleRating: null });
    const rated = mk({ status: "visited", myRating: null, googleRating: 4.1 });
    expect(savedDeck([unrated])[0]?.reasons).toEqual([]);
    expect(savedDeck([rated])[0]?.reasons).toEqual(["A solid shout"]);
  });

  // A Swiggy save is pinned at the position the search ran from until Google
  // resolves it, and at its locality's centroid if Google can only do that
  // much — approxLocation either way. Neither is the restaurant's street.
  it("does not read an approximate pin seeded at your own position as 'right here'", () => {
    const guess = mk({ approxLocation: true, googleRating: 4.0, source: "swiggy" }); // at HERE
    const [withGps] = savedDeck([guess], {}, GPS);
    const [withoutGps] = savedDeck([guess]);
    expect(withGps?.score).toBe(withoutGps?.score);
    // and the card never says "0 m" about it
    expect(withGps?.kind === "saved" ? withGps.distanceKm : "set").toBeUndefined();
  });

  it("gives an approximate locality centroid no fine-grained distance penalty", () => {
    const at5km = { lat: HERE.lat + 0.045, lng: HERE.lng };
    const guess = mk({ ...at5km, approxLocation: true, googleRating: 4.0 });
    const exact = mk({ ...at5km, googleRating: 4.0 });
    const [g] = savedDeck([guess], {}, GPS);
    const [e] = savedDeck([exact], {}, GPS);
    const [unpenalised] = savedDeck([guess]);
    expect(g?.score).toBe(unpenalised?.score); // a centroid is not a street
    expect((unpenalised?.score ?? 0) - (e?.score ?? 0)).toBeCloseTo(4, 1); // the real pin pays (~5.0km → ~4)
    expect(g?.kind === "saved" ? g.distanceKm : "set").toBeUndefined();
  });

  it("still demotes an approximate pin that sits in another city", () => {
    // The seed was the city Swiggy searched — right about that much.
    const jaipur = mk({ ...JAIPUR, approxLocation: true, googleRating: 4.8 });
    const local = mk({ googleRating: 4.3 });
    expect(keys([jaipur, local], {}, GPS)).toEqual([`saved:${local.id}`, `saved:${jaipur.id}`]);
    const [card] = savedDeck([jaipur], {}, GPS);
    expect(card?.score).toBeCloseTo(4.8 * 8 + 14 - 40, 5); // the cross-city tier, nothing finer
    expect(card?.kind === "saved" ? card.distanceKm : "set").toBeUndefined();
  });

  it("carries the measured distance on the card only when it had an anchor", () => {
    const p = mk({ lat: HERE.lat + 0.009, lng: HERE.lng }); // ~1km
    const [measured] = savedDeck([p], {}, GPS);
    const [unmeasured] = savedDeck([p]);
    expect(measured?.kind === "saved" ? measured.distanceKm : undefined).toBeCloseTo(1, 0);
    expect(unmeasured?.kind === "saved" ? unmeasured.distanceKm : "set").toBeUndefined();
  });
});

describe("buildDeck — Both", () => {
  it("alternates the two sources' own orders, saved first", () => {
    const s1 = mk({ googleRating: 4.6 });
    const s2 = mk({ googleRating: 4.1 });
    const n1 = sw({ rating: 4.6 });
    const n2 = sw({ rating: 4.1 });
    const cards = buildDeck({ source: "both", places: [s2, s1], query: {}, swiggy: [n1, n2], seed: 1, seen: new Set() });
    expect(cards.map((c) => c.key)).toEqual([`saved:${s1.id}`, `new:${n1.id}`, `saved:${s2.id}`, `new:${n2.id}`]);
  });

  it("skips seen cards before alternating, and collapses to one source when the other runs out", () => {
    const s1 = mk({ googleRating: 4.6 });
    const s2 = mk({ googleRating: 4.1 });
    const n1 = sw({ rating: 4.6 });
    const n2 = sw({ rating: 4.1 });
    const n3 = sw({ rating: 4.0 });
    const seen = new Set([`saved:${s1.id}`]);
    const cards = buildDeck({ source: "both", places: [s1, s2], query: {}, swiggy: [n1, n2, n3], seed: 1, seen });
    expect(cards.map((c) => c.key)).toEqual([`saved:${s2.id}`, `new:${n1.id}`, `new:${n2.id}`, `new:${n3.id}`]);
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
