import { beforeEach, describe, expect, it } from "vitest";
import type { SwiggyRestaurant } from "./swiggy";

const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const {
  newSwipeAffinity,
  newSwipeAttributeKeys,
  readNewSwipeMemory,
  recordNewSwipe,
  undoNewSwipe,
} = await import("./swipeMemory");

function sw(over: Partial<SwiggyRestaurant> = {}): SwiggyRestaurant {
  return {
    id: "sw",
    name: "Test",
    cuisines: ["italian"],
    area: "Indiranagar",
    address: "",
    lat: null,
    lng: null,
    rating: 4.2,
    priceForTwo: 1800,
    photo: null,
    ...over,
  };
}

describe("new Swiggy swipe memory", () => {
  beforeEach(() => mem.clear());

  it("tracks attributes rather than restaurant ids", () => {
    expect(newSwipeAttributeKeys(sw())).toEqual(["cuisine:italian", "area:indiranagar", "price:mid"]);
  });

  it("records right swipes and scores another restaurant with shared attributes", () => {
    recordNewSwipe(sw({ id: "one" }), "right");
    const memory = readNewSwipeMemory();
    expect(newSwipeAffinity(memory, sw({ id: "two", name: "Different", cuisines: ["italian"] }))).toBe(3);
  });

  it("records left swipes softly and undo reverses them", () => {
    const r = sw();
    let memory = recordNewSwipe(r, "left");
    expect(newSwipeAffinity(memory, r)).toBeCloseTo(-1.5);
    memory = undoNewSwipe(r, "left");
    expect(newSwipeAffinity(memory, r)).toBe(0);
  });

  // A right swipe moves an attribute twice as far as a left one, which would be
  // a one-way ratchet if the bounds matched. They don't: the floor is half the
  // ceiling, so a cuisine takes the same six swipes to bottom out as to max out.
  it("lets dislike reach its floor in the same number of swipes as like reaches its ceiling", () => {
    const liked = sw({ id: "liked", cuisines: ["italian"], area: "Indiranagar" });
    for (let i = 0; i < 12; i += 1) recordNewSwipe(liked, "right");
    // 3 attributes, each capped at +6.
    expect(newSwipeAffinity(readNewSwipeMemory(), liked)).toBe(18);

    mem.clear();
    const passed = sw({ id: "passed", cuisines: ["italian"], area: "Indiranagar" });
    for (let i = 0; i < 12; i += 1) recordNewSwipe(passed, "left");
    expect(newSwipeAffinity(readNewSwipeMemory(), passed)).toBe(-9);

    // Six of each is where both bounds are actually reached.
    mem.clear();
    for (let i = 0; i < 6; i += 1) recordNewSwipe(liked, "right");
    expect(newSwipeAffinity(readNewSwipeMemory(), liked)).toBe(18);
    mem.clear();
    for (let i = 0; i < 6; i += 1) recordNewSwipe(passed, "left");
    expect(newSwipeAffinity(readNewSwipeMemory(), passed)).toBe(-9);
  });

  // Every cuisine word Swiggy has ever sent could become a key, and the map is
  // read on every deck build — so it is capped, faintest opinions dropped first.
  it("caps the map and keeps the strongest opinions", () => {
    const strong = sw({ id: "strong", cuisines: ["italian"], area: "Indiranagar" });
    for (let i = 0; i < 6; i += 1) recordNewSwipe(strong, "right");

    for (let i = 0; i < 200; i += 1) {
      recordNewSwipe(sw({ id: `n${i}`, cuisines: [`cuisine${i}`], area: `area${i}` }), "left");
    }

    const memory = readNewSwipeMemory();
    expect(Object.keys(memory).length).toBeLessThanOrEqual(120);
    // The +6s survived the flood of -0.5s.
    expect(memory["cuisine:italian"]).toBe(6);
    expect(memory["area:indiranagar"]).toBe(6);
  });
});
