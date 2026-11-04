import { describe, expect, it } from "vitest";
import { cartProblems, chunkLines, parseCart, pickKey, type CartSummary } from "./run";
import type { Choice, PersonPick } from "./types";

const choice = (itemId: string, addonIds: string[] = [], variantIds: string[] = []): Choice => ({
  itemId,
  name: itemId,
  variantFormat: variantIds.length ? "legacy" : null,
  variants: variantIds.map((id) => ({ groupId: "g", optionId: id, name: id, price: 0 })),
  addons: addonIds.map((id) => ({ groupId: "m", optionId: id, name: id, price: 0 })),
  unitPrice: 100,
  note: null,
});
const pick = (personId: number, c: Choice): PersonPick => ({ personId, personName: `P${personId}`, choice: c });

// A cart response shaped like the live get_food_cart (2026-11-04): numeric
// ids, variants with variation_id/group_id, pricing.to_pay.
const cartFrom = (items: object[], toPay: number | null = 400): CartSummary =>
  parseCart({ statusCode: 0, data: { items, pricing: { item_total: 300, delivery_charge: 0, taxes_and_charges: 20, to_pay: toPay } } }, []);

describe("cartProblems", () => {
  const picks = [pick(1, choice("190844880", ["146759595"])), pick(2, choice("190844880", ["146759595"])), pick(3, choice("y"))];

  it("passes when every line matches, ids numeric or not", () => {
    const cart = cartFrom([
      { menu_item_id: 190844880, name: "Cappuccino", quantity: 2, final_price: 540, in_stock: 1, variants: [], addons: [{ choice_id: 146759595, group_id: 265805347, name: "Oat Milk" }] },
      { menu_item_id: "y", name: "y", quantity: 1, final_price: 100, in_stock: 1 },
    ]);
    expect(cartProblems(cart, picks)).toEqual([]);
  });

  it("blocks a same-price substitution (oat milk → regular milk)", () => {
    const cart = cartFrom([
      { menu_item_id: 190844880, name: "Cappuccino", quantity: 2, final_price: 540, in_stock: 1, addons: [{ choice_id: 146759557, name: "Regular Milk" }] },
      { menu_item_id: "y", name: "y", quantity: 1, final_price: 100, in_stock: 1 },
    ]);
    const p = cartProblems(cart, picks).join(" | ");
    expect(p).toMatch(/2 picked, 0 in Swiggy's cart/);
    expect(p).toMatch(/nobody picked/);
  });

  it("blocks a dropped customisation and a different size", () => {
    const sized = [pick(1, choice("L", [], ["tall"]))];
    const cart = cartFrom([{ menu_item_id: "L", name: "Latte", quantity: 1, in_stock: 1, variants: [{ variation_id: "short", group_id: "g" }] }]);
    expect(cartProblems(cart, sized).length).toBeGreaterThan(0);
    expect(pickKey(sized[0])).toBe(JSON.stringify(["L", ["tall"], []]));
  });

  it("blocks a silently dropped item, out-of-stock line and missing total", () => {
    const cart = cartFrom([{ menu_item_id: 190844880, name: "Cappuccino", quantity: 2, in_stock: 0, addons: [{ choice_id: 146759595 }] }], null);
    const p = cartProblems(cart, picks).join(" | ");
    expect(p).toMatch(/y: 1 picked, 0/);
    expect(p).toMatch(/out of stock/);
    expect(p).toMatch(/total/);
  });
});

describe("chunkLines", () => {
  it("splits instead of truncating, keeping every line", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `• *Person ${i}*: Cappuccino (Oat Milk, extra shot)`);
    const chunks = chunkLines(lines);
    expect(chunks.every((c) => c.length <= 2800)).toBe(true);
    expect(chunks.join("\n").split("\n")).toEqual(lines);
  });
});
