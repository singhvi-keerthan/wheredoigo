import { publicOwner, rawPublicPlace } from "@/lib/public";

// Photo bytes for the share view (/go), addressed by place + photo id.
//
// The private Blob store has no public URL, and /api/photo — the app's own
// reader — demands the passphrase bearer, which a visitor does not have and
// must never be given. So this route is the one public door to the bytes, and
// it is deliberately narrow: the caller names an id, never a URL, and the
// server resolves it against PUBLIC_OWNER_HASH's records only. There is no
// input that can point it at another owner's blob.
//
//   GET /api/go/photo/<placeId>/<photoId>
//
// Path segments rather than a query string so next/image can allowlist it
// exactly (images.localPatterns with search: "") instead of being opened up to
// every query string on the route.

// An hour, not a year. Long enough that a shared link's second load is free,
// short enough that a photo Keerthan deletes stops being served to strangers
// the same afternoon.
const CACHE = "public, max-age=3600, stale-while-revalidate=86400";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function notFound() {
  return Response.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ place: string; photo: string }> }
) {
  if (!publicOwner) return notFound();

  const { place: placeId, photo: photoId } = await ctx.params;
  if (!placeId || !photoId) return notFound();

  const place = await rawPublicPlace(placeId);
  const photo = place?.photos?.find((ph) => ph.id === photoId);
  if (!photo) return notFound();

  // Own photo: bytes are in private Blob. The path check is belt-and-braces —
  // the URL came out of this owner's own record — but it means a corrupted or
  // hand-edited record still cannot make this route fetch someone else's blob.
  if (photo.blobUrl) {
    if (!TOKEN) return notFound();
    let path: string;
    try {
      path = new URL(photo.blobUrl).pathname;
    } catch {
      return notFound();
    }
    if (!path.startsWith(`/${publicOwner}/`)) return notFound();
    try {
      // Same read the app's own /api/photo does — a private blob is readable
      // with the store token on the Authorization header.
      const res = await fetch(photo.blobUrl, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!res.ok) return notFound();
      return new Response(res.body, {
        headers: {
          "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
          "Cache-Control": CACHE,
        },
      });
    } catch {
      return notFound();
    }
  }

  // Google photo: fetched once at save time and stored as base64 on the record
  // (lib/places.ts), so serving it costs no Places quota — and decoding it here
  // keeps a multi-hundred-KB data URL out of the page's HTML.
  const m = /^data:([^;,]+);base64,(.+)$/.exec(photo.dataUrl ?? "");
  if (!m) return notFound();
  return new Response(Buffer.from(m[2], "base64"), {
    headers: { "Content-Type": m[1], "Cache-Control": CACHE },
  });
}
