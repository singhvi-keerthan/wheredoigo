import type { Photo, Place } from "./types";
import { displayState, openStatus, DISPLAY_STATE_META } from "./types";

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
    // dir (not search) so the button actually starts navigation to the place.
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      p.name
    )}&destination_place_id=${p.googlePlaceId}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

// Your uploads first, Google's photo as fallback; photos still hydrating from
// IndexedDB (empty dataUrl) are skipped.
export function photosSorted(p: Place): Photo[] {
  return p.photos
    .filter((ph) => ph.dataUrl)
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "mine" ? -1 : 1));
}

export function coverPhoto(p: Place): Photo | null {
  return photosSorted(p)[0] ?? null;
}

export function relativeDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Traffic-light colours for the compact hours pill — the colour carries the
// open/closed meaning so the label itself can just be the time, not a word.
const HOURS_PILL_COLOR: Record<"open" | "closing_soon" | "closed", string> = {
  open: "oklch(0.6 0.15 150)",
  closing_soon: "oklch(0.78 0.16 85)",
  closed: "oklch(0.58 0.19 25)",
};

// Storefront-sign shorthand — drop the open side's AM/PM (openings are
// unambiguous enough without it) and keep the close side's, lowercase:
// 9am–9pm reads as "9-9pm", 11am–11pm as "11-11pm".
function hourOnly(t: { hour: number; minute: number }): string {
  const h = t.hour % 12 || 12;
  return t.minute === 0 ? `${h}` : `${h}:${String(t.minute).padStart(2, "0")}`;
}

function hourWithMeridiem(t: { hour: number; minute: number }): string {
  return `${hourOnly(t)}${t.hour < 12 ? "am" : "pm"}`;
}

// The compact hours pill — the place's actual timings (e.g. "11-9pm"), not a
// live countdown. Shows the window it's in right now if open, or the next
// one it opens into if closed; the pill's colour (not the label) carries
// open/closed/closing-soon. Null when hours are unknown.
export function hoursPill(p: Place, now?: Date): { label: string; color: string } | null {
  const status = openStatus(p.openingPeriods, now);
  if (!status) return null;
  return {
    label: status.close ? `${hourOnly(status.open)}-${hourWithMeridiem(status.close)}` : "24h",
    color: HOURS_PILL_COLOR[status.state],
  };
}
