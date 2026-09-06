import { crossOrigin, forbidden, unauthorized, ownerFrom, ownerTag, logEvent } from "@/lib/api-guard";
import { rateLimit, clientIp, tooMany } from "@/lib/ratelimit";
import { LIMITS, placeCount } from "@/lib/quota";
import {
  ensureSchema,
  pullPlaces,
  pullTags,
  pushPlaces,
  pushTags,
  syncConfigured,
  countLive,
  latestUpdate,
  existingIds,
  type PlaceRow,
  type TagRow,
} from "@/lib/sync/db";

// Cross-device sync (records only; photo bytes go through /api/photo).
//
// Auth is a passphrase capability: the client computes sha256(phrase) and sends
// it as `Authorization: Bearer <64-hex>`. That hash IS the owner key — every row
// is scoped to it, so a library is reachable only with the exact phrase. The
// plaintext never leaves the device.
//
//   GET  /api/sync?since=<iso>   → { places, tags } changed since `since`
//   GET  /api/sync?probe=1       → { exists, places, updatedAt } — NO records
//   POST /api/sync               → upsert { places, tags }, last-write-wins
//
// ---- the two budgets -------------------------------------------------------
// A correct hash yields the whole library, so guessing is the attack and the
// number of guesses per hour is the whole defence. Rather than throttle everyone
// to guessing speed, requests are counted twice:
//
//   BUSY   — every call, per address. Stops one client hammering the database.
//   MISS   — only calls whose owner key matched NOTHING, per address. This is
//            the guessing budget, and it is small.
//
// The asymmetry is the point: a real user's key exists, so after their first
// connect they never spend a MISS again and never notice the limit. Someone
// working through a dictionary generates nothing but misses and gets 20 an hour.
// A new library's first connect is one miss, which fits comfortably.
const BUSY = { limit: 600, windowSec: 3600 };
const MISS = { limit: 20, windowSec: 3600 };

async function overBusy(request: Request): Promise<boolean> {
  const r = await rateLimit(`sync:busy:${clientIp(request)}`, BUSY.limit, BUSY.windowSec);
  if (!r.ok) logEvent("sync", "rate_limited", { budget: "busy", count: r.count, limit: r.limit });
  return !r.ok;
}

// Charged AFTER a lookup comes back empty. Returns true when the address has
// spent its guessing budget.
async function overMiss(request: Request): Promise<boolean> {
  const r = await rateLimit(`sync:miss:${clientIp(request)}`, MISS.limit, MISS.windowSec);
  if (!r.ok) logEvent("sync", "rate_limited", { budget: "miss", count: r.count, limit: r.limit });
  return !r.ok;
}

export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!syncConfigured) return Response.json({ error: "sync_disabled" }, { status: 503 });
  if (await overBusy(request)) return tooMany();

  const own = ownerFrom(request);
  if (!own) return unauthorized();

  const params = new URL(request.url).searchParams;

  // ---- probe ---------------------------------------------------------------
  // What the connect screen asks before it commits a device to a phrase: does
  // this phrase open something, and how big is it. Deliberately returns counts
  // and nothing else — no names, no records — so it can answer the question
  // without being a way to read a library you cannot already read.
  if (params.get("probe")) {
    try {
      await ensureSchema();
      const places = await countLive(own);
      if (places === 0 && (await overMiss(request))) return tooMany();
      const updatedAt = places > 0 ? await latestUpdate(own) : null;
      logEvent("sync", "probe", { owner: ownerTag(own), exists: places > 0, places });
      return Response.json({ exists: places > 0, places, updatedAt });
    } catch {
      return Response.json({ error: "probe_failed" }, { status: 500 });
    }
  }

  const since = params.get("since");
  try {
    await ensureSchema();
    const [places, tags] = await Promise.all([pullPlaces(own, since), pullTags(own, since)]);
    // A full pull (no cursor) that returns nothing is an owner key that opens
    // nothing — the same signal as a failed probe, so it costs the same budget.
    // A *delta* pull returning nothing is just a quiet library, and is free.
    if (!since && places.length === 0 && (await overMiss(request))) return tooMany();
    return Response.json({ places, tags });
  } catch {
    logEvent("sync", "pull_failed", { owner: ownerTag(own) });
    return Response.json({ error: "pull_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!syncConfigured) return Response.json({ error: "sync_disabled" }, { status: 503 });
  if (await overBusy(request)) return tooMany();

  const own = ownerFrom(request);
  if (!own) return unauthorized();

  // Cheap rejection before the body is read into memory. Content-Length can be
  // absent or lie, so the row caps below are the real ceiling; this only stops
  // an obviously oversized upload from being buffered at all.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.syncBodyBytes) {
    logEvent("sync", "body_too_large", { owner: ownerTag(own), bytes: declared });
    return Response.json({ error: "payload_too_large", limit: LIMITS.syncBodyBytes }, { status: 413 });
  }

  let body: { places?: PlaceRow[]; tags?: TagRow[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const places = Array.isArray(body.places) ? body.places : [];
  const tags = Array.isArray(body.tags) ? body.tags : [];

  if (places.length > LIMITS.rowsPerPush || tags.length > LIMITS.rowsPerPush) {
    logEvent("sync", "batch_too_large", { owner: ownerTag(own), places: places.length, tags: tags.length });
    return Response.json({ error: "batch_too_large", limit: LIMITS.rowsPerPush }, { status: 413 });
  }

  try {
    await ensureSchema();

    // Count only genuinely NEW places against the ceiling. Editing or deleting
    // something already stored has to stay possible at the limit — otherwise
    // hitting it would also lock someone out of clearing space, which is the
    // one action that gets them back under it.
    const incoming = places.filter((p) => !p.deleted_at).map((p) => p.id);
    if (incoming.length) {
      const known = await existingIds(own, incoming);
      const fresh = incoming.filter((id) => !known.has(id)).length;
      if (fresh > 0) {
        const live = await placeCount(own);
        if (live + fresh > LIMITS.placesPerOwner) {
          logEvent("sync", "quota_places", { owner: ownerTag(own), live, fresh, limit: LIMITS.placesPerOwner });
          return Response.json({ error: "quota_exceeded", limit: LIMITS.placesPerOwner, used: live }, { status: 507 });
        }
      }
    }

    await Promise.all([pushPlaces(own, places), pushTags(own, tags)]);
    logEvent("sync", "push", { owner: ownerTag(own), places: places.length, tags: tags.length });
    return Response.json({ ok: true });
  } catch {
    logEvent("sync", "push_failed", { owner: ownerTag(own) });
    return Response.json({ error: "push_failed" }, { status: 500 });
  }
}
