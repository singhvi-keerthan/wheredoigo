import { describe, it, expect, vi, beforeEach } from "vitest";

// The fan-out, the dedupe, the area top-up, `dropped` and `searched` were the
// parts that actually broke, and they had no coverage at all — the suite tested
// buildSearchArgs and the prose parser around them and stayed green while the
// deck came back empty.
//
// swiggyMcp is mocked so these run offline; SWIGGY_MCP_TOKEN is set so
// swiggyLive() takes the real path rather than the mock catalogue.
const callSwiggyReply = vi.fn();
const callSwiggyTool = vi.fn();

vi.mock("./swiggyMcp", async () => {
  const actual = await vi.importActual<typeof import("./swiggyMcp")>("./swiggyMcp");
  return {
    ...actual,
    swiggyLive: () => true,
    callSwiggyReply: (...a: unknown[]) => callSwiggyReply(...a),
    callSwiggyTool: (...a: unknown[]) => callSwiggyTool(...a),
  };
});

// WIDE_SEARCH and the token are read into module-level consts at import time,
// so they have to be set BEFORE the dynamic import — stubbing them in
// beforeEach is too late and silently leaves the fan-out disabled.
vi.stubEnv("SWIGGY_MCP_TOKEN", "test-token");
vi.stubEnv("SWIGGY_WIDE_SEARCH", "1");

const { searchDineoutRestaurants } = await import("./swiggy");
const { SwiggyAuthError } = await import("./swiggyMcp");

// Swiggy's real prose shape — a numbered list with ids in parentheses.
const prose = (rows: [string, string, string][]) =>
  `Found ${rows.length} restaurant(s), showing ${rows.length}.\n` +
  rows.map(([id, name, area], i) => `${i + 1}. ${name} —  | 4.2★ |  | ${area} (ID: ${id})`).join("\n");

const reply = (rows: [string, string, string][]) => ({ data: null, text: prose(rows) });

beforeEach(() => {
  callSwiggyReply.mockReset();
  callSwiggyTool.mockReset();
  // render_restaurants_dineout answers with nothing structured; the prose rows
  // are the fallback, which is the path that matters for these assertions.
  callSwiggyTool.mockResolvedValue({});
});

describe("searchDineoutRestaurants — the fan-out", () => {
  it("keeps the good pages when one term fails", async () => {
    callSwiggyReply
      .mockResolvedValueOnce(reply([["1", "Toit", "Indiranagar"]]))
      .mockRejectedValueOnce(new Error("transport blew up"));

    const { results, searched } = await searchDineoutRestaurants({ terms: ["Bar", "Rooftop"] });
    // Promise.all here would have rejected the whole set, the route would have
    // turned that into a 502, and the deck would have said "reconnect Swiggy".
    expect(results.map((r) => r.name)).toEqual(["Toit"]);
    expect(searched).toEqual(["Bar"]); // and it reports only what actually ran
  });

  it("throws when EVERY term fails — that is a real outage", async () => {
    callSwiggyReply.mockRejectedValue(new Error("down"));
    await expect(searchDineoutRestaurants({ terms: ["Bar", "Rooftop"] })).rejects.toThrow("down");
  });

  it("lets a reauth through immediately, even alongside a good page", async () => {
    callSwiggyReply
      .mockResolvedValueOnce(reply([["1", "Toit", "Indiranagar"]]))
      .mockRejectedValueOnce(new SwiggyAuthError());
    // "Reconnect Swiggy" has to reach the UI; silently returning a short deck
    // would leave the token expired with nothing telling anyone.
    await expect(searchDineoutRestaurants({ terms: ["Bar", "Rooftop"] })).rejects.toBeInstanceOf(
      SwiggyAuthError
    );
  });

  it("de-duplicates a restaurant that two terms both return, and does not count it as dropped", async () => {
    callSwiggyReply
      .mockResolvedValueOnce(reply([["1", "Toit", "Indiranagar"], ["2", "Skyye", "Ashok Nagar"]]))
      .mockResolvedValueOnce(reply([["1", "Toit", "Indiranagar"]]));

    const { results, dropped } = await searchDineoutRestaurants({ terms: ["Bar", "Rooftop"] });
    expect(results.map((r) => r.id).sort()).toEqual(["1", "2"]);
    // The un-deduped denominator counted the repeat as a lost row.
    expect(dropped).toBe(0);
  });
});

describe("searchDineoutRestaurants — what a bare deck browses", () => {
  it("searches the locality when the lens names none but the client knows one", async () => {
    callSwiggyReply.mockResolvedValue(reply([["1", "Cahoots", "Ashok Nagar"]]));
    const { searched } = await searchDineoutRestaurants({ terms: [], area: "Ashok Nagar" });
    expect(searched).toEqual(["Ashok Nagar"]);
    expect(callSwiggyReply.mock.calls[0][1]).toMatchObject({ query: "Ashok Nagar" });
  });

  it("falls back to a browsable concept, never to 'restaurants'", async () => {
    // "restaurants" is a NAME match on this catalogue — measured 2026-09-14,
    // all 30 rows were places called Restaurant, a third of them unrated.
    callSwiggyReply.mockResolvedValue(reply([["1", "Ginger Tiger", "Vittal Mallya Road"]]));
    const { searched } = await searchDineoutRestaurants({ terms: [] });
    expect(searched).toEqual(["Dinner"]);
    expect(String(callSwiggyReply.mock.calls[0][1].query)).not.toMatch(/restaurant/i);
  });
});

describe("searchDineoutRestaurants — provider order", () => {
  it("puts render's records back in the order search listed them", async () => {
    // Search's order is Swiggy's relevance at the user's coordinates — the one
    // location-aware ranking a row carries, and what the deck now leans on.
    // render_restaurants_dineout answers in its own order; that must not leak.
    callSwiggyReply.mockResolvedValueOnce(reply([["1", "A", "X"], ["2", "B", "X"], ["3", "C", "X"]]));
    callSwiggyTool.mockResolvedValueOnce({
      restaurants: [
        { id: "3", name: "C" },
        { id: "1", name: "A" },
        { id: "9", name: "Extra" }, // never listed by search: keeps its place, after
        { id: "2", name: "B" },
      ],
    });
    const { results } = await searchDineoutRestaurants({ terms: ["Bar"] });
    expect(results.map((r) => r.id)).toEqual(["1", "2", "3", "9"]);
  });
});

describe("searchDineoutRestaurants — the area top-up", () => {
  it("searches the locality itself when the concept terms land elsewhere", async () => {
    callSwiggyReply
      .mockResolvedValueOnce(reply([["1", "Bobs Bar", "Ashok Nagar"], ["2", "CBD", "Shanthala Nagar"]]))
      .mockResolvedValueOnce(reply([["9", "Toit", "Indiranagar"]]));

    const { searched } = await searchDineoutRestaurants({ terms: ["Bar"], area: "Indiranagar" });
    // Measured on the live catalogue: "bar" at Indiranagar's coordinates returns
    // 30 rows with 2 in Indiranagar, so a concept-only answer is not an answer.
    expect(searched).toEqual(["Bar", "Indiranagar"]);
    expect(callSwiggyReply).toHaveBeenCalledTimes(2);
  });

  it("does NOT spend the extra call when the concepts already landed in the area", async () => {
    callSwiggyReply.mockResolvedValueOnce(
      reply([
        ["1", "A", "Indiranagar"], ["2", "B", "Indiranagar"], ["3", "C", "Indiranagar"],
        ["4", "D", "Indiranagar"], ["5", "E", "Indiranagar"],
      ])
    );
    const { searched } = await searchDineoutRestaurants({ terms: ["Bar"], area: "Indiranagar" });
    expect(searched).toEqual(["Bar"]);
    expect(callSwiggyReply).toHaveBeenCalledTimes(1);
  });

  it("does not search a locality that is already one of the terms", async () => {
    callSwiggyReply.mockResolvedValueOnce(reply([["1", "A", "Whitefield"]]));
    const { searched } = await searchDineoutRestaurants({ terms: ["Indiranagar"], area: "Indiranagar" });
    expect(searched).toEqual(["Indiranagar"]);
    expect(callSwiggyReply).toHaveBeenCalledTimes(1);
  });
});

describe("searchDineoutRestaurants — what it sends", () => {
  it("sends one bare term per call, with the area's coordinates and the max page", async () => {
    callSwiggyReply.mockResolvedValue(reply([["1", "A", "Indiranagar"]]));
    await searchDineoutRestaurants({
      terms: ["Rooftop"], area: "Indiranagar",
      areaLat: 12.9784, areaLng: 77.6408, lat: 12.972, lng: 77.61,
    });
    const [, args] = callSwiggyReply.mock.calls[0];
    expect(args).toMatchObject({
      query: "Rooftop",
      latitude: 12.9784, // the AREA's centre, not the user's position
      longitude: 77.6408,
      limit: 30,
    });
    expect(args).not.toHaveProperty("entityType");
    expect(String(args.query)).not.toMatch(/indiranagar/i);
  });

  it("falls back to the user's position when no area was geocoded", async () => {
    callSwiggyReply.mockResolvedValue(reply([["1", "A", "X"]]));
    await searchDineoutRestaurants({ terms: ["Biryani"], lat: 12.972, lng: 77.61 });
    const [, args] = callSwiggyReply.mock.calls[0];
    expect(args).toMatchObject({ latitude: 12.972, longitude: 77.61 });
  });
});

describe("searchDineoutRestaurants — optional follow-ups never sink the answer", () => {
  it("keeps the primary pages when the area top-up fails", async () => {
    callSwiggyReply
      .mockResolvedValueOnce(reply([["1", "Bobs Bar", "Ashok Nagar"]])) // concept: out of area
      .mockRejectedValueOnce(new Error("flaky")); // the top-up

    const { results, searched } = await searchDineoutRestaurants({ terms: ["Bar"], area: "Indiranagar" });
    // A bare await here rejected the whole search, the route made it a 502, and
    // the deck said "Swiggy didn't answer" while throwing away a good page.
    expect(results.map((r) => r.name)).toEqual(["Bobs Bar"]);
    expect(searched).toEqual(["Bar"]); // and it doesn't claim a search that failed
  });

  it("still surfaces a reauth from an optional follow-up", async () => {
    callSwiggyReply
      .mockResolvedValueOnce(reply([["1", "Bobs Bar", "Ashok Nagar"]]))
      .mockRejectedValueOnce(new SwiggyAuthError());
    await expect(
      searchDineoutRestaurants({ terms: ["Bar"], area: "Indiranagar" })
    ).rejects.toBeInstanceOf(SwiggyAuthError);
  });
});
