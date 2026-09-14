import { describe, expect, it } from "vitest";
import { shapeAskLog } from "./askLog";

describe("shapeAskLog — what an ask leaves behind", () => {
  it("keeps the ask and coarsens the position to the locality", () => {
    const r = shapeAskLog({
      route: "search",
      terms: ["Romantic"],
      facets: ["Fine Dining", "Rooftop"],
      searched: ["Romantic"],
      area: "Jayanagar",
      lat: 12.9716123,
      lng: 77.6411987,
      results: 28,
      dropped: 0,
      ms: 2140.7,
    });
    expect(r.lat).toBe(12.97);
    expect(r.lng).toBe(77.64);
    expect(r.terms).toEqual(["Romantic"]);
    expect(r.facets).toEqual(["Fine Dining", "Rooftop"]);
    expect(r.ms).toBe(2141);
    expect(r.prompt).toBeNull();
    expect(r.error).toBeNull();
  });

  it("bounds the lists the client sends, and never stores half a JSON document", () => {
    const r = shapeAskLog({
      route: "search",
      terms: Array.from({ length: 20 }, (_, i) => `t${i}`),
      facets: ["x".repeat(100)],
      query: { pad: "y".repeat(5000) },
    });
    expect(r.terms).toHaveLength(8);
    expect(r.facets?.[0]).toHaveLength(60);
    expect(JSON.parse(r.query!)).toEqual({ truncated: true, length: JSON.stringify({ pad: "y".repeat(5000) }).length });
  });

  it("bounds every free-text field and serialises the parsed query", () => {
    const r = shapeAskLog({
      route: "decide",
      prompt: "x".repeat(900),
      query: { vibes: ["romantic"], occasions: ["date"] },
      parsedBy: "model",
      error: "e".repeat(400),
    });
    expect(r.prompt).toHaveLength(500);
    expect(r.error).toHaveLength(200);
    expect(r.query).toBe(JSON.stringify({ vibes: ["romantic"], occasions: ["date"] }));
    expect(r.lat).toBeNull();
  });
});
