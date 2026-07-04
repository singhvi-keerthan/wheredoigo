// Server-only Swiggy Dineout integration point. Real access is OAuth 2.1 +
// PKCE against mcp.swiggy.com/dineout, gated behind Swiggy's Builders Club
// (apply at mcp.swiggy.com/builders/docs — no self-serve API key exists).
// Until that access is approved, every function below returns realistic mock
// data so Decide's "Swiggy" mode is fully built and demoable.
//
// Swapping to the real thing later: add `@modelcontextprotocol/sdk`, connect
// a Client over StreamableHTTPClientTransport to mcp.swiggy.com/dineout with
// the OAuth access token in headers, and replace each function body with the
// matching tool call — search_restaurants_dineout, get_restaurant_details,
// get_available_slots, book_table. The shapes below were written to match
// those tools' documented fields, so the call sites in the API routes and
// the client don't need to change.

export interface SwiggyRestaurant {
  id: string;
  name: string;
  cuisines: string[];
  area: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  priceForTwo: number | null;
}

export interface SwiggySlot {
  id: string;
  label: string; // "7:30 PM"
}

const MOCK_RESTAURANTS: SwiggyRestaurant[] = [
  { id: "sw-1", name: "Copper & Char", cuisines: ["north-indian", "mughlai"], area: "Indiranagar", address: "100 Feet Road, Indiranagar, Bengaluru", lat: 12.9719, lng: 77.6412, rating: 4.4, priceForTwo: 1800 },
  { id: "sw-2", name: "Coastal Curry House", cuisines: ["south-indian"], area: "Koramangala", address: "5th Block, Koramangala, Bengaluru", lat: 12.9352, lng: 77.6146, rating: 4.2, priceForTwo: 1200 },
  { id: "sw-3", name: "Nonna's Table", cuisines: ["italian"], area: "Indiranagar", address: "12th Main, Indiranagar, Bengaluru", lat: 12.978, lng: 77.6389, rating: 4.5, priceForTwo: 2200 },
  { id: "sw-4", name: "Szechuan Street", cuisines: ["chinese"], area: "HSR Layout", address: "27th Main, HSR Layout, Bengaluru", lat: 12.9121, lng: 77.6446, rating: 4.0, priceForTwo: 1400 },
  { id: "sw-5", name: "The Bengaluru Brewery", cuisines: ["continental"], area: "Church Street", address: "Church Street, Bengaluru", lat: 12.9757, lng: 77.6068, rating: 4.3, priceForTwo: 2000 },
  { id: "sw-6", name: "Bangkok Lane", cuisines: ["thai"], area: "Jayanagar", address: "4th Block, Jayanagar, Bengaluru", lat: 12.9254, lng: 77.5836, rating: 4.1, priceForTwo: 1600 },
  { id: "sw-7", name: "Seoul Kitchen", cuisines: ["korean"], area: "Koramangala", address: "6th Block, Koramangala, Bengaluru", lat: 12.9345, lng: 77.6224, rating: 4.3, priceForTwo: 1900 },
  { id: "sw-8", name: "Casa Mexicana", cuisines: ["mexican"], area: "Whitefield", address: "ITPL Main Road, Whitefield, Bengaluru", lat: 12.9698, lng: 77.7499, rating: 4.0, priceForTwo: 1500 },
];

// search_restaurants_dineout(location, cuisine?) — cuisine matches the same
// namespace values as the app's own tags, so results feel consistent with
// places you've saved yourself.
export async function searchDineoutRestaurants(query: {
  cuisine?: string;
  keyword?: string;
}): Promise<SwiggyRestaurant[]> {
  let results = MOCK_RESTAURANTS;
  if (query.cuisine) {
    results = results.filter((r) => r.cuisines.includes(query.cuisine!));
  }
  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    results = results.filter(
      (r) =>
        r.name.toLowerCase().includes(kw) ||
        r.cuisines.some((c) => c.includes(kw)) ||
        r.area.toLowerCase().includes(kw)
    );
  }
  return results;
}

// get_available_slots(restaurantId, partySize) — a short list of same-day slots.
export async function getAvailableSlots(_restaurantId: string): Promise<SwiggySlot[]> {
  return [
    { id: "s1", label: "7:00 PM" },
    { id: "s2", label: "7:30 PM" },
    { id: "s3", label: "8:00 PM" },
    { id: "s4", label: "8:30 PM" },
    { id: "s5", label: "9:00 PM" },
  ];
}

// book_table(restaurantId, slotId, partySize) — free bookings only, per Swiggy's
// current Dineout scope (no paid deals).
export async function bookTable(
  restaurantId: string,
  slotId: string,
  partySize: number
): Promise<{ bookingId: string; confirmed: true }> {
  return { bookingId: `mock-${restaurantId}-${slotId}-${partySize}-${Math.random().toString(36).slice(2, 8)}`, confirmed: true };
}
