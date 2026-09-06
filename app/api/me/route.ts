import { crossOrigin, forbidden, isSiteOwner, logEvent } from "@/lib/api-guard";

// "Is the device asking this Keerthan's own?" — a boolean, and nothing else.
//
// This exists because the browser CANNOT answer it for itself. The comparison
// is against PUBLIC_OWNER_HASH, and that value is a write bearer: /api/sync and
// /api/photo both accept it as authorization, so shipping it to a client — even
// a prefix of it — would hand out the keys to the library in exchange for
// picking an avatar. The hash stays on the server; the client sends the owner
// key it already holds and gets back one bit about itself.
//
// A device with no key, or the wrong one, gets `false`. There is nothing here
// worth guessing for: the answer is one bit and it grants nothing.

export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  const owner = isSiteOwner(request);
  if (owner) logEvent("me", "owner_confirmed");
  return Response.json(
    { owner },
    // Per-viewer and cheap to recompute; caching it anywhere shared would be a
    // way to serve one person's answer to somebody else.
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
