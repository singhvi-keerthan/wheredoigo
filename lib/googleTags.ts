import { TAG_OPTIONS, type Tag, type TagNamespace } from "./types";

// Map Google Place `types` → our controlled tag vocabulary, so a place added
// from search is immediately searchable/filterable ("café", "italian") without a
// manual form. We only map confident, unambiguous types — the subjective
// namespaces (occasion, vibe) stay for the person to set. Google types come free
// in the search field mask (places.types), so this costs nothing extra.
const TYPE_MAP: Record<string, { ns: TagNamespace; value: string }> = {
  // → type
  restaurant: { ns: "type", value: "restaurant" },
  cafe: { ns: "type", value: "café" },
  coffee_shop: { ns: "type", value: "café" },
  bar: { ns: "type", value: "bar" },
  pub: { ns: "type", value: "bar" },
  wine_bar: { ns: "type", value: "bar" },
  night_club: { ns: "type", value: "bar" },
  museum: { ns: "type", value: "museum" },
  art_gallery: { ns: "type", value: "museum" },
  tourist_attraction: { ns: "type", value: "activity" },
  amusement_park: { ns: "type", value: "activity" },
  aquarium: { ns: "type", value: "activity" },
  zoo: { ns: "type", value: "activity" },
  park: { ns: "type", value: "activity" },
  bakery: { ns: "type", value: "dessert" },
  ice_cream_shop: { ns: "type", value: "dessert" },
  dessert_shop: { ns: "type", value: "dessert" },
  dessert_restaurant: { ns: "type", value: "dessert" },
  chocolate_shop: { ns: "type", value: "dessert" },
  meal_takeaway: { ns: "type", value: "street-food" },
  food_court: { ns: "type", value: "street-food" },
  fast_food_restaurant: { ns: "type", value: "street-food" },
  // → cuisine
  italian_restaurant: { ns: "cuisine", value: "italian" },
  chinese_restaurant: { ns: "cuisine", value: "chinese" },
  japanese_restaurant: { ns: "cuisine", value: "japanese" },
  thai_restaurant: { ns: "cuisine", value: "thai" },
  mexican_restaurant: { ns: "cuisine", value: "mexican" },
  korean_restaurant: { ns: "cuisine", value: "korean" },
  // → practical
  vegetarian_restaurant: { ns: "practical", value: "vegetarian" },
  vegan_restaurant: { ns: "practical", value: "vegan-options" },
};

export function tagsFromGoogleTypes(types: string[] | undefined): Tag[] {
  if (!types?.length) return [];
  const out: Tag[] = [];
  const seen = new Set<string>();
  for (const t of types) {
    const m = TYPE_MAP[t];
    if (!m) continue;
    const key = `${m.ns}:${m.value}`;
    if (seen.has(key)) continue;
    if (!(TAG_OPTIONS[m.ns] as string[]).includes(m.value)) continue; // stay in-vocab
    seen.add(key);
    out.push({ namespace: m.ns, value: m.value });
  }
  return out;
}

// Merge derived tags into an existing set without duplicating or clobbering the
// user's own tags — used to backfill a place that has none yet.
export function mergeTags(existing: Tag[], derived: Tag[]): Tag[] {
  const have = new Set(existing.map((t) => `${t.namespace}:${t.value}`));
  return [...existing, ...derived.filter((t) => !have.has(`${t.namespace}:${t.value}`))];
}
