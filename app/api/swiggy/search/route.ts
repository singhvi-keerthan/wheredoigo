import { after } from "next/server";
import {
  searchDineoutRestaurants,
  SwiggyAuthError,
  SwiggyRateLimitError,
  type DineoutSearchQuery,
} from "@/lib/swiggy";
import { swiggyFailure, swiggyGate } from "@/lib/swiggy-gate";
import { logAsk } from "@/lib/askLog";

// The ask log keeps a CODE for a failure, never Swiggy's own message — that
// text is theirs, and the code is what a reader needs anyway.
function failureCode(err: unknown): string {
  if (err instanceof SwiggyAuthError) return "swiggy_reauth";
  if (err instanceof SwiggyRateLimitError) return "swiggy_busy";
  if (err instanceof Error && err.message === "swiggy_unparsable_search") return err.message;
  return "swiggy_unavailable";
}

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

  const t0 = Date.now();
  const terms = Array.isArray(body.terms) ? body.terms.filter((t): t is string => typeof t === "string") : [];
  const facets = Array.isArray(body.facets)
    ? body.facets.filter((t): t is string => typeof t === "string").slice(0, 3)
    : [];
  // What went out, for the ask log (lib/askLog.ts) — never what came back.
  // Written after the response, so it costs the search nothing.
  const trail = { route: "search" as const, terms, facets, area: body.area, lat: body.lat, lng: body.lng };
  try {
    const { results, dropped, searched, attempted } = await searchDineoutRestaurants({ ...body, terms, facets });
    const ms = Date.now() - t0;
    after(() => logAsk({ ...trail, searched, results: results.length, dropped, ms }));
    // `dropped` and `searched` travel to the client so an empty deck can say
    // WHY it is empty — "Swiggy had nothing for rooftop" is a different message
    // from "your filter hid everything", and the UI used to show the second one
    // for both.
    return Response.json({ results, dropped, searched, attempted });
  } catch (err) {
    const ms = Date.now() - t0;
    after(() => logAsk({ ...trail, ms, error: failureCode(err) }));
    // Reconnect (401) and back off (429) are routine states the deck names;
    // anything else is the outage — see swiggyFailure.
    return swiggyFailure(err, "swiggy/search", { results: [] });
  }
}
