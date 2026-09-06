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
