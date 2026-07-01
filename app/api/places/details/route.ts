import { FIELD_MASK_DETAIL, mapGooglePlace } from "@/lib/google";

// Place Details (New). Used to refresh rating / price / hours for an existing
// pin (the ~30-day enrichment rule). Server-side: key stays secret.
export async function GET(request: Request) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return Response.json({ error: "no_key" }, { status: 200 });

  const placeId = new URL(request.url).searchParams.get("placeId");
  if (!placeId) return Response.json({ error: "missing_placeId" }, { status: 400 });

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK_DETAIL,
        },
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return Response.json(
        { error: "places_error", status: res.status, detail },
        { status: 200 }
      );
    }

    const data = await res.json();
    return Response.json({ result: mapGooglePlace(data) });
  } catch {
    return Response.json({ error: "fetch_failed" }, { status: 200 });
  }
}
