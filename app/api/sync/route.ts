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
  ownerExists,
  registerOwner,
  registerAlias,
  resolveAlias,
  type PlaceRow,
  type TagRow,
} from "@/lib/sync/db";

// Cross-device sync (records only; photo bytes go through /api/photo).
//
// Auth is a capability: the client computes sha256 of a secret — a recovery
// phrase, or a phone-and-password account — and sends it as
// `Authorization: Bearer <64-hex>`. That hash IS the owner key; every row is
// scoped to it. The secret itself never leaves the device.
//
//   GET  /api/sync?since=<iso>        → { places, tags } changed since `since`
//   GET  /api/sync?probe=1[&alt=hex]  → { exists, places, updatedAt } — NO records
//   POST /api/sync                    → upsert { places, tags }, last-write-wins
//
// ---- the two budgets -------------------------------------------------------
// A correct hash yields the whole library, so guessing is the attack and the
// number of guesses per hour is the whole defence. Rather than throttle everyone
// to guessing speed, requests are counted twice:
//
//   BUSY   — every call, per address. Stops one client hammering the database.
//   MISS   — only calls whose owner key names NO library, per address. This is
//            the guessing budget, and it is small.
//
// The asymmetry is the point: a real user's key exists, so they never spend a
// MISS and never notice the limit; a dictionary run spends nothing else.
//
// "Names no library" is `ownerExists`, NOT "returned no rows". Those came apart
// in three ways that all punished honest users: a brand-new library has no
// places, a library whose places were all deleted has none either, and a
// cursored pull with nothing new returns an empty array every time. All three
// used to be charged as guesses; the first two were also told their own key
// opened nothing.
const BUSY = { limit: 600, windowSec: 3600 };
const MISS = { limit: 20, windowSec: 3600 };

async function overBusy(request: Request): Promise<boolean> {
  const r = await rateLimit(`sync:busy:${clientIp(request)}`, BUSY.limit, BUSY.windowSec);
  if (!r.ok) logEvent("sync", "rate_limited", { budget: "busy", count: r.count, limit: r.limit });
  return !r.ok;
}

async function overMiss(request: Request): Promise<boolean> {
  const r = await rateLimit(`sync:miss:${clientIp(request)}`, MISS.limit, MISS.windowSec);
  if (!r.ok) logEvent("sync", "rate_limited", { budget: "miss", count: r.count, limit: r.limit });
  return !r.ok;
}

const HEX64 = /^[0-9a-f]{64}$/;

export async function GET(request: Request) {
  if (crossOrigin(request)) return forbidden();
  if (!syncConfigured) return Response.json({ error: "sync_disabled" }, { status: 503 });
  if (await overBusy(request)) return tooMany();

  const own = ownerFrom(request);
  if (!own) return unauthorized();

  const params = new URL(request.url).searchParams;

  // ---- probe ---------------------------------------------------------------
  // What the connect screen asks before it commits a device to a key: does this
  // open something, and how big is it. Counts only — no names, no records — so
  // it answers the question without being a way to read a library you could not
  // already read.
  //
  // `alt` carries a SECOND candidate key, which exists because a typed phrase
  // has two possible hashes (canonical and pre-normalisation legacy). Testing
  // both in one request means one guessing charge per attempt instead of two —
  // otherwise the users the legacy fallback was written for would burn the
  // budget twice per try and get locked out by their own recovery path.
  if (params.get("probe")) {
    const alt = params.get("alt");
    const candidates = [own, ...(alt && HEX64.test(alt) && alt !== own ? [alt] : [])];
    try {
      await ensureSchema();
      // A candidate is either an owner key itself, or a recovery phrase's hash
      // that points at one. Resolving the alias here is what lets someone who
      // has forgotten their password get back into the map their phone and
      // password used to open.
      const found = await Promise.all(
        candidates.map(async (c) => {
          const aliased = await resolveAlias(c);
          const real = aliased ?? c;
          return { owner: real, exists: await ownerExists(real) };
        })
      );
      const hits = found.filter((f) => f.exists);

      if (!hits.length) {
        if (await overMiss(request)) return tooMany();
        logEvent("sync", "probe", { owner: ownerTag(own), exists: false });
        return Response.json({ exists: false, owner: own, places: 0, updatedAt: null, ambiguous: false });
      }

      // Both candidates real means two different libraries answer to one typed
      // phrase. Prefer the LAST one — `alt` is the legacy hash, and a legacy
      // library can only have been made before this change, which is exactly
      // who is typing an old-format phrase. `ambiguous` travels so the UI can
      // say so rather than quietly picking for them.
      const chosen = hits[hits.length - 1]!.owner;
      const [places, updatedAt] = await Promise.all([countLive(chosen), latestUpdate(chosen)]);
      logEvent("sync", "probe", { owner: ownerTag(chosen), exists: true, places, ambiguous: hits.length > 1 });
      return Response.json({ exists: true, owner: chosen, places, updatedAt, ambiguous: hits.length > 1 });
    } catch {
      return Response.json({ error: "probe_failed" }, { status: 500 });
    }
  }

  const since = params.get("since");
  try {
    await ensureSchema();
    const [places, tags] = await Promise.all([pullPlaces(own, since), pullTags(own, since)]);
    // Charge a guess only when the KEY names nothing — checked, not inferred
    // from an empty result, and checked on the cursored path too. Inferring it
    // let a guesser skip the budget entirely by passing `?since=1970-…`.
    if (!places.length && !tags.length && !(await ownerExists(own))) {
      if (await overMiss(request)) return tooMany();
    }
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

  // Cheap rejection before the body is buffered. Vercel's own request ceiling is
  // ~4.5 MB, so anything above that never arrives here anyway — this number sits
  // under it so the app's error is the one the client sees, not the platform's.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.syncBodyBytes) {
    logEvent("sync", "body_too_large", { owner: ownerTag(own), bytes: declared });
    return Response.json({ error: "payload_too_large", limit: LIMITS.syncBodyBytes }, { status: 413 });
  }

  let body: { places?: PlaceRow[]; tags?: TagRow[]; phone?: string; alias?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const places = Array.isArray(body.places) ? body.places : [];
  const tags = Array.isArray(body.tags) ? body.tags : [];
  // Ten digits or nothing. Anything else is not written rather than stored
  // half-parsed, so the column only ever holds something dialable.
  const phone = typeof body.phone === "string" && /^\d{10}$/.test(body.phone) ? body.phone : null;
  const alias = typeof body.alias === "string" && HEX64.test(body.alias) ? body.alias : null;

  if (places.length > LIMITS.rowsPerPush || tags.length > LIMITS.rowsPerPush) {
    logEvent("sync", "batch_too_large", { owner: ownerTag(own), places: places.length, tags: tags.length });
    return Response.json({ error: "batch_too_large", limit: LIMITS.rowsPerPush }, { status: 413 });
  }

  try {
    await ensureSchema();

    // A push is what makes an owner real — including an empty one, which is how
    // a device registers a brand-new library before it holds anything.
    await registerOwner(own, phone);
    // The recovery phrase minted at sign-up, pointed at this owner. Registered
    // on the push rather than a route of its own so it lands in the same call
    // that creates the library, and never before it exists.
    if (alias && alias !== own) await registerAlias(alias, own);

    // Count only genuinely NEW places against the ceiling, and net off the
    // deletes in the same batch. Editing or deleting at the limit has to stay
    // possible: refusing a batch that removes one place and adds another would
    // block the very action that gets someone back under it.
    const incoming = places.filter((p) => !p.deleted_at).map((p) => p.id);
    if (incoming.length) {
      const known = await existingIds(own, incoming);
      const fresh = incoming.filter((id) => !known.has(id)).length;
      if (fresh > 0) {
        const removals = places.filter((p) => p.deleted_at).length;
        const live = await placeCount(own);
        if (live + fresh - removals > LIMITS.placesPerOwner) {
          logEvent("sync", "quota_places", { owner: ownerTag(own), live, fresh, removals, limit: LIMITS.placesPerOwner });
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
