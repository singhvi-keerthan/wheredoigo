// Server-only Neon access for cross-device sync.
//
// Points at the dedicated `imhungry` database via SYNC_DATABASE_URL —
// deliberately NOT the shared DATABASE_URL (that's the Nexie DB the Vercel
// integration injected), so this app can never read or write Nexie data.
//
// Records only. Photo *bytes* live in Vercel Blob (a later phase); the `data`
// jsonb holds the Place record with photo dataUrls stripped.

import { neon } from "@neondatabase/serverless";

const url = process.env.SYNC_DATABASE_URL;

// Sync is optional. With no URL (e.g. a preview deploy without the var), the app
// still runs fully local-first and the sync routes report themselves disabled.
export const syncConfigured = Boolean(url);
const sql = url ? neon(url) : null;

function db() {
  if (!sql) throw new Error("SYNC_DATABASE_URL is not configured");
  return sql;
}

// `owner` is sha256(passphrase), computed on the CLIENT and sent as a bearer
// token (see app/api/sync/route.ts) — the plaintext passphrase never reaches
// the server. Rows are keyed by it, so a library is reachable only with the
// exact passphrase; no accounts, no user table.

// Mirrors lib/sync/schema.sql so a fresh deploy self-provisions on first call.
let schemaReady = false;
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const s = db();
  await s`create table if not exists places (
    owner text not null, id text not null, data jsonb not null,
    updated_at timestamptz not null, deleted_at timestamptz,
    primary key (owner, id))`;
  await s`create index if not exists places_owner_updated_idx on places (owner, updated_at)`;
  await s`create table if not exists tag_vocab (
    owner text not null, ns text not null, vals jsonb not null,
    updated_at timestamptz not null, primary key (owner, ns))`;
  schemaReady = true;
}

export interface PlaceRow {
  id: string;
  data: unknown; // Place record, photo dataUrls stripped
  updated_at: string; // ISO
  deleted_at: string | null; // ISO tombstone, or null
}

export interface TagRow {
  ns: string;
  vals: string[];
  updated_at: string; // ISO
}

// Everything for this owner changed since `since` (ISO), tombstones included so
// deletes propagate. `since` null → full snapshot (a device's first pull).
// Timestamps are returned in the client's exact ISO format (…THH:MM:SS.mmmZ) so
// last-write-wins comparisons on the client are apples-to-apples — Postgres's
// default text form ("… 00:00:00+00") would break string/date compares.
const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

export async function pullPlaces(owner: string, since: string | null): Promise<PlaceRow[]> {
  const s = db();
  const rows = since
    ? await s`select id, data,
                to_char(updated_at at time zone 'UTC', ${ISO}) as updated_at,
                case when deleted_at is null then null
                     else to_char(deleted_at at time zone 'UTC', ${ISO}) end as deleted_at
              from places where owner = ${owner} and updated_at > ${since} order by updated_at`
    : await s`select id, data,
                to_char(updated_at at time zone 'UTC', ${ISO}) as updated_at,
                case when deleted_at is null then null
                     else to_char(deleted_at at time zone 'UTC', ${ISO}) end as deleted_at
              from places where owner = ${owner} order by updated_at`;
  return rows as PlaceRow[];
}

// Upsert with a server-side last-write-wins guard: an older push can never
// clobber a newer row. Whole batch runs as one transaction.
export async function pushPlaces(owner: string, rows: PlaceRow[]): Promise<void> {
  if (!rows.length) return;
  const s = db();
  await s.transaction(
    rows.map(
      (r) =>
        s`insert into places (owner, id, data, updated_at, deleted_at)
          values (${owner}, ${r.id}, ${JSON.stringify(r.data)}::jsonb, ${r.updated_at}, ${r.deleted_at})
          on conflict (owner, id) do update set
            data = excluded.data,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
          where excluded.updated_at > places.updated_at`
    )
  );
}

export async function pullTags(owner: string, since: string | null): Promise<TagRow[]> {
  const s = db();
  const rows = since
    ? await s`select ns, vals, to_char(updated_at at time zone 'UTC', ${ISO}) as updated_at
              from tag_vocab where owner = ${owner} and updated_at > ${since} order by updated_at`
    : await s`select ns, vals, to_char(updated_at at time zone 'UTC', ${ISO}) as updated_at
              from tag_vocab where owner = ${owner}`;
  return rows as TagRow[];
}

export async function pushTags(owner: string, rows: TagRow[]): Promise<void> {
  if (!rows.length) return;
  const s = db();
  await s.transaction(
    rows.map(
      (r) =>
        s`insert into tag_vocab (owner, ns, vals, updated_at)
          values (${owner}, ${r.ns}, ${JSON.stringify(r.vals)}::jsonb, ${r.updated_at})
          on conflict (owner, ns) do update set
            vals = excluded.vals, updated_at = excluded.updated_at
          where excluded.updated_at > tag_vocab.updated_at`
    )
  );
}

// Every LIVE record for an owner (tombstones excluded), newest write first.
// The share view's read (lib/public.ts) — it wants the current library, not a
// sync delta, so it takes no cursor and never sees a deleted place.
export async function pullLive(owner: string): Promise<PlaceRow[]> {
  const s = db();
  const rows = await s`select id, data,
              to_char(updated_at at time zone 'UTC', ${ISO}) as updated_at,
              null as deleted_at
            from places
            where owner = ${owner} and deleted_at is null
            order by updated_at desc`;
  return rows as PlaceRow[];
}
