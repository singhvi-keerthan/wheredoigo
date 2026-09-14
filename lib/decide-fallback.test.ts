import { describe, it, expect } from "vitest";
import { parseFallback } from "./decide-fallback";

// The offline parser had no coverage at all until the vocabulary widened. These
// guard the word-boundary rule: matching used to be a raw substring scan, which
// silently turns unrelated words into filters once the vocabulary grows.

describe("parseFallback · word boundaries", () => {
  it("does not match `bar` inside barbecue", () => {
    expect(parseFallback("good barbecue place").types).toBeUndefined();
  });

  it("still excludes `bar` from the plural in \"no bars\"", () => {
    // This module's own doc comment cites "no bars" — a naive \b…\b fix breaks it.
    expect(parseFallback("dinner, no bars").excludeTypes).toEqual(["bar"]);
  });

  it("still includes `bar` from a plain plural", () => {
    expect(parseFallback("cocktail bars tonight").types).toEqual(["bar"]);
  });

  it("does not turn \"show me\" into a type filter", () => {
    // `show` was rejected as a vocabulary value precisely because of this.
    const q = parseFallback("show me somewhere nice");
    expect(q.types).toBeUndefined();
  });

  it("matches the `theatre` type, including the US spelling", () => {
    expect(parseFallback("a theatre nearby").types).toEqual(["theatre"]);
    expect(parseFallback("movie theater tonight").types).toEqual(["theatre"]);
  });

  it("does not match `park-garden` inside parking", () => {
    const q = parseFallback("somewhere with parking");
    expect(q.types).toBeUndefined();
    expect(q.practical).toEqual(["parking"]); // the real match still lands
  });

  it("does not match `work` inside working", () => {
    expect(parseFallback("open while working from home").occasions).toBeUndefined();
  });
});

describe("parseFallback · hyphen and space variants", () => {
  it("matches a hyphenated value written with a space", () => {
    expect(parseFallback("somewhere fine dining").vibes).toContain("fine-dining");
  });

  it("matches a hyphenated value written with the hyphen", () => {
    expect(parseFallback("somewhere fine-dining").vibes).toContain("fine-dining");
  });

  it("matches the new multi-word type both ways", () => {
    expect(parseFallback("a park garden to sit in").types).toEqual(["park-garden"]);
    expect(parseFallback("a park-garden to sit in").types).toEqual(["park-garden"]);
  });

  it("matches street food written either way", () => {
    expect(parseFallback("street food").types).toEqual(["street-food"]);
    expect(parseFallback("street-food").types).toEqual(["street-food"]);
  });
});

describe("parseFallback · the widened vocabulary reaches non-food types", () => {
  it("finds viewpoint, museum, and landmark", () => {
    expect(parseFallback("a viewpoint for sunset").types).toEqual(["viewpoint"]);
    expect(parseFallback("a museum on sunday").types).toEqual(["museum"]);
    expect(parseFallback("some landmark to walk around").types).toEqual(["landmark"]);
  });

  it("still negates a non-food type, including in the plural", () => {
    // "but" is deliberately not a negation word (see NEG_BEFORE) — use one that is.
    expect(parseFallback("not a museum").excludeTypes).toEqual(["museum"]);
    expect(parseFallback("no museums today").excludeTypes).toEqual(["museum"]);
  });
});

describe("parseFallback · standard filters", () => {
  it("parses a bare known area as an area, not only as keywords", () => {
    const q = parseFallback("Ashok Nagar rated 4+");
    expect(q.area).toBe("Ashok Nagar");
    expect(q.minRating).toBe(4);
  });

  it("stops the area before budget and rating clauses", () => {
    const q = parseFallback("in Ashok Nagar under ₹1,500 rated 4.5+");
    expect(q.area).toBe("Ashok Nagar");
    expect(q.maxBudget).toBe(1500);
    expect(q.minRating).toBe(4.5);
  });

  it("parses k-style budgets", () => {
    expect(parseFallback("date night under 1.5k").maxBudget).toBe(1500);
  });
});

describe("parseFallback · the area is a gate, not a keyword", () => {
  it("keeps the ask's own words and drops the locality it parsed", () => {
    const q = parseFallback("museum in jayanagar");
    expect(q.area).toBe("Jayanagar");
    expect(q.keywords).toEqual(["museum"]);
  });

  it("drops every word of a multi-word locality", () => {
    const q = parseFallback("dessert place near hsr layout");
    expect(q.area?.toLowerCase()).toBe("hsr layout");
    expect(q.keywords ?? []).not.toContain("layout");
    expect(q.keywords).toContain("dessert");
  });
});
