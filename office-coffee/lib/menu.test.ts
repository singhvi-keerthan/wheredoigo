import { describe, expect, it } from "vitest";
import { parseItemDetails, parseMenuPage } from "./menu";
import type { MenuItem } from "./types";

const item = (o: Partial<MenuItem> = {}): MenuItem => ({ id: "1", name: "Latte", price: 300, isVeg: true, inStock: true, hasVariants: true, hasAddons: false, description: null, imageUrl: null, ...o });

describe("parseMenuPage", () => {
  it("flattens nested subcategories (shape from Blue Tokai, 2026-11-04)", () => {
    const p = parseMenuPage({
      restaurant: { name: "Blue Tokai", isOpen: true, slaString: "20-25 MINS" },
      categories: [
        { title: "Recommended", items: [{ id: "9", name: "Cappuccino", price: 250, inStock: 1, isVeg: true, hasVariants: false, hasAddons: true }] },
        { title: "Brewed Coffee", subcategories: [{ title: "Hot Coffee", items: [{ id: "10", name: "Latte", price: 270, inStock: 0, isVeg: true }] }] },
      ],
      hasMore: false,
    });
    expect(p.categories.map((c) => c.title)).toEqual(["Recommended", "Brewed Coffee · Hot Coffee"]);
    expect(p.categories[1].items[0].inStock).toBe(false);
    expect(p.categories[0].items[0].hasAddons).toBe(true);
  });
});

describe("parseItemDetails", () => {
  it("groups legacy variations by groupId and labels them", () => {
    const d = parseItemDetails(item(), {
      price: 300,
      variations: [
        { name: "Picco", id: "a", groupId: "g1", default: 1, inStock: 1 },
        { name: "HOT TALL", price: 65, id: "b", groupId: "g1", inStock: 1 },
        { name: "Regular milk", id: "c", groupId: "g2", default: 1, inStock: 1 },
        { name: "Oats", price: 85, id: "d", groupId: "g2", inStock: 1 },
      ],
    });
    expect(d.variantFormat).toBe("legacy");
    expect(d.variantGroups.map((g) => g.label)).toEqual(["Size", "Milk"]);
    expect(d.variantGroups[0].options[0].isDefault).toBe(true);
  });
  it("reads addon min/max", () => {
    const d = parseItemDetails(item({ hasVariants: false, hasAddons: true }), {
      price: 250,
      addons: [{ groupId: "m", groupName: "Choice Of Milk", minAddons: 1, maxAddons: 1, choices: [{ id: "x", name: "Regular", price: 0 }] }],
    });
    expect(d.addonGroups[0]).toMatchObject({ id: "m", min: 1, max: 1 });
  });
  it("marks a customisable item unavailable when Swiggy didn't return it", () => {
    expect(parseItemDetails(item(), null).unavailable).toBeTruthy();
    expect(parseItemDetails(item({ hasVariants: false }), null).unavailable).toBeNull();
  });
  it("refuses an unreadable variantsV2 rather than guessing", () => {
    expect(parseItemDetails(item(), { price: 1, variantsV2: { weird: true } }).unavailable).toBeTruthy();
  });
});
