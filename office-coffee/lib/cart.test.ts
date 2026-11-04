import { describe, expect, it } from "vitest";
import { buildCartItems, picksHash, restaurantNote, validateChoice } from "./cart";
import type { Choice, ItemDetails, PersonPick } from "./types";

// Shapes as read live 2026-11-04: Blue Tokai Cappuccino (addons, required
// milk) and Starbucks Latte (legacy variations, two groups).
const cappuccino: ItemDetails = {
  itemId: "190844880",
  name: "Cappuccino",
  basePrice: 250,
  variantFormat: null,
  variantGroups: [],
  addonGroups: [
    {
      id: "265805347",
      label: "Choice Of Milk",
      min: 1,
      max: 1,
      options: [
        { id: "146759557", name: "Regular Milk", price: 0, isDefault: false, inStock: true },
        { id: "146759595", name: "Oat Milk", price: 20, isDefault: false, inStock: true },
      ],
    },
  ],
  unavailable: null,
};
const latte: ItemDetails = {
  itemId: "L1",
  name: "Latte",
  basePrice: 300,
  variantFormat: "legacy",
  variantGroups: [
    { id: "58228502", label: "Size", options: [
      { id: "180702734", name: "Picco", price: 0, isDefault: true, inStock: true },
      { id: "180702737", name: "HOT TALL", price: 65, isDefault: false, inStock: true },
    ] },
    { id: "58228503", label: "Milk", options: [
      { id: "180702739", name: "Regular milk", price: 0, isDefault: true, inStock: true },
      { id: "180702742", name: "Oats", price: 85, isDefault: false, inStock: true },
    ] },
  ],
  addonGroups: [],
  unavailable: null,
};

const ok = (r: ReturnType<typeof validateChoice>): Choice => {
  if (!r.ok) throw new Error(r.error);
  return r.choice;
};
const pick = (personId: number, choice: Choice): PersonPick => ({ personId, personName: `P${personId} Surname`, choice });

describe("validateChoice", () => {
  it("enforces a required addon group", () => {
    const r = validateChoice(cappuccino, { variants: {}, addons: {} });
    expect(r.ok).toBe(false);
  });
  it("prices addons and keeps server-side names", () => {
    const c = ok(validateChoice(cappuccino, { variants: {}, addons: { "265805347": ["146759595"] } }));
    expect(c.unitPrice).toBe(270);
    expect(c.addons[0].name).toBe("Oat Milk");
  });
  it("rejects too many in a max-1 group", () => {
    const r = validateChoice(cappuccino, { variants: {}, addons: { "265805347": ["146759557", "146759595"] } });
    expect(r.ok).toBe(false);
  });
  it("rejects an option id that isn't on the menu", () => {
    expect(validateChoice(latte, { variants: { "58228502": "nope" }, addons: {} }).ok).toBe(false);
    expect(validateChoice(cappuccino, { variants: {}, addons: { "265805347": ["nope"] } }).ok).toBe(false);
  });
  it("defaults each variant group", () => {
    const c = ok(validateChoice(latte, { variants: {}, addons: {} }));
    expect(c.variants.map((v) => v.optionId)).toEqual(["180702734", "180702739"]);
    expect(c.unitPrice).toBe(300);
  });
});

describe("buildCartItems", () => {
  it("merges identical drinks into one line and keeps different ones apart", () => {
    const reg = ok(validateChoice(cappuccino, { variants: {}, addons: { "265805347": ["146759557"] } }));
    const oat = ok(validateChoice(cappuccino, { variants: {}, addons: { "265805347": ["146759595"] } }));
    const items = buildCartItems([pick(1, reg), pick(2, reg), pick(3, oat)]);
    expect(items).toEqual([
      { menu_item_id: "190844880", quantity: 2, addons: [{ group_id: "265805347", choice_id: "146759557" }] },
      { menu_item_id: "190844880", quantity: 1, addons: [{ group_id: "265805347", choice_id: "146759595" }] },
    ]);
  });
  it("sends legacy variants as `variants`, v2 as `variantsV2`", () => {
    const c = ok(validateChoice(latte, { variants: { "58228502": "180702737" }, addons: {} }));
    expect(buildCartItems([pick(1, c)])[0].variants).toEqual([
      { group_id: "58228502", variation_id: "180702737" },
      { group_id: "58228503", variation_id: "180702739" },
    ]);
    expect(buildCartItems([pick(1, { ...c, variantFormat: "v2" })])[0].variantsV2).toBeDefined();
  });
});

describe("picksHash / notes", () => {
  it("changes when anyone's pick changes, not when order changes", () => {
    const a = ok(validateChoice(latte, { variants: {}, addons: {} }));
    const b = ok(validateChoice(latte, { variants: { "58228503": "180702742" }, addons: {} }));
    expect(picksHash([pick(1, a), pick(2, a)])).toBe(picksHash([pick(2, a), pick(1, a)]));
    expect(picksHash([pick(1, a), pick(2, a)])).not.toBe(picksHash([pick(1, a), pick(2, b)]));
  });
  it("labels notes by first name", () => {
    const a = { ...ok(validateChoice(latte, { variants: {}, addons: {} })), note: "extra hot" };
    expect(restaurantNote([pick(1, a)])).toBe("P1: extra hot");
  });
});
