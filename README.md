# wheredoigokeerthan

Personal, single-user, $0-infra PWA: a map-first second brain for going out.
Every place you've been or want to go is a pin; the two loops are **capture**
(search / paste a Maps link / pin where you are → auto-enriched from Google)
and **decide** ("date night, something new, near jayanagar, under 1500" → a
ranked pick from your own list).

- **Scope & data model:** `V1-SCOPE.md`
- **Design system (as shipped):** `DESIGN_SYSTEM.md`

## Run

```bash
npm install
npm run dev        # boots with zero credentials (capture degrades to manual)
```

`.env.local` (all optional):

```
GOOGLE_PLACES_API_KEY=…            # live search/enrich/nearby/photo
GOOGLE_GENERATIVE_AI_API_KEY=…     # Decide's natural-language parsing (Gemini)
SWIGGY_MCP_TOKEN=…                 # Dineout: the deck's "New" source + booking
```

### Swiggy Dineout

The deck's **New** source and **Book a table** run on Swiggy's Builders Club MCP
server (`mcp.swiggy.com/dineout`). Without `SWIGGY_MCP_TOKEN` both fall back to
mock data, so the app is fully usable with no credentials.

```bash
npm run swiggy:auth   # browser consent (phone + OTP) → prints the env lines
```

Swiggy's access tokens last **5 days** and there is no way to renew one without
redoing consent, so this is a recurring chore: when the deck says *"Swiggy needs
reconnecting"*, re-run the command above and update the env vars (locally and on
Vercel).

Their server metadata advertises a `refresh_token` grant and the token endpoint
does implement it — but no refresh token is ever issued, because Dynamic Client
Registration is a stub that hands every caller the same `client_id` and stores
nothing. `scripts/swiggy-oauth.ts` documents the probes. `npm run swiggy:refresh`
exists and is correct; it simply has nothing to work with until Swiggy starts
issuing refresh tokens.

## Checks

```bash
npm test                    # unit tests for the pure logic (ranking, hours, dupes, sanitizer)
npm run build
npm run eval:decide         # NL-parser eval against live Gemini (paced for free tier)
npm run eval:decide -- --offline   # same dataset against the local fallback parser
```

## Architecture notes

- **Local-first:** place records in `localStorage`, photo bytes in IndexedDB,
  fully-hydrated in-memory mirror via `useSyncExternalStore` (`lib/store.ts`).
  Backup = one JSON file (⋯ menu → Export/Import). v2 (Supabase sync) swaps the
  persistence layer without changing call sites.
- **Google spend:** enrich-once-then-cache; the only metered calls are text
  search (typed queries), one details refresh per place per ~30 days, and one
  photo per saved place. Keep the Cloud billing alert on.
- **Decide:** Gemini translates free text into a constrained `DecideQuery`
  (schema + sanitizer in `lib/decide-prompt.ts`, offline fallback in
  `lib/decide-fallback.ts`); ranking is local and deterministic
  (`lib/decide.ts`). Deploys on Vercel; pushing `main` deploys.
