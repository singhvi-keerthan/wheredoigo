import { bookTable } from "@/lib/swiggy";
import { swiggyFailure, swiggyGate } from "@/lib/swiggy-gate";

// book_table — free reservations only. The whole slot is required, not just an
// id: Swiggy wants slotId + itemId + reservationTime together, plus the same
// coordinates used for the search.
export async function POST(request: Request) {
  const gate = await swiggyGate(request, "swiggy/book");
  if (gate) return gate;

  let body: {
    restaurantId?: string;
    slot?: { slotId?: number; itemId?: string; reservationTime?: number };
    guestCount?: number;
    lat?: number;
    lng?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const slot = body.slot;
  if (
    !body.restaurantId ||
    !slot ||
    typeof slot.slotId !== "number" ||
    !slot.itemId ||
    typeof slot.reservationTime !== "number"
  ) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const booking = await bookTable(
      body.restaurantId,
      { slotId: slot.slotId, itemId: slot.itemId, reservationTime: slot.reservationTime },
      body.guestCount ?? 2,
      { lat: body.lat ?? 12.972, lng: body.lng ?? 77.61 }
    );
    return Response.json(booking);
  } catch (err) {
    return swiggyFailure(err, "swiggy/book", {});
  }
}
