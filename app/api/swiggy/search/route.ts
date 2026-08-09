import { searchDineoutRestaurants, SwiggyAuthError } from "@/lib/swiggy";
import { crossOrigin, forbidden } from "@/lib/api-guard";

// Decide's "Swiggy" mode — browse Swiggy Dineout's own catalog, independent of
// anything you've saved. Backed by search_restaurants_dineout when
// SWIGGY_MCP_TOKEN is set, mock data otherwise (see lib/swiggy.ts).
//
// lat/lng are the *user's* coordinates: the tool requires a location and the
// same pair has to be echoed to slots/book later, so the client sends it.
export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let body: { cuisine?: string; keyword?: string; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  try {
    const { results, dropped } = await searchDineoutRestaurants(body);
    return Response.json({ results, dropped });
  } catch (err) {
    // Tokens last 5 days and can't be refreshed, so this is a routine state:
    // the deck shows a "reconnect Swiggy" note rather than an error.
    if (err instanceof SwiggyAuthError) {
      return Response.json({ error: "swiggy_reauth", results: [] }, { status: 401 });
    }
    console.error("[swiggy] search failed", err);
    return Response.json({ error: "swiggy_unavailable", results: [] }, { status: 502 });
  }
}
