import { crossOrigin, forbidden } from "@/lib/api-guard";

// Expand a shared Google Maps link — including the short maps.app.goo.gl form
// every phone actually shares — by following its redirects server-side, then
// pull whatever the final URL carries: the place name from /maps/place/<name>/
// and coordinates (!3d…!4d… is the place's own point; @lat,lng is just the
// viewport, kept as a fallback). No Places API call here; the client text-
// searches the extracted name to land on a real place id.
const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "maps.google.co.in",
  "www.google.co.in",
]);

export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();

  let url = "";
  try {
    url = String((await request.json())?.url ?? "").trim();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Response.json({ error: "bad_url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return Response.json({ error: "bad_url" }, { status: 400 });
  }

  try {
    const res = await fetch(parsed.href, { redirect: "follow" });
    let final = res.url || parsed.href;

    // Consent interstitial wraps the real URL in ?continue=
    if (final.includes("consent.google.")) {
      const cont = new URL(final).searchParams.get("continue");
      if (cont) final = cont;
    }
    const decoded = decodeURIComponent(final);

    const nameMatch = decoded.match(/\/maps\/place\/([^/@]+)/);
    const name = nameMatch ? nameMatch[1].replace(/\+/g, " ").trim() : null;

    const point = decoded.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    const viewport = decoded.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
    const coords = point ?? viewport;

    if (!name && !coords) {
      return Response.json({ name: null, lat: null, lng: null, error: "unresolved" });
    }
    return Response.json({
      name,
      lat: coords ? +coords[1] : null,
      lng: coords ? +coords[2] : null,
    });
  } catch {
    return Response.json({ name: null, lat: null, lng: null, error: "fetch_failed" });
  }
}
