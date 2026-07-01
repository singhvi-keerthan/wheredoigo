import { FIELD_MASK_SEARCH, mapGooglePlace } from "@/lib/google";

// Text Search (New). Turns a typed place name into real candidates with
// coordinates + Google rating/price/hours. Server-side: key stays secret.
export async function POST(request: Request) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return Response.json({ error: "no_key", results: [] }, { status: 200 });
  }

  let body: { query?: string; lat?: number; lng?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request", results: [] }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) return Response.json({ results: [] });

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK_SEARCH,
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 8,
        ...(typeof body.lat === "number" && typeof body.lng === "number"
          ? {
              locationBias: {
                circle: {
                  center: { latitude: body.lat, longitude: body.lng },
                  radius: 30000,
                },
              },
            }
          : {}),
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
    const results = (data.places ?? []).map(mapGooglePlace);
    return Response.json({ results });
  } catch {
    return Response.json({ error: "fetch_failed", results: [] }, { status: 200 });
  }
}
