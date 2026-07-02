import { FIELD_MASK_SEARCH, mapGooglePlace } from "@/lib/google";
import { crossOrigin, forbidden } from "@/lib/api-guard";

// Nearby Search (New), distance-ranked in a tight ~120m circle. Powers the
// "pin where I am" picker: reverse-match the GPS fix to the real places around
// it so what gets saved is a place, never raw coordinates (V1-SCOPE §3).
export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return Response.json({ error: "no_key", results: [] }, { status: 200 });

  let body: { lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }
  if (typeof body.lat !== "number" || typeof body.lng !== "number") {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK_SEARCH,
      },
      body: JSON.stringify({
        maxResultCount: 8,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: { center: { latitude: body.lat, longitude: body.lng }, radius: 120 },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return Response.json(
        { error: "places_error", status: res.status, detail, results: [] },
        { status: 200 }
      );
    }

    const data = await res.json();
    return Response.json({ results: (data.places ?? []).map(mapGooglePlace) });
  } catch {
    return Response.json({ error: "fetch_failed", results: [] }, { status: 200 });
  }
}
