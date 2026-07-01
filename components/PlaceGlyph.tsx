"use client";

import {
  Utensils,
  UtensilsCrossed,
  Coffee,
  Martini,
  Landmark,
  Ticket,
  Mountain,
  IceCreamCone,
  Sandwich,
  Pizza,
  Soup,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { createElement, type CSSProperties } from "react";
import type { Place } from "@/lib/types";

// Category → monoline SVG glyph. Replaces the old emoji fallback so pins read as
// one cohesive, OS-independent icon set (the way Maps / Beli do it). Resolves by
// place "type", then falls back through cuisine, then a generic pin.
const TYPE_ICON: Record<string, LucideIcon> = {
  restaurant: Utensils,
  café: Coffee,
  bar: Martini,
  museum: Landmark,
  activity: Ticket,
  viewpoint: Mountain,
  dessert: IceCreamCone,
  "street-food": Sandwich,
};

const CUISINE_ICON: Record<string, LucideIcon> = {
  italian: Pizza,
  japanese: Soup,
};

export function glyphFor(place: Pick<Place, "tags">): LucideIcon {
  const type = place.tags.find((t) => t.namespace === "type")?.value;
  if (type && TYPE_ICON[type]) return TYPE_ICON[type];
  const cuisine = place.tags.find((t) => t.namespace === "cuisine")?.value;
  if (cuisine && CUISINE_ICON[cuisine]) return CUISINE_ICON[cuisine];
  if (cuisine) return UtensilsCrossed;
  return MapPin;
}

// Inherits colour via currentColor — set `color` on the parent (glyphs sit on the
// dark disc, so callers pass an off-white / secondary ink).
export default function PlaceGlyph({
  place,
  size = 18,
  strokeWidth = 2.1,
  className,
  style,
}: {
  place: Pick<Place, "tags">;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return createElement(glyphFor(place), { size, strokeWidth, className, style });
}
