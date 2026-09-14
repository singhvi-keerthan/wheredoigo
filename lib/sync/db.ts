// Server-only Neon access for cross-device sync.
//
// Points at the dedicated `imhungry` database via SYNC_DATABASE_URL —
// deliberately NOT the shared DATABASE_URL (that's the Nexie DB the Vercel
// integration injected), so this app can never read or write Nexie data.
//
// Records only. Photo *bytes* live in Vercel Blob (a later phase); the `data`
// jsonb holds the Place record with photo dataUrls stripped.

import { neon } from "@neondatabase/serverless";
import { preserveStoredPhotoHandles } from "../photoMerge";

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
  // Which owner keys are REAL, independent of whether they hold any places.
  //
  // Existence used to be inferred from the place count, and that was wrong in
  // both directions: a just-created library and a library whose places were all
  // deleted both reported "nothing opens with this", which told the truthful
  // owner their own key was wrong AND charged them the anti-guessing budget on
  // every sync. `phone` is null unless the person signed up with one.
  await s`create table if not exists owners (
    owner text primary key,
    phone text,
    created_at timestamptz not null default now(),
    last_seen timestamptz not null default now())`;
  await s`create index if not exists owners_phone_idx on owners (phone)`;
  // A second key to the SAME library.
  //
  // An account's owner key is sha256 of phone-and-password, so a recovery
  // phrase cannot derive the same key — it would name a different library. This
  // maps the phrase's hash onto the owner it rescues, which is what makes it
  // actual recovery rather than a second empty map. Without it "there is no
  // password reset" is the whole story, and the first person to forget theirs
  // loses everything they saved.
  //
  // Only the HASH of the phrase is stored, so this table cannot be read back
  // into a phrase any more than the owner column can be read back into a
  // password.
  await s`create table if not exists owner_alias (
    alias text primary key,
    owner text not null,
    created_at timestamptz not null default now())`;
  schemaReady = true;
}

// Point a recovery phrase's hash at an existing owner key. Idempotent, and it
// will not silently re-point an alias that already names a different library —
// that would hand someone else's map to whoever registered the collision.
export async function registerAlias(alias: string, owner: string): Promise<void> {
  const s = db();
  await s`insert into owner_alias (alias, owner) values (${alias}, ${owner})
          on conflict (alias) do nothing`;
}

// The owner key a recovery phrase opens, or null if it opens nothing.
export async function resolveAlias(alias: string): Promise<string | null> {
  const s = db();
  const rows = (await s`select owner from owner_alias where alias = ${alias} limit 1`) as { owner: string }[];
  return rows[0]?.owner ?? null;
}

// Record that this owner key belongs to somebody, and stamp the visit. Called on
// every authenticated push, so a library registers itself the first time a
// device connects — before it has a single place in it.
//
// `phone` is stored in the clear, deliberately: Keerthan asked to be able to see
// who is using the app, and a hash cannot answer that. It is written only when
// the sign-up supplied one, never derived, and never returned to any browser.
export async function registerOwner(owner: string, phone: string | null): Promise<void> {
  const s = db();
  await s`insert into owners (owner, phone) values (${owner}, ${phone})
          on conflict (owner) do update set
            last_seen = now(),
            phone = coalesce(excluded.phone, owners.phone)`;
}

// Does this owner key name a real library? The honest answer to "does my phrase
// open anything", and the thing the guessing budget is charged against.
export async function ownerExists(owner: string): Promise<boolean> {
  const s = db();
  const rows = (await s`select 1 from owners where owner = ${owner} limit 1`) as unknown[];
  if (rows.length) return true;
  // Libraries that predate the owners table have places but no row. Falling back
  // to the place count keeps them recognised, tombstones included so a library
  // someone emptied still counts as theirs.
  const legacy = (await s`select 1 from places where owner = ${owner} limit 1`) as unknown[];
  return legacy.length > 0;
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
  // A stale installed client may edit a place before it has pulled the blobUrl
  // added by another device. Preserve those already-stored handles by photo id
  // before the whole-record LWW upsert, or that unrelated edit makes the photo
  // permanently undiscoverable on every new device.
  const ids = rows.map((row) => row.id);
  const stored = (await s`select id, data from places where owner = ${owner} and id = any(${ids})`) as {
    id: string;
    data: unknown;
  }[];
  const storedById = new Map(stored.map((row) => [row.id, row.data]));
  const safeRows = rows.map((row) => ({
    ...row,
    data: preserveStoredPhotoHandles(row.data, storedById.get(row.id)),
  }));
  await s.transaction(
    safeRows.map(
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

// How many live places this owner has. Used by the connect probe (does this
// phrase open anything?) and by the quota check, neither of which wants the
// records themselves.
export async function countLive(owner: string): Promise<number> {
  const s = db();
  const rows = (await s`select count(*)::int as n from places
                        where owner = ${owner} and deleted_at is null`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

// When this library was last written to, or null if it has never been.
export async function latestUpdate(owner: string): Promise<string | null> {
  const s = db();
  const rows = (await s`select to_char(max(updated_at) at time zone 'UTC', ${ISO}) as updated_at
                        from places where owner = ${owner} and deleted_at is null`) as {
    updated_at: string | null;
  }[];
  return rows[0]?.updated_at ?? null;
}

// Which of `ids` this owner already stores — live rows and tombstones both,
// because re-pushing a previously deleted place reuses its id rather than
// consuming a new slot. Lets the quota count only genuinely NEW places, so a
// library sitting at the ceiling can still be edited and pruned.
export async function existingIds(owner: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const s = db();
  const rows = (await s`select id from places
                        where owner = ${owner} and id = any(${ids})`) as { id: string }[];
  return new Set(rows.map((r) => r.id));
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
