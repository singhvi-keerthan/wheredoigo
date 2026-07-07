import { crossOrigin, forbidden } from "@/lib/api-guard";
import {
  ensureSchema,
  pullPlaces,
  pullTags,
  pushPlaces,
  pushTags,
  syncConfigured,
  type PlaceRow,
  type TagRow,
} from "@/lib/sync/db";

// Cross-device sync (records only; photo bytes are a later Blob phase).
//
// Auth is a passphrase capability: the client computes sha256(passphrase) and
// sends it as `Authorization: Bearer <64-hex>`. That hash IS the owner key —
// every row is scoped to it, so a library is reachable only with the exact
// passphrase. The plaintext passphrase never leaves the device.
//
//   GET  /api/sync?since=<iso>   → { places, tags } changed since `since` (all if omitted)
//   POST /api/sync               → upsert { places, tags } with a last-write-wins guard

function owner(request: Request): string | null {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!syncConfigured) return Response.json({ error: "sync_disabled" }, { status: 503 });
  const own = owner(request);
  if (!own) return Response.json({ error: "unauthorized" }, { status: 401 });

  const since = new URL(request.url).searchParams.get("since");
  try {
    await ensureSchema();
    const [places, tags] = await Promise.all([pullPlaces(own, since), pullTags(own, since)]);
    return Response.json({ places, tags });
  } catch {
    return Response.json({ error: "pull_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!syncConfigured) return Response.json({ error: "sync_disabled" }, { status: 503 });
  const own = owner(request);
  if (!own) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { places?: PlaceRow[]; tags?: TagRow[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const places = Array.isArray(body.places) ? body.places : [];
  const tags = Array.isArray(body.tags) ? body.tags : [];
  try {
    await ensureSchema();
    await Promise.all([pushPlaces(own, places), pushTags(own, tags)]);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "push_failed" }, { status: 500 });
  }
}
