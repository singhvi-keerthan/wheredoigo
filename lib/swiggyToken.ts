// Where the Swiggy access token LIVES now: a single row in the dedicated sync
// database, not the SWIGGY_MCP_TOKEN env var.
//
// The env var was the whole renewal problem. Vercel env changes don't reach
// running functions without a redeploy, so every 5-day token meant laptop →
// `npm run swiggy:auth` → `vercel env add` → `vercel redeploy` — and the one
// time nobody ran that chain (2026-09-19) prod served a dead token for 11 days.
// A row in Neon needs none of that: /api/swiggy/renew/callback writes it and
// every lambda picks it up within a cache-TTL, no deploy, from any device.
//
// The env var stays as a FALLBACK (dev without a DB, tests), which is why
// storedSwiggyToken answers null instead of throwing on every failure here:
// a missing table, a missing SYNC_DATABASE_URL, or a Neon hiccup must degrade
// to the env path, not take Swiggy down a second way.

import { neon } from "@neondatabase/serverless";

const url = process.env.SYNC_DATABASE_URL;
const sql = url ? neon(url) : null;

export interface SwiggyCredentials {
  accessToken: string;
  refreshToken: string | null;
  clientId: string | null;
  expiresAt: Date | null;
}

interface StoredToken {
  token: string;
  expiresAt: Date | null;
}

// One DB read per lambda instance per minute, not per Swiggy call. A fresh
// token lands within TTL seconds everywhere — and instantly on the instance
// that sees the first 401, because the auth-failure path busts this cache
// (see lib/swiggyMcp.ts).
const TTL_MS = 60_000;
let cache: { value: StoredToken | null; at: number } | null = null;

export function bustSwiggyTokenCache(): void {
  cache = null;
}

export async function storedSwiggyToken(): Promise<StoredToken | null> {
  if (!sql) return null;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const rows = (await sql`select access_token, expires_at from swiggy_credentials
                            where id = 1 limit 1`) as {
      access_token: string;
      expires_at: string | null;
    }[];
    const row = rows[0];
    const value = row?.access_token
      ? { token: row.access_token, expiresAt: row.expires_at ? new Date(row.expires_at) : null }
      : null;
    cache = { value, at: Date.now() };
    return value;
  } catch {
    // Covers the table not existing yet (first deploy before the first
    // renewal) as well as a transient Neon failure. Negative-cache it so an
    // unprovisioned deploy doesn't pay a doomed query on every Swiggy call.
    cache = { value: null, at: Date.now() };
    return null;
  }
}

// Called only by the renewal callback, so provisioning lazily here mirrors
// lib/sync/db.ts's ensureSchema: a fresh database self-creates on first use.
export async function saveSwiggyCredentials(creds: SwiggyCredentials): Promise<void> {
  if (!sql) throw new Error("SYNC_DATABASE_URL is not configured");
  await sql`create table if not exists swiggy_credentials (
    id int primary key check (id = 1),
    access_token text not null,
    refresh_token text,
    client_id text,
    expires_at timestamptz,
    updated_at timestamptz not null default now())`;
  await sql`insert into swiggy_credentials (id, access_token, refresh_token, client_id, expires_at)
            values (1, ${creds.accessToken}, ${creds.refreshToken}, ${creds.clientId}, ${creds.expiresAt})
            on conflict (id) do update set
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              client_id = excluded.client_id,
              expires_at = excluded.expires_at,
              updated_at = now()`;
  cache = { value: { token: creds.accessToken, expiresAt: creds.expiresAt }, at: Date.now() };
}
