import { TAG_OPTIONS, type Tag, type TagNamespace } from "./types";

// Map Google Place `types` → our controlled tag vocabulary, so a place added
// from search is immediately searchable/filterable ("café", "italian") without a
// manual form. We only map confident, unambiguous types — the subjective
// namespaces (occasion, vibe) stay for the person to set. Google types come free
// in the search field mask (places.types), so this costs nothing extra.
//
// Keys are Table A types from the Places API (New). Unknown keys are simply
// ignored, so an unmapped type costs nothing — but an UNDER-mapped table is not
// free: a place that matches nothing lands with no `type` tag at all, which
// means a generic pin and no Browse group. That is why the non-food half below
// is as dense as the food half.
const TYPE_MAP: Record<string, { ns: TagNamespace; value: string }> = {
  // → type · eat & drink
  restaurant: { ns: "type", value: "restaurant" },
  cafe: { ns: "type", value: "café" },
  coffee_shop: { ns: "type", value: "café" },
  tea_house: { ns: "type", value: "café" },
  bar: { ns: "type", value: "bar" },
  pub: { ns: "type", value: "bar" },
  wine_bar: { ns: "type", value: "bar" },
  bar_and_grill: { ns: "type", value: "bar" },
  night_club: { ns: "type", value: "bar" },
  bakery: { ns: "type", value: "dessert" },
  ice_cream_shop: { ns: "type", value: "dessert" },
  dessert_shop: { ns: "type", value: "dessert" },
  dessert_restaurant: { ns: "type", value: "dessert" },
  chocolate_shop: { ns: "type", value: "dessert" },
  confectionery: { ns: "type", value: "dessert" },
  meal_takeaway: { ns: "type", value: "street-food" },
  food_court: { ns: "type", value: "street-food" },
  fast_food_restaurant: { ns: "type", value: "street-food" },
  // → type · culture
  museum: { ns: "type", value: "museum" },
  art_gallery: { ns: "type", value: "museum" },
  art_museum: { ns: "type", value: "museum" },
  history_museum: { ns: "type", value: "museum" },
  planetarium: { ns: "type", value: "museum" },
  // → type · landmarks & heritage (a fort, a monument, a temple you visit)
  historical_landmark: { ns: "type", value: "landmark" },
  cultural_landmark: { ns: "type", value: "landmark" },
  historical_place: { ns: "type", value: "landmark" },
  monument: { ns: "type", value: "landmark" },
  castle: { ns: "type", value: "landmark" },
  sculpture: { ns: "type", value: "landmark" },
  church: { ns: "type", value: "landmark" },
  hindu_temple: { ns: "type", value: "landmark" },
  buddhist_temple: { ns: "type", value: "landmark" },
  mosque: { ns: "type", value: "landmark" },
  synagogue: { ns: "type", value: "landmark" },
  shinto_shrine: { ns: "type", value: "landmark" },
  // → type · viewpoints (the reason `viewpoint` existed in the vocabulary but
  // could never actually be assigned before)
  observation_deck: { ns: "type", value: "viewpoint" },
  scenic_spot: { ns: "type", value: "viewpoint" },
  mountain_peak: { ns: "type", value: "viewpoint" },
  // → type · parks, gardens & open nature
  park: { ns: "type", value: "park-garden" },
  city_park: { ns: "type", value: "park-garden" },
  state_park: { ns: "type", value: "park-garden" },
  national_park: { ns: "type", value: "park-garden" },
  garden: { ns: "type", value: "park-garden" },
  botanical_garden: { ns: "type", value: "park-garden" },
  dog_park: { ns: "type", value: "park-garden" },
  picnic_ground: { ns: "type", value: "park-garden" },
  plaza: { ns: "type", value: "park-garden" },
  hiking_area: { ns: "type", value: "park-garden" },
  nature_preserve: { ns: "type", value: "park-garden" },
  wildlife_refuge: { ns: "type", value: "park-garden" },
  woods: { ns: "type", value: "park-garden" },
  beach: { ns: "type", value: "park-garden" },
  lake: { ns: "type", value: "park-garden" },
  river: { ns: "type", value: "park-garden" },
  island: { ns: "type", value: "park-garden" },
  // → type · shows & screens
  performing_arts_theater: { ns: "type", value: "theatre" },
  movie_theater: { ns: "type", value: "theatre" },
  concert_hall: { ns: "type", value: "theatre" },
  philharmonic_hall: { ns: "type", value: "theatre" },
  opera_house: { ns: "type", value: "theatre" },
  amphitheatre: { ns: "type", value: "theatre" },
  live_music_venue: { ns: "type", value: "theatre" },
  comedy_club: { ns: "type", value: "theatre" },
  auditorium: { ns: "type", value: "theatre" },
  // → type · shopping
  shopping_mall: { ns: "type", value: "shopping" },
  market: { ns: "type", value: "shopping" },
  flea_market: { ns: "type", value: "shopping" },
  farmers_market: { ns: "type", value: "shopping" },
  department_store: { ns: "type", value: "shopping" },
  book_store: { ns: "type", value: "shopping" },
  clothing_store: { ns: "type", value: "shopping" },
  gift_shop: { ns: "type", value: "shopping" },
  jewelry_store: { ns: "type", value: "shopping" },
  thrift_store: { ns: "type", value: "shopping" },
  // → type · things to do
  tourist_attraction: { ns: "type", value: "activity" },
  amusement_park: { ns: "type", value: "activity" },
  amusement_center: { ns: "type", value: "activity" },
  water_park: { ns: "type", value: "activity" },
  aquarium: { ns: "type", value: "activity" },
  zoo: { ns: "type", value: "activity" },
  wildlife_park: { ns: "type", value: "activity" },
  visitor_center: { ns: "type", value: "activity" },
  bowling_alley: { ns: "type", value: "activity" },
  video_arcade: { ns: "type", value: "activity" },
  casino: { ns: "type", value: "activity" },
  karaoke: { ns: "type", value: "activity" },
  ice_skating_rink: { ns: "type", value: "activity" },
  golf_course: { ns: "type", value: "activity" },
  adventure_sports_center: { ns: "type", value: "activity" },
  skateboard_park: { ns: "type", value: "activity" },
  ferris_wheel: { ns: "type", value: "activity" },
  stadium: { ns: "type", value: "activity" },
  arena: { ns: "type", value: "activity" },
  // → cuisine
  italian_restaurant: { ns: "cuisine", value: "italian" },
  chinese_restaurant: { ns: "cuisine", value: "chinese" },
  japanese_restaurant: { ns: "cuisine", value: "japanese" },
  thai_restaurant: { ns: "cuisine", value: "thai" },
  mexican_restaurant: { ns: "cuisine", value: "mexican" },
  korean_restaurant: { ns: "cuisine", value: "korean" },
  // → staple (the specific dish, when Google names it unambiguously)
  pizza_restaurant: { ns: "staple", value: "pizza" },
  hamburger_restaurant: { ns: "staple", value: "burger" },
  ramen_restaurant: { ns: "staple", value: "ramen" },
  sushi_restaurant: { ns: "staple", value: "sushi" },
  sandwich_shop: { ns: "staple", value: "sandwich" },
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
