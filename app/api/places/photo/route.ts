import { crossOrigin, forbidden } from "@/lib/api-guard";

// Place Photo media (New) — fetches ONE photo for a place at save time and
// returns it as a data URL the client stores locally. This is the only metered
// Photos call; a saved place never re-fetches (enrich-once), so usage ≈ number
// of places added per month — far under the free bucket.
const NAME_RE = /^places\/[^/]+\/photos\/[^/]+$/;

export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return Response.json({ error: "no_key" }, { status: 200 });

  const name = new URL(request.url).searchParams.get("name");
  if (!name || !NAME_RE.test(name)) {
    return Response.json({ error: "bad_name" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800`,
      { headers: { "X-Goog-Api-Key": key } }
    );
    if (!res.ok) {
      return Response.json({ error: "photo_error", status: res.status }, { status: 200 });
    }
    const type = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return Response.json({ dataUrl: `data:${type};base64,${buf.toString("base64")}` });
  } catch {
    return Response.json({ error: "fetch_failed" }, { status: 200 });
  }
}
