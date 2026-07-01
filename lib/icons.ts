import type { Place } from "./types";

// Emoji per place "type" tag — used as the pin glyph when there's no photo yet,
// and as a small affordance throughout. Falls back through cuisine, then a pin.
const TYPE_EMOJI: Record<string, string> = {
  restaurant: "🍽️",
  café: "☕",
  bar: "🍸",
  museum: "🏛️",
  activity: "🎟️",
  viewpoint: "🌆",
  dessert: "🍰",
  "street-food": "🌮",
};

const CUISINE_EMOJI: Record<string, string> = {
  italian: "🍝",
  "south-indian": "🥘",
  "north-indian": "🍛",
  japanese: "🍜",
  chinese: "🥡",
  thai: "🍲",
  mexican: "🌮",
  continental: "🍽️",
  korean: "🍚",
  mughlai: "🍢",
};

export function placeEmoji(place: Pick<Place, "tags">): string {
  const type = place.tags.find((t) => t.namespace === "type")?.value;
  if (type && TYPE_EMOJI[type]) return TYPE_EMOJI[type];
  const cuisine = place.tags.find((t) => t.namespace === "cuisine")?.value;
  if (cuisine && CUISINE_EMOJI[cuisine]) return CUISINE_EMOJI[cuisine];
  return "📍";
}
