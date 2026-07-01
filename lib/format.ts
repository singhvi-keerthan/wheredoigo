import type { Place } from "./types";
import { displayState, DISPLAY_STATE_META } from "./types";

// ₹ signs from Google price level (0–4) or your logged budget.
export function priceSigns(level: number | null): string {
  if (level == null) return "—";
  return "₹".repeat(Math.max(1, Math.min(4, level)));
}

export function budgetLabel(perPerson: number | null): string | null {
  if (perPerson == null) return null;
  return `₹${perPerson.toLocaleString("en-IN")}/person`;
}

// Once visited, your truth leads; Google stays as the cached reference.
export function leadRating(p: Place): { value: number | null; mine: boolean } {
  if (p.status === "visited" && p.myRating != null) {
    return { value: p.myRating, mine: true };
  }
  return { value: p.googleRating, mine: false };
}

export function leadPrice(p: Place): { label: string; mine: boolean } {
  if (p.status === "visited" && p.myBudgetPerPerson != null) {
    return { label: budgetLabel(p.myBudgetPerPerson)!, mine: true };
  }
  return { label: priceSigns(p.googlePriceLevel), mine: false };
}

export function stateMeta(p: Place) {
  return DISPLAY_STATE_META[displayState(p)];
}

export function directionsUrl(p: Place): string {
  if (p.googlePlaceId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      p.name
    )}&query_place_id=${p.googlePlaceId}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

export function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
