import { getAvailableSlots } from "@/lib/swiggy";
import { swiggyFailure, swiggyGate } from "@/lib/swiggy-gate";

// get_available_slots — same-day tables by default. `date` is optional and
// defaults to today in IST inside lib/swiggy (the server runs UTC).
export async function POST(request: Request) {
  const gate = await swiggyGate(request, "swiggy/slots");
  if (gate) return gate;

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
    return swiggyFailure(err, "swiggy/slots", { results: [] });
  }
}
