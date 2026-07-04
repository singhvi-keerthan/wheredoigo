import { searchDineoutRestaurants } from "@/lib/swiggy";
import { crossOrigin, forbidden } from "@/lib/api-guard";

// Decide's "Swiggy" mode — browse Swiggy Dineout's own catalog, independent of
// anything you've saved. Mocked until Builders Club access is approved (see
// lib/swiggy.ts); the shape matches search_restaurants_dineout so swapping in
// the real MCP call later doesn't change this route's contract.
export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let body: { cuisine?: string; keyword?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  const results = await searchDineoutRestaurants(body);
  return Response.json({ results });
}
