import { describe, it, expect } from "vitest";
import { buildSearchPlan } from "./swiggyTerms";

// search_restaurants_dineout's contract: "pass the single thing the user is
// looking for, not their sentence" / "One term, not a sentence, and no location
// words when latitude/longitude already cover the location."
//
// Every case here is a regression guard on a shape that was measured returning
// zero rows from the live catalogue on 2026-08-30.
describe("buildSearchPlan — what New mode actually asks Swiggy for", () => {
  it("never produces a sentence", () => {
    const { terms } = buildSearchPlan({
      lifecycle: "any",
      types: ["bar"],
      vibes: ["rooftop"],
      occasions: ["friends"],
      area: "indiranagar",
    });
    for (const t of terms) {
      expect(t).not.toMatch(/\bin\b/);
      expect(t.split(/\s+/).length).toBeLessThanOrEqual(2);
    }
  });

  it("keeps the locality out of the concept terms", () => {
    // "rooftop friends in Indiranagar" returned 0 rows; "Rooftop" returned 30.
    const { terms } = buildSearchPlan({ lifecycle: "any", vibes: ["rooftop"], area: "indiranagar" });
    expect(terms).toContain("Rooftop");
    expect(terms.join(" ")).not.toMatch(/indiranagar/i);
  });

  it("sends a dish as the cuisine that serves it when the dish itself is thin", () => {
    // Measured: "Ramen" 1 row, "Japanese" 28. "Tacos" 3, "Mexican" 28.
    expect(buildSearchPlan({ lifecycle: "any", staples: ["ramen"] }).terms).toEqual(["Japanese"]);
    expect(buildSearchPlan({ lifecycle: "any", staples: ["tacos"] }).terms).toEqual(["Mexican"]);
  });

  it("keeps a dish the catalogue does know", () => {
    expect(buildSearchPlan({ lifecycle: "any", staples: ["biryani"] }).terms).toEqual(["Biryani"]);
  });

  it("prefers Bar over Pub", () => {
    // Measured: "Pub" 2 rows across all of Bangalore, "Bar" 30.
    expect(buildSearchPlan({ lifecycle: "any", types: ["bar"] }).terms).toEqual(["Bar"]);
  });

  it("never sends free-text keywords", () => {
    // These produced Sri Anniversary Uphar and Wah Parantha — real restaurants,
    // no relationship to the ask.
    const { terms } = buildSearchPlan(
      { lifecycle: "any", occasions: ["celebration"] },
      ["anniversary", "parents"]
    );
    expect(terms).not.toContain("anniversary");
    expect(terms).not.toContain("parents");
  });

  it("drops vocabulary the catalogue cannot resolve rather than narrowing to noise", () => {
    // No Swiggy term for these, and a museum is not on Dineout at all. The list
    // stays EMPTY — never "restaurants", a name match on this catalogue — so the
    // client's locality default and the server's "Dinner" floor can take over.
    expect(buildSearchPlan({ lifecycle: "any", vibes: ["cozy"] }).terms).toEqual([]);
    expect(buildSearchPlan({ lifecycle: "any", types: ["museum"] }).terms).toEqual([]);
  });

  it("hands a bare lens an empty list, so the deck browses a locality instead of a placeholder", () => {
    const plan = buildSearchPlan({ lifecycle: "any" });
    expect(plan.terms).toEqual([]);
    expect(plan.unsupported).toBeUndefined();
  });

  it("marks an ask made only of things Dineout does not list, even with an area", () => {
    // "museum in jayanagar" must not become Jayanagar's restaurants.
    const plan = buildSearchPlan({ lifecycle: "any", types: ["museum"], area: "Jayanagar" });
    expect(plan.terms).toEqual([]);
    expect(plan.unsupported).toEqual(["museum"]);
  });

  it("still searches a mixed ask, dropping the part Dineout cannot answer", () => {
    const plan = buildSearchPlan({ lifecycle: "any", types: ["museum", "café"] });
    expect(plan.terms).toEqual(["Cafe"]);
    expect(plan.unsupported).toBeUndefined();
  });

  it("browses a mixed ask whose other half is any restaurant", () => {
    expect(buildSearchPlan({ lifecycle: "any", types: ["museum", "restaurant"] })).toEqual({ terms: [] });
  });

  it("browses, not refuses, on an attribute the catalogue holds but cannot index", () => {
    // Restaurants CAN be cozy; Swiggy just has no term for it.
    expect(buildSearchPlan({ lifecycle: "any", vibes: ["cozy"] })).toEqual({ terms: [] });
    expect(buildSearchPlan({ lifecycle: "any", types: ["restaurant"] })).toEqual({ terms: [] });
  });

  it("leaves the search wide rather than empty when nothing resolves but an area is known", () => {
    const { terms } = buildSearchPlan({ lifecycle: "any", vibes: ["cozy"], area: "koramangala" });
    expect(terms).toEqual([]);
  });

  it("orders most-specific first and caps the plan", () => {
    const { terms } = buildSearchPlan({
      lifecycle: "any",
      staples: ["pizza"],
      cuisines: ["italian"],
      types: ["bar"],
      vibes: ["rooftop"],
      practical: ["vegetarian"],
    });
    expect(terms[0]).toBe("Pizza");
    expect(terms.length).toBeLessThanOrEqual(4);
  });

  it("de-duplicates terms two values map onto", () => {
    const { terms } = buildSearchPlan({ lifecycle: "any", staples: ["tacos", "burrito"] });
    expect(terms).toEqual(["Mexican"]);
  });
});
