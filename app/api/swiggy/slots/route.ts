import { getAvailableSlots } from "@/lib/swiggy";
import { crossOrigin, forbidden } from "@/lib/api-guard";

export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let body: { restaurantId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }
  if (!body.restaurantId) {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  const results = await getAvailableSlots(body.restaurantId);
  return Response.json({ results });
}
