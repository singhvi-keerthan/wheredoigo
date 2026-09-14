import { searchDineoutRestaurants, type DineoutSearchQuery } from "@/lib/swiggy";
import { swiggyFailure, swiggyGate } from "@/lib/swiggy-gate";

// Decide's "Swiggy" mode — browse Swiggy Dineout's own catalog, independent of
// anything you've saved. Backed by search_restaurants_dineout when
// SWIGGY_MCP_TOKEN is set, mock data otherwise (see lib/swiggy.ts).
//
// lat/lng are the *user's* coordinates: the tool requires a location and the
// same pair has to be echoed to slots/book later, so the client sends it.
// areaLat/areaLng are the geocoded centre of the asked locality, when there is
// one — the concept searches run there instead.
export async function POST(request: Request) {
  const gate = await swiggyGate(request, "swiggy/search");
  if (gate) return gate;

  let body: Partial<DineoutSearchQuery>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  try {
    const { results, dropped, searched, attempted } = await searchDineoutRestaurants({
      ...body,
      terms: Array.isArray(body.terms) ? body.terms.filter((t) => typeof t === "string") : [],
    });
    // `dropped` and `searched` travel to the client so an empty deck can say
    // WHY it is empty — "Swiggy had nothing for rooftop" is a different message
    // from "your filter hid everything", and the UI used to show the second one
    // for both.
    return Response.json({ results, dropped, searched, attempted });
  } catch (err) {
    // Reconnect (401) and back off (429) are routine states the deck names;
    // anything else is the outage — see swiggyFailure.
    return swiggyFailure(err, "swiggy/search", { results: [] });
  }
}
