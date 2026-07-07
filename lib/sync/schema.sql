-- v2 cloud sync (Neon Postgres). Applied idempotently; also mirrored by
-- ensureSchema() in lib/sync/db.ts so a fresh deploy self-provisions.
--
-- One row per place, scoped to owner = sha256(passphrase). Photo *bytes* are
-- NOT stored here (they go to Vercel Blob) — `data` holds the Place record with
-- photo dataUrls stripped. Deletions are tombstones (deleted_at set) so they
-- propagate across devices instead of the place re-appearing on the next pull.

create table if not exists places (
  owner       text        not null,
  id          text        not null,
  data        jsonb       not null,
  updated_at  timestamptz not null,
  deleted_at  timestamptz,
  primary key (owner, id)
);
create index if not exists places_owner_updated_idx on places (owner, updated_at);

-- Custom tag vocabulary, one row per (owner, namespace). `vals` is a JSON
-- string[] ("values" is a reserved word).
create table if not exists tag_vocab (
  owner       text        not null,
  ns          text        not null,
  vals        jsonb       not null,
  updated_at  timestamptz not null,
  primary key (owner, ns)
);
