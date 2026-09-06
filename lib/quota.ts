// Per-owner ceilings on the two things a library can consume that Keerthan pays
// for: rows in Neon and bytes in Vercel Blob.
//
// Both were unbounded. The owner key is sha256(phrase) and any phrase is a valid
// namespace, so before this a single caller could mint namespaces and fill the
// database and the blob store without ever presenting a credential that belongs
// to anybody.
//
// The numbers are sized for what this app is — a few friends keeping a few
// hundred restaurants each — not for a product. They are deliberately low
// enough that hitting one is a signal worth reading, and every rejection logs
// exactly that. Raising one is a one-line change here.

import { neon } from "@neondatabase/serverless";

const url = process.env.SYNC_DATABASE_URL;
const sql = url ? neon(url) : null;

export const LIMITS = {
  placesPerOwner: 1000, // Keerthan has 29; a heavy user lands in the low hundreds
  rowsPerPush: 500, // one sync batch — a first-run migration of a full library
  syncBodyBytes: 8 * 1024 * 1024, // the records themselves are small; photos go elsewhere
  photoBytes: 8 * 1024 * 1024, // one photo, after base64 decode
  photoBytesPerOwner: 250 * 1024 * 1024,
} as const;

let schemaReady = false;
async function ensure(): Promise<void> {
  if (schemaReady || !sql) return;
  // Per-photo rather than a running total per owner, so that re-uploading the
  // same photo id REPLACES its size instead of adding to it. A single counter
  // would drift upward on every overwrite and eventually lock someone out of
  // their own library over bytes that were never stored twice.
  await sql`create table if not exists photo_usage (
    owner text not null,
    photo_id text not null,
    bytes int not null,
    updated_at timestamptz not null default now(),
    primary key (owner, photo_id))`;
  schemaReady = true;
}

export interface QuotaCheck {
  ok: boolean;
  used: number;
  limit: number;
}

// Live place count for an owner, tombstones excluded — a deleted place should
// not hold a slot forever.
export async function placeCount(owner: string): Promise<number> {
  if (!sql) return 0;
  const rows = (await sql`
    select count(*)::int as n from places where owner = ${owner} and deleted_at is null`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

// Would storing `photoId` at `bytes` put this owner over the blob ceiling?
// Subtracts what that id already occupies, because the write overwrites it.
export async function photoQuota(owner: string, photoId: string, bytes: number): Promise<QuotaCheck> {
  if (!sql) return { ok: true, used: 0, limit: LIMITS.photoBytesPerOwner };
  await ensure();
  const rows = (await sql`
    select
      coalesce(sum(bytes), 0)::bigint as total,
      coalesce(sum(bytes) filter (where photo_id = ${photoId}), 0)::bigint as existing
    from photo_usage where owner = ${owner}`) as { total: string; existing: string }[];
  const total = Number(rows[0]?.total ?? 0);
  const existing = Number(rows[0]?.existing ?? 0);
  const after = total - existing + bytes;
  return { ok: after <= LIMITS.photoBytesPerOwner, used: after, limit: LIMITS.photoBytesPerOwner };
}

// Record what a stored photo occupies. Called only after the blob write lands,
// so a failed upload never eats quota.
export async function recordPhoto(owner: string, photoId: string, bytes: number): Promise<void> {
  if (!sql) return;
  await ensure();
  await sql`
    insert into photo_usage (owner, photo_id, bytes, updated_at)
    values (${owner}, ${photoId}, ${bytes}, now())
    on conflict (owner, photo_id) do update set bytes = excluded.bytes, updated_at = now()`;
}
