# wheredoigokeerthan

Multi-user going-out PWA: a map and swipe deck for places people have been,
want to try, love, or want to skip.

The app has two main surfaces:

- `/` is the private app. It is local-first, installable, and works without an
  account system.
- `/go` is the read-only share view. It is server-rendered from the synced
  library and publishes only the allowlisted fields in `lib/public.ts`.

## What It Does Now

- **Capture:** add a place by Google search, pasted Maps link, nearby GPS lookup,
  or manual pin. Google enrichment caches rating, price, hours, area, city,
  summary, and one cover photo when configured.
- **Organize:** each place has lifecycle state, favorite/skip flags, tags, visits,
  notes, spend per person, ratings, photos, and optional source/reel links.
- **Decide:** Ask turns a sentence into a structured `DecideQuery`; local ranking
  then chooses from saved places. Without an Anthropic key, the app falls back to
  the offline parser.
- **Swipe deck:** double-tap or flick the wordmark to switch from map to deck.
  The deck can rank saved places, discover new Swiggy Dineout places, or combine
  both.
- **Sync:** passphrase-based sync mirrors records through Neon and own photo
  bytes through private Vercel Blob. Local data remains usable without sync.
- **Backup:** export/import still exists as the full JSON backup path.

## Run Locally

```bash
npm install
npm run dev
```

The app boots with zero credentials. Missing integrations degrade by feature:
manual/local use still works, Google-backed capture is unavailable, Ask uses the
fallback parser, Swiggy serves mock discovery data, and sync/share routes report
disabled.

## Environment

All env vars are optional for local boot.

| Variable | Used For |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | Place search, nearby lookup, Maps-link resolution, details refresh, and Google photos. |
| `ANTHROPIC_API_KEY` | Ask's live natural-language parser in `app/api/decide/route.ts`. |
| `SWIGGY_MCP_TOKEN` | Live Swiggy Dineout search, details, slots, and free table booking. |
| `SWIGGY_MCP_URL` | Optional Swiggy MCP endpoint override. Defaults to `https://mcp.swiggy.com/dineout`. |
| `SYNC_DATABASE_URL` | Neon database for cross-device record sync. |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob storage for synced own photos and `/go` photo serving. |
| `PUBLIC_OWNER_HASH` | 64-char sha256 passphrase hash for the public `/go` library owner. |

Swiggy search debugging toggles:

| Variable | Used For |
| --- | --- |
| `SWIGGY_MEDIA_BASE` | Optional Swiggy media base override. |
| `SWIGGY_WIDE_SEARCH=1` | Expands Swiggy search behavior in `lib/swiggy.ts`. |
| `SWIGGY_EXTRA_SEARCH_PAGE=1` | Pulls an extra Swiggy search page in `lib/swiggy.ts`. |

## Swiggy Dineout

Live Swiggy discovery and booking use Swiggy's Builders Club MCP server.

```bash
npm run swiggy:auth
```

That opens browser consent for phone + OTP and prints env lines. Swiggy access
tokens last 5 days. `npm run swiggy:refresh` exists, but Swiggy does not
currently issue refresh tokens to this flow, so routine renewal is re-running
`npm run swiggy:auth`.

## Data And Sync

- Records live in `localStorage` under `wheredoigokeerthan.places.v1`.
- Photo bytes live in IndexedDB through `lib/photoStore.ts`.
- `lib/store.ts` exposes a hydrated in-memory mirror through
  `useSyncExternalStore`.
- `lib/sync/client.ts` hashes the passphrase in the browser and sends only the
  sha256 owner token.
- `app/api/sync/route.ts` reads/writes Neon rows with last-write-wins guards and
  soft-delete tombstones.
- `app/api/photo/route.ts` proxies private Blob photo uploads/downloads for
  connected devices.
- `/go` reads the configured owner's live records server-side, strips private
  fields, and serves photos through `app/api/go/photo/[place]/[photo]/route.ts`.

## Checks

```bash
npm test
npm run lint
npm run build
```

Decide parser evals:

```bash
npm run eval:decide                 # live Anthropic parser, first 10 cases
npm run eval:decide -- --limit 20   # live parser, bounded sample
npm run eval:decide -- --full       # live parser, full paid sweep
npm run eval:decide -- --offline    # local fallback parser, no API spend
```

## Main Paths

| Path | Purpose |
| --- | --- |
| `components/AppShell.tsx` | Private app shell, map/deck mode toggle, docks, sheets. |
| `components/SwipeMode.tsx` | Saved/new/both swipe deck and Swiggy save flow. |
| `components/AddPlaceSheet.tsx` | Search/link/nearby/manual capture. |
| `components/MenuSheet.tsx` | Browse, sync, export/import, attribution. |
| `lib/decide.ts` | Local ranking and ask narrowing. |
| `lib/decide-prompt.ts` | Ask schema, model prompt, sanitizer. |
| `lib/deck.ts` | Deck construction and saved/new merge logic. |
| `lib/swiggy.ts` / `lib/swiggyMcp.ts` | Swiggy parsing and MCP transport. |
| `lib/store.ts` | Local-first persistence and mutation API. |
| `lib/sync/*` | Optional cross-device sync. |
| `lib/public.ts` | `/go` public projection allowlist. |

Scope references:

- `V1-SCOPE.md`
- `DESIGN_SYSTEM.md`
