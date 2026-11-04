import { describe, expect, it } from "vitest";
import { isDrink } from "./menu";
import { effectiveOf } from "./people";
import type { Choice } from "./types";

// Names and categories from Blue Tokai's live menu, 2026-11-04.
describe("isDrink", () => {
  it.each([
    ["Cappuccino", "Brewed Coffee · Hot Coffee"],
    ["Iced Latte", "Recommended"],
    ["Peach Elderflower Iced Tea", "Other Beverages · Iced Tea"],
    ["Hot Chocolate", "Other Beverages · Hot Chocolate"],
    ["Dirty Matcha", "Summer Specials"],
    ["Flat White", "EatRight Dishes"],
    ["Coffee Tonic", "Other Beverages · Coolers"],
  ])("keeps %s (%s)", (name, cat) => expect(isDrink(name, cat)).toBe(true));

  it.each([
    ["Spicy Mushroom Sourdough Sandwich", "EatRight Dishes"],
    ["Almond Croissant", "Suchali's Artisan Bakehouse · Croissants"],
    ["Peri Peri Fries", "Food · Sides"],
    ["Cappuccino & Paprika Grilled Chicken Sandwich", "Coffee & Sandwich Combo"],
    ["Americano Coffee Drops (Pack Of 10)", "Roasted Coffee · Drop: Specialty Coffee Concentrate"],
    ["French Roast [250 gms]", "Roasted Coffee · Retail Packs"],
    ["Coffee Cup Cake", "Recommended"],
    ["Coromandel Sipper- 500 Ml", "Merchandise · Metallic Tumblers"],
    ["Festive Luxe Hamper", "Diwali Hampers"],
  ])("drops %s (%s)", (name, cat) => expect(isDrink(name, cat)).toBe(false));
});

describe("daily tap-in", () => {
  const usual: Choice = { itemId: "1", name: "Cappuccino", variantFormat: null, variants: [], addons: [], unitPrice: 250, note: null };
  const changed: Choice = { ...usual, itemId: "2", name: "Iced Latte" };
  it("a usual alone orders nothing — you must tap in that day", () => {
    expect(effectiveOf({ regular: usual, choice: null, confirmed: false, skip: false })).toBeNull();
  });
  it("tapped in → the usual, or that day's change", () => {
    expect(effectiveOf({ regular: usual, choice: null, confirmed: true, skip: false })).toEqual(usual);
    expect(effectiveOf({ regular: usual, choice: changed, confirmed: true, skip: false })).toEqual(changed);
  });
});
