import { neon } from "@neondatabase/serverless";

// One row per ask, so "romantic spot for date gave me rubbish" can be read
// back instead of reconstructed. Two routes write here: Ask (the prompt and
// what the model made of it) and the Swiggy search (the terms that went out
// and how many rows came back). Never the rows themselves: restaurant names
// and ids are Swiggy content, which the integration agreement makes deletable
// on termination — the reason the impressions table was withdrawn. The rows
// can be replayed from the terms, which is what this makes possible.
//
// Lives in the sync database (SYNC_DATABASE_URL), like the rate limiter. Best
// effort: a write that fails or stalls costs the ask a log line, never the
// answer. The routes call this inside Next's after(), which runs once the
// response is out and keeps the function alive for it — no latency on the
// ask, and no fire-and-forget insert frozen with the lambda. LOG_WAIT_MS
// bounds how long that afterwork waits on a stalled database.

const url = process.env.SYNC_DATABASE_URL;
const sql = url ? neon(url) : null;

const LOG_WAIT_MS = 5000;
const KEEP_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const LIST_MAX = 8; // terms, facets, searched — the plan sends at most four
const ITEM_MAX = 60;
const QUERY_MAX = 4000;

let schemaReady = false;
let lastPruneAt = 0;
async function ensure(): Promise<void> {
  if (schemaReady || !sql) return;
  await sql`create table if not exists ask_log (
    id bigserial primary key,
    at timestamptz not null default now(),
    route text not null,
    prompt text,
    query jsonb,
    parsed_by text,
    terms text[],
    facets text[],
    searched text[],
    area text,
    lat double precision,
    lng double precision,
    results int,
    dropped int,
    ms int,
    error text)`;
  schemaReady = true;
}

export interface AskLogRow {
  route: "decide" | "search";
  prompt?: string;
  query?: unknown;
  parsedBy?: string;
  terms?: string[];
  facets?: string[];
  searched?: string[];
  area?: string;
  lat?: number;
  lng?: number;
  results?: number;
  dropped?: number;
  ms?: number;
  error?: string;
}

const clip = (s: string | undefined, n: number) => (s == null ? null : s.length > n ? s.slice(0, n) : s);
const list = (xs: string[] | undefined) =>
  xs == null ? null : xs.slice(0, LIST_MAX).map((x) => (x.length > ITEM_MAX ? x.slice(0, ITEM_MAX) : x));
// Never a sliced JSON string — that is not JSON. The parsed query is schema-
// bounded and small; anything past the cap is replaced by a marker.
const json = (v: unknown) => {
  if (v == null) return null;
  const s = JSON.stringify(v);
  return s.length > QUERY_MAX ? JSON.stringify({ truncated: true, length: s.length }) : s;
};
// Two decimals is about a kilometre: the locality, not the doorstep.
const coarse = (n: number | undefined) =>
  n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100;

// What actually lands in the row — bounded and coarsened, so the log can be
// read for what was asked and not for where exactly someone stood.
export function shapeAskLog(row: AskLogRow) {
  return {
    route: row.route,
    prompt: clip(row.prompt, 500),
    query: json(row.query),
    parsedBy: row.parsedBy ?? null,
    terms: list(row.terms),
    facets: list(row.facets),
    searched: list(row.searched),
    area: clip(row.area, 80),
    lat: coarse(row.lat),
    lng: coarse(row.lng),
    results: row.results ?? null,
    dropped: row.dropped ?? null,
    ms: row.ms == null ? null : Math.round(row.ms),
    error: clip(row.error, 200),
  };
}

async function write(row: AskLogRow): Promise<void> {
  if (!sql) return;
  await ensure();
  const r = shapeAskLog(row);
  await sql`insert into ask_log (route, prompt, query, parsed_by, terms, facets, searched, area, lat, lng, results, dropped, ms, error)
    values (${r.route}, ${r.prompt}, ${r.query}::jsonb, ${r.parsedBy}, ${r.terms}::text[], ${r.facets}::text[], ${r.searched}::text[],
            ${r.area}, ${r.lat}, ${r.lng}, ${r.results}, ${r.dropped}, ${r.ms}, ${r.error})`;
  // Thirty days is enough to read back any complaint. Pruned on the first
  // write each instance sees and hourly after that — deterministic, and still
  // nothing that has to be scheduled.
  if (Date.now() - lastPruneAt >= PRUNE_EVERY_MS) {
    lastPruneAt = Date.now();
    await sql`delete from ask_log where at < now() - make_interval(days => ${KEEP_DAYS})`;
  }
}

export async function logAsk(row: AskLogRow): Promise<void> {
  if (!sql) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, LOG_WAIT_MS);
  });
  try {
    await Promise.race([write(row), bounded]);
  } catch (err) {
    console.warn("[ask-log] write failed", err instanceof Error ? err.message : err);
  } finally {
    clearTimeout(timer);
  }
}
