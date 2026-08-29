import { describe, it, expect } from "vitest";
import { sanitizeQuery } from "./decide-prompt";

describe("sanitizeQuery", () => {
  it("drops off-vocabulary values", () => {
    const q = sanitizeQuery({ cuisines: ["italian", "martian"], types: ["spaceport"] });
    expect(q.cuisines).toEqual(["italian"]);
    expect(q.types).toBeUndefined();
  });

  it("resolves include/exclude contradictions — exclude wins", () => {
    const q = sanitizeQuery({ cuisines: ["italian", "thai"], excludeCuisines: ["italian"] });
    expect(q.cuisines).toEqual(["thai"]);
    expect(q.excludeCuisines).toEqual(["italian"]);
  });

  it("clamps budget to a sane positive integer", () => {
    expect(sanitizeQuery({ maxBudget: 1499.6 }).maxBudget).toBe(1500);
    expect(sanitizeQuery({ maxBudget: -50 }).maxBudget).toBeUndefined();
    expect(sanitizeQuery({ maxBudget: 99_999_999 }).maxBudget).toBeUndefined();
  });

  it("keeps a sane rating floor", () => {
    expect(sanitizeQuery({ minRating: 4.26 }).minRating).toBe(4.3);
    expect(sanitizeQuery({ minRating: 0 }).minRating).toBeUndefined();
    expect(sanitizeQuery({ minRating: 6 }).minRating).toBeUndefined();
  });

  it("filters keywords: stopwords, short words, dupes, cap at 6", () => {
    const q = sanitizeQuery({
      keywords: ["pizza", "the", "go", "PIZZA", "insta", "a1", "sunset", "ramen", "biryani", "dosa", "momo"],
    });
    expect(q.keywords).toEqual(["pizza", "insta", "sunset", "ramen", "biryani", "dosa"]);
  });

  it("keeps a plausible area and drops junk", () => {
    expect(sanitizeQuery({ area: " Jayanagar " }).area).toBe("jayanagar");
    expect(sanitizeQuery({ area: "ab" }).area).toBeUndefined();
    expect(sanitizeQuery({ area: 42 }).area).toBeUndefined();
  });

  it("defaults an invalid lifecycle to any and honours openNow only on true", () => {
    expect(sanitizeQuery({ lifecycle: "sometimes" }).lifecycle).toBe("any");
    expect(sanitizeQuery({ openNow: "yes" }).openNow).toBeUndefined();
    expect(sanitizeQuery({ openNow: true }).openNow).toBe(true);
  });
});
