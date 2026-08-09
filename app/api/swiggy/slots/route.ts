import { getAvailableSlots, SwiggyAuthError } from "@/lib/swiggy";
import { crossOrigin, forbidden } from "@/lib/api-guard";

// get_available_slots — same-day tables by default. `date` is optional and
// defaults to today in IST inside lib/swiggy (the server runs UTC).
export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let body: {
    restaurantId?: string;
    lat?: number;
    lng?: number;
    date?: string;
    guestCount?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }
  if (!body.restaurantId) {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  try {
    const results = await getAvailableSlots(body.restaurantId, {
      lat: body.lat,
      lng: body.lng,
      date: body.date,
      guestCount: body.guestCount,
    });
    return Response.json({ results });
  } catch (err) {
    if (err instanceof SwiggyAuthError) {
      return Response.json({ error: "swiggy_reauth", results: [] }, { status: 401 });
    }
    console.error("[swiggy] slots failed", err);
    return Response.json({ error: "swiggy_unavailable", results: [] }, { status: 502 });
  }
}
