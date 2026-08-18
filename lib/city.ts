import type { Place } from "./types";

// Which city a place is in — the label the masthead reads from, and the reason
// the app no longer claims everything is in Bengaluru.
//
// `place.city` is authoritative but only present on records the Google path
// touched (save + enrich write it from addressComponents.locality). Everything
// older, plus Swiggy and manual saves, has nothing but a formatted address —
// hence the parser below. Deliberately NO migration writes `city` onto old
// records: mass-stamping updatedAt across the library would beat newer remote
// records in the last-write-wins sync merge.

// An Indian address ends "…, <City>, <State> <PIN>, India" — but the PIN is
// dropped often enough that a shape-based rule ("strip a trailing segment with
// a postcode") returns Rajasthan as the city of "Jaipur, Rajasthan, India". A
// state is indistinguishable from a city by shape, so it takes a list.
const INDIA_ADMIN = new Set([
  "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa",
  "gujarat", "haryana", "himachal pradesh", "jharkhand", "karnataka", "kerala",
  "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland",
  "odisha", "orissa", "punjab", "rajasthan", "sikkim", "tamil nadu", "telangana",
  "tripura", "uttar pradesh", "uttarakhand", "west bengal",
  // union territories
  "andaman and nicobar islands", "chandigarh", "dadra and nagar haveli and daman and diu",
  "delhi", "jammu and kashmir", "ladakh", "lakshadweep", "puducherry", "pondicherry",
]);

// Names that are BOTH a city and its own administrative unit. Stripping these
// as "the state" would throw away the answer, so they survive the admin pass.
const CITY_ADMIN = new Set(["delhi", "chandigarh", "puducherry", "pondicherry"]);

// Trailing country segment. A list rather than a shape because "Bengaluru" and
// "India" look identical to a regex. An unlisted country would be mistaken for
// the city — the cost of being wrong here is a wrong masthead label, not lost
// data, and anything added through Google carries an authoritative `city`
// anyway, so this only ever runs on legacy, Swiggy, and manually pinned records.
const COUNTRIES = new Set([
  "india", "usa", "u.s.a.", "united states", "united states of america", "uk",
  "united kingdom", "england", "scotland", "wales", "ireland", "france", "germany",
  "spain", "portugal", "italy", "greece", "netherlands", "belgium", "switzerland",
  "austria", "sweden", "norway", "denmark", "finland", "poland", "czechia",
  "turkey", "uae", "united arab emirates", "qatar", "saudi arabia", "oman",
  "singapore", "malaysia", "thailand", "vietnam", "indonesia", "philippines",
  "japan", "south korea", "china", "hong kong", "taiwan", "nepal", "bhutan",
  "sri lanka", "bangladesh", "pakistan", "maldives", "australia", "new zealand",
  "canada", "mexico", "brazil", "argentina", "south africa", "kenya", "egypt", "morocco",
]);

// A segment carrying a postcode: "Karnataka 560038", "TX 78701", or a bare PIN.
const POSTCODE_TAIL = /(^|\s)[A-Z0-9-]*\d{4,6}([A-Z]{0,2})?$/i;

const norm = (s: string) => s.trim().toLowerCase();

// Best guess at the city from a formatted address. Returns "" rather than a
// wrong answer — a blank suffix in the masthead beats a confident lie.
export function cityFromAddress(address: string): string {
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "";

  const out = [...parts];
  // Peel the tail in order, never past the last remaining segment: for
  // "Delhi, India" the admin name IS the city, and there is nothing behind it.
  if (out.length > 1 && COUNTRIES.has(norm(out[out.length - 1]))) out.pop();
  while (out.length > 1 && POSTCODE_TAIL.test(out[out.length - 1])) out.pop();
  while (out.length > 1 && INDIA_ADMIN.has(norm(out[out.length - 1]))) out.pop();

  // Judge the last segment with any postcode taken off it — the peeling loops
  // above stop before emptying the list, so "Karnataka 560038, India" arrives
  // here whole and would otherwise pass as a city name.
  const last = (out[out.length - 1] ?? "").replace(POSTCODE_TAIL, "").trim();
  // Nothing but a state left ("Rajasthan, India") — say nothing rather than
  // label the place with its state.
  if (INDIA_ADMIN.has(norm(last)) && !CITY_ADMIN.has(norm(last))) return "";
  // A bare house number / postcode is not a city either.
  if (!/[A-Za-z]/.test(last)) return "";
  return last;
}

// The city of one place: Google's answer when we have it, else the address.
export function cityOf(p: Pick<Place, "city" | "address">): string {
  return (p.city ?? "").trim() || cityFromAddress(p.address);
}

// The masthead suffix. One city names it, two name both, more just count —
// past two, a list stops being readable at 11px and the number is the point.
export function cityLabel(places: Pick<Place, "city" | "address">[]): string {
  const counts = new Map<string, number>();
  for (const p of places) {
    const c = cityOf(p);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return "";
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (byCount.length === 1) return byCount[0][0];
  if (byCount.length === 2) return `${byCount[0][0]} & ${byCount[1][0]}`;
  return `${byCount.length} cities`;
}
