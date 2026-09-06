import { getDineoutRestaurantDetails, SwiggyAuthError, type SwiggyRestaurant } from "@/lib/swiggy";
import { swiggyGate } from "@/lib/swiggy-gate";

// Active-card enrichment for Swipe Mode. Search stays one cheap catalog call;
// details are fetched only for the Swiggy card the user is actually looking at.
export async function POST(request: Request) {
  const gate = await swiggyGate(request, "swiggy/details");
  if (gate) return gate;

  let body: { restaurant?: SwiggyRestaurant; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", restaurant: null }, { status: 400 });
  }
  if (!body.restaurant?.id) {
    return Response.json({ error: "bad_request", restaurant: null }, { status: 400 });
  }

  try {
    const restaurant = await getDineoutRestaurantDetails(body.restaurant, {
      lat: body.lat,
      lng: body.lng,
    });
    return Response.json({ restaurant });
  } catch (err) {
    if (err instanceof SwiggyAuthError) {
      return Response.json({ error: "swiggy_reauth", restaurant: null }, { status: 401 });
    }
    console.error("[swiggy] details failed", err);
    return Response.json({ error: "swiggy_unavailable", restaurant: null }, { status: 502 });
  }
}
