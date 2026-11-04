// Pure: turn everyone's picks into one Swiggy cart, and validate a pick
// against the item's real options. No I/O here so it is all unit-tested.

import { createHash } from "node:crypto";
import type { Choice, ItemDetails, PersonPick, Selection } from "./types";

export interface CartItem {
  menu_item_id: string;
  quantity: number;
  variants?: { group_id: string; variation_id: string }[];
  variantsV2?: { group_id: string; variation_id: string }[];
  addons?: { group_id: string; choice_id: string }[];
}

const sortSel = (s: Selection[]) =>
  [...s].sort((a, b) => (a.groupId + a.optionId).localeCompare(b.groupId + b.optionId));

// Two people with the identical drink become quantity 2 — one cart line.
export function lineKey(c: Choice): string {
  return JSON.stringify([
    c.itemId,
    sortSel(c.variants).map((v) => [v.groupId, v.optionId]),
    sortSel(c.addons).map((a) => [a.groupId, a.optionId]),
  ]);
}

export function buildCartItems(picks: PersonPick[]): CartItem[] {
  const lines = new Map<string, { choice: Choice; quantity: number }>();
  for (const p of picks) {
    const key = lineKey(p.choice);
    const line = lines.get(key);
    if (line) line.quantity += 1;
    else lines.set(key, { choice: p.choice, quantity: 1 });
  }
  return [...lines.values()].map(({ choice, quantity }) => {
    const item: CartItem = { menu_item_id: choice.itemId, quantity };
    const variants = sortSel(choice.variants).map((v) => ({ group_id: v.groupId, variation_id: v.optionId }));
    if (variants.length) {
      if (choice.variantFormat === "v2") item.variantsV2 = variants;
      else item.variants = variants;
    }
    const addons = sortSel(choice.addons).map((a) => ({ group_id: a.groupId, choice_id: a.optionId }));
    if (addons.length) item.addons = addons;
    return item;
  });
}

// Notes go to the restaurant as one string; Swiggy gives one field per order.
export function restaurantNote(picks: PersonPick[]): string | undefined {
  const parts = picks
    .filter((p) => p.choice.note?.trim())
    .map((p) => `${p.personName.split(" ")[0]}: ${p.choice.note!.trim()}`);
  if (!parts.length) return undefined;
  return parts.join("; ").slice(0, 250);
}

// Fingerprint of exactly who wants what. Review stores it; Place refuses if it
// changed since, so nobody's late edit is silently dropped or silently paid for.
export function picksHash(picks: PersonPick[]): string {
  const canon = [...picks]
    .sort((a, b) => a.personId - b.personId)
    .map((p) => [p.personId, lineKey(p.choice), p.choice.note ?? ""]);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex").slice(0, 16);
}

export type ValidateResult = { ok: true; choice: Choice } | { ok: false; error: string };

// The browser sends option ids; the server rebuilds the Choice from the item's
// real option list, so names and prices can't be forged and a stale option
// (removed from the menu) is rejected instead of breaking the cart at 11:30.
export function validateChoice(
  details: ItemDetails,
  picked: { variants: Record<string, string>; addons: Record<string, string[]>; note?: string | null }
): ValidateResult {
  if (details.unavailable) return { ok: false, error: details.unavailable };

  const variants: Selection[] = [];
  for (const g of details.variantGroups) {
    const wanted = picked.variants[g.id];
    const opt =
      g.options.find((o) => o.id === wanted) ??
      (wanted ? undefined : g.options.find((o) => o.isDefault) ?? g.options[0]);
    if (!opt) return { ok: false, error: `Pick an option for ${g.label}` };
    if (!opt.inStock) return { ok: false, error: `${opt.name} is out of stock` };
    variants.push({ groupId: g.id, optionId: opt.id, name: opt.name, price: opt.price });
  }

  const addons: Selection[] = [];
  for (const g of details.addonGroups) {
    const ids = [...new Set(picked.addons[g.id] ?? [])];
    if (ids.length < g.min) return { ok: false, error: `Pick at least ${g.min} for ${g.label}` };
    if (g.max >= 0 && ids.length > g.max) return { ok: false, error: `Pick at most ${g.max} for ${g.label}` };
    for (const id of ids) {
      const opt = g.options.find((o) => o.id === id);
      if (!opt) return { ok: false, error: `That option is no longer on the menu (${g.label})` };
      if (!opt.inStock) return { ok: false, error: `${opt.name} is out of stock` };
      addons.push({ groupId: g.id, optionId: opt.id, name: opt.name, price: opt.price });
    }
  }
  for (const id of Object.keys(picked.addons)) {
    if (!details.addonGroups.some((g) => g.id === id)) return { ok: false, error: "Unknown add-on group" };
  }

  const note = picked.note?.trim().slice(0, 80) || null;
  const unitPrice =
    details.basePrice + variants.reduce((s, v) => s + v.price, 0) + addons.reduce((s, a) => s + a.price, 0);
  return {
    ok: true,
    choice: {
      itemId: details.itemId,
      name: details.name,
      variantFormat: details.variantFormat,
      variants,
      addons,
      unitPrice,
      note,
    },
  };
}

export function describeChoice(c: Choice): string {
  const extras = [...c.variants, ...c.addons].map((s) => s.name);
  return extras.length ? `${c.name} (${extras.join(", ")})` : c.name;
}
