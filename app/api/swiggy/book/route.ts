import { bookTable } from "@/lib/swiggy";
import { crossOrigin, forbidden } from "@/lib/api-guard";

export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let body: { restaurantId?: string; slotId?: string; partySize?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.restaurantId || !body.slotId || !body.partySize) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const booking = await bookTable(body.restaurantId, body.slotId, body.partySize);
  return Response.json(booking);
}
