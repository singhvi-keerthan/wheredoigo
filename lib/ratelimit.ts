// Fixed-window rate limiting, server-side, backed by the same Neon database the
// sync records live in.
//
// Why the database and not an in-process Map: every route here runs on Vercel
// lambdas, so a Map is per-instance. Ten warm instances means ten independent
// counters and a limit that is really 10x what it says — worthless against the
// two things this actually guards:
//
//   1. Phrase guessing at /api/sync. The owner key is sha256(phrase) and the
//      route hands over the library to whoever presents the right hash, so the
//      only thing standing between a dictionary and someone's places is how
//      many guesses per hour an address gets.
//   2. Swiggy call volume. The Integration Agreement's Cl. 4(viii) rate limits
//      have NO numbers in them — they are "notified from time to time" — and
//      Cl. 13.3(ii) makes breaching Cl. 4 an immediate-termination trigger.
//      Unknown ceiling plus termination on contact means throttling ourselves
//      well below any plausible limit is the only safe posture.
//
// Fixed window, not sliding: a sliding window needs per-request timestamps and
// this needs one row. The seam is that a caller can spend a full window's quota
// at the end of one window and again at the start of the next. At the limits
// used here that is 2x for a few seconds, which neither guard cares about.

import { neon } from "@neondatabase/serverless";

const url = process.env.SYNC_DATABASE_URL;
const sql = url ? neon(url) : null;

let schemaReady = false;
async function ensure(): Promise<void> {
  if (schemaReady || !sql) return;
  await sql`create table if not exists rate_limit (
    bucket text not null,
    window_start timestamptz not null,
    count int not null default 0,
    primary key (bucket, window_start))`;
  schemaReady = true;
}

// The caller's address as Vercel presents it. x-forwarded-for is a CSV with the
// real client first; everything after it is proxy hops we must not key on.
// Unknown becomes a single shared bucket rather than a free pass — an address
// we cannot read is exactly the caller we least want unthrottled.
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface LimitResult {
  ok: boolean;
  count: number;
  limit: number;
}

// One window's worth of attempts for `bucket`. Returns ok=false once `limit` is
// exceeded within `windowSec`.
//
// FAILS OPEN on a database error, and says so in the log. The alternative —
// failing closed — turns a Neon blip into a total outage of sync AND Swiggy for
// everyone, to prevent abuse that is not in progress. The bet is that a limiter
// outage is short and rare; the log line is what makes it visible if it isn't.
export async function rateLimit(bucket: string, limit: number, windowSec: number): Promise<LimitResult> {
  if (!sql) return { ok: true, count: 0, limit }; // no sync DB configured → nothing to guard
  try {
    await ensure();
    // Window start is computed in SQL (to_timestamp of a floored epoch) so every
    // lambda agrees on the boundary regardless of its own clock.
    const rows = (await sql`
      insert into rate_limit (bucket, window_start, count)
      values (${bucket}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}) * ${windowSec}), 1)
      on conflict (bucket, window_start) do update set count = rate_limit.count + 1
      returning count`) as { count: number }[];
    const count = rows[0]?.count ?? 0;
    // Opportunistic pruning — ~1 call in 200 clears anything older than a day.
    // A cron for this would be a scheduled job to maintain for a table that
    // holds a few hundred rows.
    if (Math.random() < 0.005) {
      await sql`delete from rate_limit where window_start < now() - interval '1 day'`;
    }
    return { ok: count <= limit, count, limit };
  } catch (err) {
    console.error("[ratelimit] check failed — FAILING OPEN", { bucket, err: String(err) });
    return { ok: true, count: 0, limit };
  }
}

export function tooMany(): Response {
  return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "60" } });
}

// ---- Token bucket ---------------------------------------------------------
//
// The fixed window above is the right shape for a guessing guard. It is the
// wrong shape for a ceiling somebody ELSE enforces on a rolling minute with a
// burst cap: sixty calls in the last second of one window and sixty in the
// first second of the next read as 120 to them, and sixty inside ten seconds
// breaks their burst rule however the minute is drawn. A bucket that refills
// at `rate` tokens a second and holds at most `capacity` is the rule they
// apply: sustained throughput is the rate, and no ten seconds can ever spend
// more than the capacity.
//
// One row per bucket, and a take is ONE statement: refill by the time elapsed,
// and spend a token only if a whole one is there (the DO UPDATE ... WHERE), so
// a refused take changes nothing and every lambda agrees on the count.
//
// `strict` FAILS CLOSED — a database error refuses the token. That is for the
// bucket metering calls to Swiggy, where the wrong side to err on is the one
// that trips a termination clause; the guessing guards above stay fail-open.
// With no database configured (dev, the test suite) an in-process bucket runs
// the same arithmetic: a real limit per instance, not a free pass.

export interface TokenOptions {
  rate: number; // tokens a second
  capacity: number; // the most a burst can spend
  strict?: boolean;
}

export interface TokenResult {
  ok: boolean;
  retryAfterSec: number; // 0 when ok
}

export function refill(tokens: number, elapsedSec: number, o: TokenOptions): number {
  return Math.min(o.capacity, tokens + Math.max(0, elapsedSec) * o.rate);
}

const local = new Map<string, { tokens: number; at: number }>();

export function takeLocalToken(bucket: string, o: TokenOptions, now = Date.now()): TokenResult {
  const cur = local.get(bucket) ?? { tokens: o.capacity, at: now };
  const have = refill(cur.tokens, (now - cur.at) / 1000, o);
  if (have >= 1) {
    local.set(bucket, { tokens: have - 1, at: now });
    return { ok: true, retryAfterSec: 0 };
  }
  local.set(bucket, { tokens: have, at: now });
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - have) / o.rate)) };
}

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady || !sql) return;
  await sql`create table if not exists token_bucket (
    bucket text primary key,
    tokens double precision not null,
    updated_at timestamptz not null)`;
  bucketReady = true;
}

export async function takeToken(bucket: string, o: TokenOptions): Promise<TokenResult> {
  if (!sql) return takeLocalToken(bucket, o);
  try {
    await ensureBucket();
    // Refill and spend in one statement. The WHERE on the update is the whole
    // point: with less than one token there is no update and no row comes
    // back, and the bucket is exactly as it was.
    const rows = (await sql`
      insert into token_bucket as b (bucket, tokens, updated_at)
      values (${bucket}, ${o.capacity - 1}, now())
      on conflict (bucket) do update
        set tokens = least(${o.capacity}::float8, b.tokens + extract(epoch from (now() - b.updated_at)) * ${o.rate}::float8) - 1,
            updated_at = now()
        where least(${o.capacity}::float8, b.tokens + extract(epoch from (now() - b.updated_at)) * ${o.rate}::float8) >= 1
      returning tokens`) as { tokens: number }[];
    if (rows.length > 0) return { ok: true, retryAfterSec: 0 };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(1 / o.rate)) };
  } catch (err) {
    if (o.strict) {
      console.error("[ratelimit] token take failed — FAILING CLOSED", { bucket, err: String(err) });
      return { ok: false, retryAfterSec: 5 };
    }
    console.error("[ratelimit] token take failed — FAILING OPEN", { bucket, err: String(err) });
    return { ok: true, retryAfterSec: 0 };
  }
}
