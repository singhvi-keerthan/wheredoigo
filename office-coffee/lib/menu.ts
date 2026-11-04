// The restaurant's menu, cached in Neon so twenty people browsing at 11:15
// cost Swiggy a handful of calls, not hundreds.
//
// Shapes below were read off live responses on 2026-11-04 (Blue Tokai
// 1300465, Starbucks 1073668): get_restaurant_menu returns categories that are
// either simple (items[]) or nested (subcategories[].items[]), compact rows
// only; search_menu returns the full options — legacy `variations` as a flat
// list tagged with groupId, addons as groups with min/max.

import { cacheGet, cachePut } from "./db";
import { read } from "./swiggy";
import type { AddonGroup, ItemDetails, Menu, MenuCategory, MenuItem, Option, Settings, VariantGroup } from "./types";

const MENU_TTL_MIN = 6 * 60;
const ITEM_TTL_MIN = 12 * 60;
const ITEM_CACHE_VERSION = 2; // bump when parsing changes so cached items re-parse

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function toItem(r: Raw): MenuItem | null {
  const id = str(r.id ?? r.menu_item_id);
  const name = str(r.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    price: num(r.price),
    isVeg: r.isVeg === true || r.isVeg === 1 || r.isVeg === "1",
    inStock: r.inStock === undefined ? true : num(r.inStock) === 1 || r.inStock === true,
    hasVariants: r.hasVariants === true,
    hasAddons: r.hasAddons === true,
    description: r.description ? str(r.description) : null,
    imageUrl: r.imageUrl ? str(r.imageUrl) : null,
  };
}

export function parseMenuPage(data: Raw): { name: string; isOpen: boolean | null; sla: string | null; categories: MenuCategory[]; hasMore: boolean } {
  const restaurant = (data.restaurant ?? {}) as Raw;
  const categories: MenuCategory[] = [];
  for (const cat of arr(data.categories)) {
    const title = str(cat.title) || "Menu";
    const direct = arr(cat.items).map(toItem).filter((x): x is MenuItem => !!x);
    if (direct.length) categories.push({ title, items: direct });
    for (const sub of arr(cat.subcategories)) {
      const items = arr(sub.items).map(toItem).filter((x): x is MenuItem => !!x);
      if (items.length) categories.push({ title: `${title} · ${str(sub.title)}`, items });
    }
  }
  return {
    name: str(restaurant.name),
    isOpen: typeof restaurant.isOpen === "boolean" ? restaurant.isOpen : null,
    sla: restaurant.slaString ? str(restaurant.slaString) : null,
    categories,
    hasMore: data.hasMore === true,
  };
}

export async function getMenu(settings: Settings, opts: { force?: boolean } = {}): Promise<Menu | null> {
  if (!settings.restaurantId || !settings.addressId) return null;
  const key = `menu:${settings.restaurantId}:${settings.addressId}`;
  if (!opts.force) {
    const hit = await cacheGet<Menu>(key, MENU_TTL_MIN);
    if (hit) return drinksOnly(hit);
  }
  const categories: MenuCategory[] = [];
  let name = settings.restaurantName ?? "";
  let isOpen: boolean | null = null;
  let sla: string | null = null;
  for (let page = 1; page <= 6; page++) {
    const { data } = await read("get_restaurant_menu", {
      restaurantId: settings.restaurantId,
      addressId: settings.addressId,
      page,
      pageSize: 8,
    });
    if (!data) break;
    const parsed = parseMenuPage(data);
    if (page === 1) {
      name = parsed.name || name;
      isOpen = parsed.isOpen;
      sla = parsed.sla;
    }
    categories.push(...parsed.categories);
    if (!parsed.hasMore) break;
  }
  const menu: Menu = {
    restaurantId: settings.restaurantId,
    restaurantName: name,
    isOpen,
    sla,
    categories,
    fetchedAt: new Date().toISOString(),
  };
  await cachePut(key, menu);
  return drinksOnly(menu);
}

// Drinks only, no food. Swiggy has no food/drink flag and category names
// mix ("Recommended", "Summer Specials", a "Dishes" list holding a Flat
// White), so each ITEM is judged by its category and its own name. Read
// off Blue Tokai's live menu 2026-11-04; retail packs, capsules, beans and
// combos with food are out.
const FOOD_NAME = /sandwich|cake|cookie|croissant|bagel|toast|bowl|fries|salad|pancake|spaghetti|pasta|mousse|brownie|muffin|bread|wrap|burger|pizza|granola|drops|capsule|\bbags?\b|pack of|\[\d+\s*(g|gm|gms)\]|\(\d+\s*(g|gm|gms)\)|\d+\s*(gm|gms)\b|hamper|gift|\bbox\b|sipper|tumbler|pain au|sourdough/i;
const NON_DRINK_CATEGORY = /roasted coffee|retail|merch|bakehouse|bakery|\bfood\b|combo|hamper|gift|dessert|snack|breakfast|salad|sandwich|capsule|sachet|beans/i;
const DRINK_CATEGORY = /coffee|beverage|drink|\btea\b|chai|brew|shake|smoothie|juice|cooler|kombucha|chocolate|frapp|matcha|latte|espresso|mocktail|lemonade/i;
const DRINK_NAME = /coffee|latte|cappuccino|americano|espresso|mocha|frapp|cold brew|\btea\b|chai|matcha|hot chocolate|shake|smoothie|juice|lemonade|cooler|kombucha|tonic|flat white|cortado|macchiato|tisane|cascara|affogato/i;

export function isDrink(itemName: string, categoryTitle: string): boolean {
  if (FOOD_NAME.test(itemName)) return false;
  if (NON_DRINK_CATEGORY.test(categoryTitle)) return false;
  if (DRINK_CATEGORY.test(categoryTitle)) return true;
  return DRINK_NAME.test(itemName);
}

export function drinksOnly(menu: Menu): Menu {
  const seen = new Set<string>();
  const categories = menu.categories
    .map((c) => ({
      ...c,
      items: c.items.filter((i) => {
        if (seen.has(i.id) || !isDrink(i.name, c.title)) return false;
        seen.add(i.id);
        return true;
      }),
    }))
    .filter((c) => c.items.length);
  return { ...menu, categories };
}

function variantLabel(names: string[], i: number): string {
  const all = names.join(" ").toLowerCase();
  if (/milk|soy|oat|almond|lactose/.test(all)) return "Milk";
  if (/short|tall|grande|venti|small|medium|large|regular|picco|ml\b|oz\b/.test(all)) return "Size";
  return i === 0 ? "Choose one" : `Option ${i + 1}`;
}

function toOption(r: Raw): Option | null {
  const id = str(r.id ?? r.variationId ?? r.variation_id ?? r.choiceId ?? r.choice_id);
  if (!id) return null;
  return {
    id,
    name: str(r.name) || id,
    price: num(r.price),
    isDefault: num(r.default) === 1 || r.default === true || r.isDefault === true,
    inStock: r.inStock === undefined ? true : num(r.inStock) === 1 || r.inStock === true,
  };
}

// Legacy: one flat list, every entry tagged with its groupId.
function legacyGroups(list: Raw[]): VariantGroup[] {
  const byGroup = new Map<string, Option[]>();
  for (const r of list) {
    const g = str(r.groupId ?? r.group_id);
    const o = toOption(r);
    if (!g || !o) continue;
    byGroup.set(g, [...(byGroup.get(g) ?? []), o]);
  }
  return [...byGroup.entries()].map(([id, options], i) => ({
    id,
    label: variantLabel(options.map((o) => o.name), i),
    options,
  }));
}

// variantsV2 was not seen live (no sampled item had it). Read the two shapes
// it plausibly takes — groups with nested choices, or the legacy flat list —
// and refuse the item if neither fits, rather than guess at a cart payload.
function v2Groups(v: unknown): VariantGroup[] | null {
  const root = Array.isArray(v) ? (v as Raw[]) : arr((v as Raw)?.variantGroups ?? (v as Raw)?.groups);
  if (!root.length) return null;
  const nested = root.every((g) => Array.isArray(g.variations ?? g.options ?? g.choices));
  if (nested) {
    const groups = root.map((g, i) => {
      const options = arr(g.variations ?? g.options ?? g.choices).map(toOption).filter((o): o is Option => !!o);
      return {
        id: str(g.groupId ?? g.group_id ?? g.id),
        label: str(g.name ?? g.groupName) || variantLabel(options.map((o) => o.name), i),
        options,
      };
    });
    return groups.every((g) => g.id && g.options.length) ? groups : null;
  }
  const flat = legacyGroups(root);
  return flat.length ? flat : null;
}

// Drinks only, add-ons too: optional food upsells ("Best Paired With: Sea
// Salt Cookie") are dropped. A REQUIRED group keeps every option, so an item
// can never become unorderable because of this filter.
function addonGroups(list: Raw[]): AddonGroup[] {
  return list
    .map((g) => {
      const min = num(g.minAddons);
      const all = arr(g.choices).map(toOption).filter((o): o is Option => !!o);
      return {
        id: str(g.groupId ?? g.group_id),
        label: str(g.groupName ?? g.group_name) || "Add-ons",
        min,
        max: g.maxAddons === undefined ? -1 : num(g.maxAddons),
        options: min > 0 ? all : all.filter((o) => !FOOD_NAME.test(o.name)),
      };
    })
    .filter((g) => g.id && g.options.length);
}

export function parseItemDetails(item: MenuItem, raw: Raw | null): ItemDetails {
  const base: ItemDetails = {
    itemId: item.id,
    name: item.name,
    basePrice: item.price,
    variantFormat: null,
    variantGroups: [],
    addonGroups: [],
    unavailable: null,
  };
  if (!raw) {
    return item.hasVariants || item.hasAddons
      ? { ...base, unavailable: "Couldn't load this item's options from Swiggy — pick another for now" }
      : base;
  }
  base.basePrice = num(raw.price) || item.price;
  if (Array.isArray(raw.variations) && raw.variations.length) {
    base.variantFormat = "legacy";
    base.variantGroups = legacyGroups(raw.variations as Raw[]);
  } else if (raw.variantsV2) {
    const groups = v2Groups(raw.variantsV2);
    if (!groups) return { ...base, unavailable: "This item's options use a format the bot can't read yet" };
    base.variantFormat = "v2";
    base.variantGroups = groups;
  }
  base.addonGroups = addonGroups(arr(raw.addons));
  if (num(raw.inStock) === 0 && raw.inStock !== undefined) base.unavailable = "Out of stock right now";
  return base;
}

export async function getItemDetails(settings: Settings, item: MenuItem): Promise<ItemDetails> {
  if (!item.hasVariants && !item.hasAddons) return parseItemDetails(item, null);
  const key = `item:v${ITEM_CACHE_VERSION}:${settings.restaurantId}:${item.id}`;
  const hit = await cacheGet<ItemDetails>(key, ITEM_TTL_MIN);
  if (hit) return hit;
  let match: Raw | null = null;
  for (const offset of [0, 10]) {
    const { data } = await read("search_menu", {
      query: item.name.slice(0, 256),
      addressId: settings.addressId,
      restaurantIdOfAddedItem: settings.restaurantId,
      ...(offset ? { offset } : {}),
    });
    match = arr(data?.items).find((r) => str(r.menu_item_id ?? r.id) === item.id) ?? null;
    if (match || data?.hasMore !== true) break;
  }
  const details = parseItemDetails(item, match);
  if (!details.unavailable) await cachePut(key, details);
  return details;
}

export function findItem(menu: Menu, itemId: string): MenuItem | null {
  for (const c of menu.categories) {
    const hit = c.items.find((i) => i.id === itemId);
    if (hit) return hit;
  }
  return null;
}
