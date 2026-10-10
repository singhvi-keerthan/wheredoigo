import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS,
  TAG_GROUPS,
  appliedOf,
  askBites,
  buildQuery,
  fromAsk,
  withAsk,
  chipsFor,
  labelOf,
  offerable,
  pruneFor,
  searchablePicks,
  suggest,
  toggleTag,
} from "./filterVocab";
import { buildSearchPlan, searchableOnSwiggy } from "./swiggyTerms";

const group = (field: string) => TAG_GROUPS.find((g) => g.field === field)!;

describe("the deck's filter vocabulary", () => {
  it("offers a New deck only values that have a Swiggy term", () => {
    for (const g of TAG_GROUPS) {
      for (const v of offerable(g, "new")) expect(searchableOnSwiggy(g.field, v)).toBe(true);
    }
    // Your own tags with no catalogue counterpart stay off the New deck…
    expect(offerable(group("vibes"), "new")).not.toContain("cozy");
    expect(offerable(group("types"), "new")).not.toContain("museum");
    // …and stay on for your own places.
    expect(offerable(group("vibes"), "saved")).toContain("cozy");
    expect(offerable(group("types"), "both")).toContain("museum");
  });

  it("never offers Late Night to Swiggy — it is a name match", () => {
    expect(searchableOnSwiggy("practical", "late-night")).toBe(false);
    expect(chipsFor(group("practical"), "new", [])).not.toContain("late-night");
    expect(buildSearchPlan({ lifecycle: "any", practical: ["late-night"] }).terms).toEqual([]);
  });

  it("keeps a short list per group, and a pick made by search stays visible", () => {
    for (const g of TAG_GROUPS) expect(chipsFor(g, "saved", []).length).toBeLessThanOrEqual(5);
    const chips = chipsFor(group("cuisines"), "new", ["korean"]);
    expect(chips).toContain("korean");
    expect(chips.slice(0, 5)).toEqual(group("cuisines").short);
  });

  it("suggests across groups and the deck's own areas on any word's prefix", () => {
    const s = suggest("kor", "new", ["Koramangala", "Indiranagar"]);
    expect(s.map((x) => x.label)).toEqual(expect.arrayContaining(["Koramangala", "Korean"]));
    const ind = suggest("ind", "new", ["Indiranagar"]).map((x) => x.label);
    expect(ind).toEqual(expect.arrayContaining(["Indiranagar", "North Indian", "South Indian"]));
  });

  it("offers a typed area only when no known area matches", () => {
    const typed = suggest("Bandra", "new", ["Koramangala"]);
    expect(typed.at(-1)).toMatchObject({ kind: "area", value: "Bandra" });
    expect(suggest("kor", "new", ["Koramangala"]).filter((x) => x.label.startsWith("Use"))).toEqual([]);
    expect(suggest("koramangala", "new", ["Koramangala"]).filter((x) => x.label.startsWith("Use"))).toEqual([]);
    // A sentence is for Ask, never "Use … as the area".
    expect(suggest("cheap biryani, not a bar", "saved", []).filter((x) => x.label.startsWith("Use"))).toEqual([]);
    expect(suggest("HSR Layout", "saved", []).at(-1)).toMatchObject({ kind: "area", value: "HSR Layout" });
  });

  it("doesn't suggest a Swiggy-less value on a New deck", () => {
    expect(suggest("coz", "new", []).filter((x) => x.kind === "tag")).toEqual([]);
    expect(suggest("coz", "saved", []).map((x) => x.label)).toContain("Cozy");
  });

  it("allows several picks in one group and passes all of them on", () => {
    let f = toggleTag(EMPTY_FILTERS, "cuisines", "north-indian");
    f = toggleTag(f, "cuisines", "italian");
    f = toggleTag(f, "vibes", "rooftop");
    const q = buildQuery(f);
    expect(q.cuisines).toEqual(["north-indian", "italian"]);
    expect(q.vibes).toEqual(["rooftop"]);
    expect(toggleTag(f, "cuisines", "italian").cuisines).toEqual(["north-indian"]);
  });

  it("builds an empty query from empty filters", () => {
    expect(buildQuery(EMPTY_FILTERS)).toEqual({ lifecycle: "any" });
  });

  it("lists every pick as a chip that removes only itself", () => {
    const f = {
      ...toggleTag(toggleTag(EMPTY_FILTERS, "cuisines", "north-indian"), "cuisines", "italian"),
      area: "Koramangala",
      maxBudget: 1000,
    };
    const applied = appliedOf(f);
    expect(applied.map((a) => a.label)).toEqual(["Koramangala", "North Indian", "Italian", "Under ₹1,000"]);
    const after = applied.find((a) => a.label === "Italian")!.remove(f);
    expect(after.cuisines).toEqual(["north-indian"]);
    expect(after.area).toBe("Koramangala");
  });

  it("labels values for people, not as stored tags", () => {
    expect(labelOf("north-indian")).toBe("North Indian");
    expect(labelOf("lively")).toBe("Live music");
    expect(labelOf("vegetarian")).toBe("Pure veg");
    expect(labelOf("café")).toBe("Café");
  });

  it("drops what New can't act on when the deck switches to New", () => {
    const f = {
      ...toggleTag(toggleTag(EMPTY_FILTERS, "vibes", "cozy"), "vibes", "rooftop"),
      lifecycle: "favorites" as const,
      openNow: true,
      area: "Koramangala",
    };
    const n = pruneFor(f, "new");
    expect(n.vibes).toEqual(["rooftop"]);
    expect(n.lifecycle).toBe("any");
    expect(n.openNow).toBe(false);
    expect(n.area).toBe("Koramangala");
    expect(pruneFor(f, "saved")).toBe(f);
  });

  it("counts only the picks Swiggy can search", () => {
    let f = toggleTag(EMPTY_FILTERS, "vibes", "cozy");
    f = toggleTag(f, "cuisines", "italian");
    f = toggleTag(f, "practical", "late-night");
    expect(searchablePicks(f)).toBe(1);
  });

  it("turns an ask into picks you can see, and keeps the rest as words", () => {
    const start = toggleTag(EMPTY_FILTERS, "cuisines", "north-indian");
    const { filters, extras } = fromAsk(
      start,
      {
        lifecycle: "any",
        cuisines: ["italian"],
        vibes: ["rooftop"],
        area: "Indiranagar",
        areaCenter: { lat: 12.97, lng: 77.64 },
        maxBudget: 1000,
        excludeTypes: ["bar"],
        keywords: ["pasta"],
      },
      "rooftop italian in indiranagar under 1000, not a bar"
    );
    // The group it named is replaced; the area, budget and vibe become chips.
    expect(filters.cuisines).toEqual(["italian"]);
    expect(filters.vibes).toEqual(["rooftop"]);
    expect(filters.area).toBe("Indiranagar");
    expect(filters.maxBudget).toBe(1000);
    // What no chip shows still reaches the ranker.
    const q = withAsk(buildQuery(filters), extras);
    expect(q.excludeTypes).toEqual(["bar"]);
    expect(q.keywords).toEqual(["pasta"]);
    expect(q.areaCenter).toEqual({ lat: 12.97, lng: 77.64 });
    expect(askBites(extras)).toBe(true);
  });

  it("drops the area's centre once another area is picked", () => {
    const { filters, extras } = fromAsk(
      EMPTY_FILTERS,
      { lifecycle: "any", area: "Indiranagar", areaCenter: { lat: 1, lng: 2 } },
      "indiranagar"
    );
    expect(withAsk(buildQuery({ ...filters, area: "Koramangala" }), extras).areaCenter).toBeUndefined();
    // An ask that only named an area is fully shown by its area chip.
    expect(askBites(extras)).toBe(false);
  });
});
