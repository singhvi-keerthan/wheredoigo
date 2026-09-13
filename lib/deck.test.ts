import { describe, it, expect } from "vitest";
import { buildDeck, nearbyArea, refreshSavedCardPhotos } from "./deck";
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

// A New card scores like a saved one — rating, less distance — see rankNew.
describe("buildDeck — ranking Swiggy cards", () => {
  it("does not let cheapness, media and one swipe carry a 3.7★ 11km out past a 4.5★ down the road", () => {
    // The reproduced failure. Under the original point sum this pair scored 61
    // to 41 with the far card on top: ₹600/head (+8), a photo and a blurb
    // (+5), one prior right-swipe sharing all three attributes (+15).
    const far = sw({
      cuisines: ["north-indian"],
      area: "Whitefield",
      rating: 3.7,
      priceForTwo: 1200,
      photo: "hero",
      description: "a blurb",
      distance: "11 km",
    });
    const near = sw({ cuisines: ["italian"], area: "Koramangala", rating: 4.5, priceForTwo: 2400, distance: "0.8 km" });
    const oneSwipe = { "cuisine:northindian": 1, "area:whitefield": 1, "price:budget": 1 };
    const cards = fullDeck([far, near], {}, oneSwipe);
    expect(cards.map((c) => c.key)).toEqual([`new:${near.id}`, `new:${far.id}`]);
    expect(cards[0]?.score).toBeCloseTo(36, 5); // 4.5 × 8, nothing off
    expect(cards[1]?.score).toBeCloseTo(3.7 * 8 - 12.8 + 4, 5); // rating, −11km, +half a star of memory
  });

  it("ranks on rating and distance, not on Swiggy's order", () => {
    // The live "restaurants" pool, 2026-09-14: a 4.8 at 13.9km led the deck
    // when search order was the backbone. It is not, so it does not.
    const rdk = sw({ rating: 4.8, distance: "13.9 km" });
    const narmada = sw({ rating: 4.5, distance: "5.4 km" });
    const modest = sw({ rating: 4.0, distance: "5 km" });
    expect(deck([rdk, narmada, modest])).toEqual([narmada, modest, rdk].map((r) => `new:${r.id}`));
  });

  it("keeps Swiggy's order only as the tie-break", () => {
    const rows = [sw({ rating: 4.4, distance: "2 km" }), sw({ rating: 4.4, distance: "2 km" }), sw({ rating: 4.4, distance: "1 km" })];
    expect(deck(rows)).toEqual(rows.map((r) => `new:${r.id}`));
  });

  it("gives an unrated card no quality points and no quality reason", () => {
    const unrated = sw({ rating: null, distance: "1 km" });
    const [card] = fullDeck([unrated]);
    expect(card.score).toBe(0);
    expect(card.reasons).toEqual(["New on Swiggy"]);
    // Under a rated card that keeps any points after distance: a 3.5 twenty
    // kilometres out still has 28 − 20 = 8 on it. (A 2.9 at 25km does not —
    // it goes to −0.8 — and an unknown next door outranking THAT is fine.)
    const rated = sw({ rating: 3.5, distance: "20 km" });
    expect(deck([unrated, rated])).toEqual([`new:${rated.id}`, `new:${unrated.id}`]);
  });

  it("charges a row with no readable distance the pool's median, and shows it none", () => {
    const near = sw({ rating: 4.4, distance: "1 km" });
    const far = sw({ rating: 4.4, distance: "9 km" });
    const mid = sw({ rating: 4.4, distance: "5 km" });
    const unknown = sw({ rating: 4.4, distance: null });
    const cards = fullDeck([unknown, near, far, mid]);
    // median of the known three is 5km → the same −4 as `mid`; they tie, and
    // the tie-break is search order, which had `unknown` first.
    expect(cards.map((c) => c.key)).toEqual([near, unknown, mid, far].map((r) => `new:${r.id}`));
    expect(cards[1]?.distanceKm).toBeUndefined();
    expect(cards[0]?.distanceKm).toBe(1);
  });

  it("names an area or cuisine match without scoring it", () => {
    // The area is a filter and the cuisine is the search term — every card in
    // the pool already has them, so a boost would be the same boost for all.
    const plain = sw({ cuisines: ["thai"], area: "Indiranagar", rating: 4.4, distance: "2 km" });
    const matched = sw({ cuisines: ["italian"], area: "Indiranagar", rating: 4.4, distance: "2 km" });
    const cards = fullDeck([plain, matched], { area: "Indiranagar", cuisines: ["italian"] });
    expect(cards.map((c) => c.key)).toEqual([`new:${plain.id}`, `new:${matched.id}`]);
    expect(cards[1]?.reasons).toEqual(["Near Indiranagar", "italian match", "4.4 on Swiggy"]);
    expect(cards[0]?.score).toBe(cards[1]?.score);
  });

  it("pays a keyword hit what the saved deck pays, once, on whole words only", () => {
    const plain = sw({ rating: 4.4, distance: "2 km", description: "" });
    const hit = sw({ rating: 4.4, distance: "2 km", description: "rooftop with a rooftop bar" });
    const cards = fullDeck([plain, hit], { keywords: ["rooftop"] });
    expect(cards[0]?.key).toBe(`new:${hit.id}`);
    expect((cards[0]?.score ?? 0) - (cards[1]?.score ?? 0)).toBe(15);
    // "bar" is not Barbeque Nation — the same rule the saved deck applies.
    const bbq = sw({ name: "Barbeque Nation", rating: 4.0, distance: "2 km" });
    const bar = sw({ name: "Copitas Bar", rating: 4.0, distance: "2 km" });
    const asked = fullDeck([bbq, bar], { keywords: ["bar"] });
    expect(asked.map((c) => c.key)).toEqual([`new:${bar.id}`, `new:${bbq.id}`]);
    expect(asked[1]?.reasons).not.toContain("Matches your ask");
  });

  it("moves a card by half a star at most on swipe history, however strong", () => {
    // Memory at its ceiling on BOTH of familiar's attributes (+6 each, +12
    // affinity — the original ranker paid +18 for less). Worth 4 points: past
    // a 4.4, not past a 4.6.
    const maxed = { "cuisine:italian": 6, "area:indiranagar": 6 };
    const familiar = () => sw({ rating: 4.0, cuisines: ["italian"], area: "Indiranagar", distance: "2 km" });
    const a = familiar();
    const b44 = sw({ rating: 4.4, cuisines: ["thai"], area: "Whitefield", distance: "2 km" });
    expect(deck([b44, a], {}, maxed)).toEqual([`new:${a.id}`, `new:${b44.id}`]);
    const c = familiar();
    const b46 = sw({ rating: 4.6, cuisines: ["thai"], area: "Whitefield", distance: "2 km" });
    expect(deck([c, b46], {}, maxed)).toEqual([`new:${b46.id}`, `new:${c.id}`]);
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
    const rows = [
      sw({ rating: 4.1, distance: "1 km" }),
      sw({ rating: 4.6, distance: "7 km" }),
      sw({ rating: null, distance: "2 km" }),
      sw({ rating: 3.9, distance: null }),
      sw({ rating: 4.4, distance: "3 km" }),
    ];
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

// Which locality a lens-less deck browses — see nearbyArea.
describe("nearbyArea — the locality your nearest pins stand in", () => {
  const HERE = { lat: 12.9716, lng: 77.6411 };
  const km = (n: number) => n / 111.2; // degrees of latitude per km, near enough

  it("picks the most common area within 3km, nearest on a tie", () => {
    const places = [
      mk({ area: "Indiranagar", lat: HERE.lat + km(1) }),
      mk({ area: "Indiranagar", lat: HERE.lat + km(2) }),
      mk({ area: "Domlur", lat: HERE.lat + km(0.5) }),
    ];
    expect(nearbyArea(places, HERE)).toBe("Indiranagar");
    expect(nearbyArea(places.slice(1), HERE)).toBe("Domlur"); // one each → the nearer
  });

  it("ignores approximate pins and anything farther than 3km", () => {
    const places = [
      mk({ area: "Whitefield", lat: HERE.lat + km(0.2), approxLocation: true }), // a guess at your seed
      mk({ area: "Jayanagar", lat: HERE.lat + km(6) }),
    ];
    expect(nearbyArea(places, HERE)).toBeUndefined();
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

describe("refreshSavedCardPhotos", () => {
  const photo = {
    id: "photo-1",
    dataUrl: "",
    source: "mine" as const,
    scope: "place" as const,
    visitId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("hydrates a Saved card without changing its rank metadata or a New card", () => {
    const place = mk({ photos: [photo], googleRating: 4.4 });
    const restaurant = sw({ photo: "https://example.com/new.jpg" });
    const original = buildDeck({
      source: "both",
      places: [place],
      query: {},
      swiggy: [restaurant],
      seed: 1,
      seen: new Set(),
    });
    const hydrated = { ...place, photos: [{ ...photo, dataUrl: "data:image/jpeg;base64,aGVsbG8=" }] };

    const refreshed = refreshSavedCardPhotos(original, [hydrated]);

    expect(refreshed).not.toBe(original);
    expect(refreshed.map((card) => card.key)).toEqual(original.map((card) => card.key));
    expect(refreshed[1]).toBe(original[1]);
    expect(refreshed[0]).toMatchObject({
      key: original[0]?.key,
      score: original[0]?.score,
      reasons: original[0]?.reasons,
      place: { photos: hydrated.photos },
    });
  });

  it("reflects photo removal while preserving the card's frozen place snapshot", () => {
    const place = mk({ photos: [{ ...photo, dataUrl: "data:image/jpeg;base64,aGVsbG8=" }] });
    const [card] = buildDeck({
      source: "saved",
      places: [place],
      query: {},
      swiggy: [],
      seed: 1,
      seen: new Set(),
    });
    if (!card || card.kind !== "saved") throw new Error("expected saved card");
    const renamed = { ...place, name: "A later name", photos: [] };

    const [refreshed] = refreshSavedCardPhotos([card], [renamed]);

    expect(refreshed?.kind).toBe("saved");
    if (refreshed?.kind !== "saved") throw new Error("expected saved card");
    expect(refreshed.place.photos).toEqual([]);
    expect(refreshed.place.name).toBe(card.place.name);
  });

  it("returns the original deck when no photo array changed or the place is absent", () => {
    const place = mk({ photos: [photo] });
    const deck = buildDeck({
      source: "saved",
      places: [place],
      query: {},
      swiggy: [],
      seed: 1,
      seen: new Set(),
    });

    expect(refreshSavedCardPhotos(deck, [place])).toBe(deck);
    expect(refreshSavedCardPhotos(deck, [])).toBe(deck);
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
