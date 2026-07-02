# Going-Out Second Brain — v1 Scope & Tech Stack

*Working title. Personal, single-user, $0-infra PWA. A decision engine for where to go out — not just a saved-places list.*

Last updated: 2026-06-30

---

## 1. Vision

A map-first **second brain for going out**. Every place you've been to or want to go to is a pin. The map is the interface; the value is two loops:

- **Capture** — get a place in with near-zero friction (search by name from a reel, or paste a Google Maps link) and auto-enrich it from Google.
- **Recall** — when deciding *where to go tonight*, answer faster and more personally than Google Maps can (filter by occasion, vibe, budget, open-now, not-yet-visited).

The bar it beats: Google Maps saved lists. It wins on **structured tags, your own ratings/notes layered over Google's, dish-level visit memory, and a decision filter.**

---

## 2. Core model (locked)

**One place, one lifecycle** — not two object types.

| | Watchlist | Visited |
|---|---|---|
| Rating shown | Google rating | **Your** rating (Google kept as reference) |
| Budget shown | Google price level ($–$$$$) | **Your** logged spend / person |
| Photos | Google photos | **Your** photos (+ Google fallback) |

Watchlist → Visited is a **state change**. Every place always carries Google's data; visiting layers your truth on top.

**Lifecycle vs. preference (kept separate):**
- `status` is the **lifecycle** and is exclusive: `watchlist | visited`.
- `favorite` and `never_again` are **independent flags**, not lifecycle states (they overlay a visited place). A place can be `visited + favorite`, or `visited + never_again`.
- **Pin color** is derived by priority: `never_again` (gray) → `favorite` (pink) → `visited` (green) → `watchlist` (amber). Filters expose status + both flags as separate controls.

---

## 3. Capture paths (locked)

Reels are the main discovery source, and reels carry a *name*, not a link. So:

| Path | Trigger | Flow | Priority |
|---|---|---|---|
| **Search-by-name** | saw a reel, know the name | open → search → tap result → pinned | **primary** |
| **Paste & Pin** | someone sent a Maps link | open → paste → auto-resolve → pinned | secondary |
| **Pin where I am** | standing at a place worth saving | tap → reverse-geocode my GPS → pick the matched place → pinned | secondary |
| Manual drop | place not in Google | drop a pin, type details | edge case |

> **Important distinction:** "Pin where I am" means *pin the place I'm currently at* — it reverse-geocodes my location to a real place and saves **that place**. It does **not** store my live GPS coordinates as a place. Location is used transiently for the lookup, never persisted as the pin.

v1 must nail **fast, forgiving in-app search** with photo + rating in results so you recognize the place. The search/add surface behaves like a **command palette** (cmdk), not a form.

**Duplicate guard:** search, paste, current-location, and manual drop can all create the same place. On save, check by `google_place_id` first, then a name+proximity fuzzy match; if a likely match exists, surface "already saved → open it" instead of creating a dupe. (Full merge UI is v1.5; v1 just prevents the obvious dupe.)

---

## 4. Tag taxonomy (namespaced)

Fixed namespaces so tags don't rot and filters are obvious. Auto-fill what Google knows; you hand-tag the subjective stuff.

> Note: `status`, `favorite`, and `never_again` are **not tags** — they are first-class fields on the place (see §2). The namespaces below are the *descriptive* tags used for filtering.

| Namespace | Examples | Source |
|---|---|---|
| **Type** | restaurant · café · bar · museum · activity · viewpoint | auto (Google category) |
| **Cuisine** | italian · south-indian · japanese | auto + manual |
| **Occasion** | date · family · friends · solo · work | you |
| **Vibe** | quiet · lively · romantic · outdoor · instagrammable | you |
| **Practical** | groups · vegetarian · reservation-needed · pet-friendly | you + Google |

---

## 5. Scope

**Three jobs this app exists to do** (everything below serves one of these):
1. **Remember** places better than your brain does (capture + memory layer).
2. **Decide** where to go right now (the Decide mode).
3. **Recall** the right place by any angle (tags + filters + map).

### In v1 (must)
- **Map-first shell** with pins colored by display-state, **clustering** as data grows, and a **list synced to the map viewport** (what's on screen ↔ what's in the list).
- Add place via **search**, **paste Maps link**, or **pin-where-I-am** → enrich → pin (with duplicate guard).
- **Place detail surface** (drawer/sheet), modular sections: Summary · Directions · Tags · Ratings/Budget · **Timeline** · Photos.
- **Timeline** = the memory layer: visits shown as a dated history (not a flat list), newest first, each with who-with + dishes/notes.
- Namespaced tags, editable per place (chips).
- **Decide mode** (first-class, *not* a filter panel bolted on): "help me pick" → constrain by occasion/budget/open-now/distance/status → a short ranked shortlist, tap → directions.
- Plain **filters** (chips + panel) for browsing/recall, separate from Decide.
- Watchlist → Visited transition: **appends a visit** (visits are append-only history), adds your rating + budget. Google rating/price are **never overwritten** — they stay as a cached reference snapshot with a `enriched_at` timestamp.
- `favorite` / `never_again` flags (independent of lifecycle).
- **Photos scoped two ways**: *place photos* (the place in general) and *visit photos* (tied to one visit). Your uploads first, Google photos as fallback.
- Installable PWA (add to home screen), works on iPhone.

### v1.5 (fast follow)
- **Saved filter presets / intents** — "Date night", "Cheap lunch", "Open now", "Museum day" as one-tap repeatable intents.
- **Merge UI** for duplicates (v1 only *detects* them).
- "Surprise me" random pick from a filtered set.
- Auto-read clipboard on open → pre-fill Paste & Pin.

### Out of scope (v1)
- Multi-user / sharing (single-user only)
- Complex stats dashboards *(maybe a tiny summary later; not a dashboard)*
- Proximity push nudges (weak on iOS PWA — defer to a possible native port)
- Bulk import from Google Maps lists *(explicitly not needed)*

---

## 6. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) as a PWA** | Familiar (Nexie site), deploys free on Vercel, good PWA story |
| Hosting | **Vercel** free tier | Known, $0, instant |
| **Map render** | **MapLibre GL + CARTO Positron style** (retuned to light paper on load) | **No API key, renders instantly, $0, custom styling.** No Google map-load SKU at all. |
| Place data | **Google Places API** (Autocomplete + Place Details + Photos) | Auto-enrich only. **Optional** — app boots and runs with mock enrichment until a key is added. |
| **Persistence (v1)** | **Local-first** — records in localStorage, photo bytes in IndexedDB (client-resized), JSON export/import backup | Runs with **zero credentials**, single device, no auth needed. |
| Auth (v1) | **None** | v1 is single-device, local-only. Data never leaves the browser, so there is nothing to gate. |
| PWA | manifest + service worker | Installable, full-screen on iPhone |

**Cloud-sync upgrade path (v2, see §7):** add Supabase (Postgres + Storage) for cross-device sync and backup. *That* phase introduces auth and is where `user_id` + Row-Level Security + Google OAuth (client ID/consent screen/redirects) get added — deliberately deferred out of v1 so the boot path stays keyless.

### UI architecture & interaction model

The UI is treated as a first-class system, not a skin. **The map is the canvas; the product is the small control layer over it.**

| Concern | Approach |
|---|---|
| Map render | **MapLibre GL** via **`react-map-gl/maplibre`** (React-managed view state + markers), CARTO Positron style |
| Component primitives | Hand-rolled on Tailwind (shadcn dropped — the surface count didn't justify it); tokens + rules in `DESIGN_SYSTEM.md` |
| Search / add | **cmdk command palette** — fast, forgiving, headless. Primary entry point for search, add, and quick actions. |
| Place detail + edit | **Drawer** on mobile / **Dialog** on desktop (shadcn responsive pattern). Detail is organized into **tabs/sections**, not one long scroll. |
| Filters | Chips inline + a dedicated panel. **Decide** is its own mode, not the filter panel. |
| Inline edits | Popovers + inline cards; modal only when necessary. |

**Responsive split brain:**
- **Mobile** (primary): full-screen map · top search bar · filter chips under it · bottom **drawer** for detail/list · Decide as a focused overlay.
- **Desktop**: map left · detail/filter rail right.

**Visual rules:** status = strong pin-color system; tags = chips. Once a place is **visited, your data is visually primary and Google data is secondary** ("mine" vs "Google" is a visible source distinction, not just a DB detail). Distinctive type + map style + motion carry the aesthetic (see §13, chosen direction).

*Validation:* Organic Maps / OsmAnd confirm the map-first shape — control surfaces stay small, quick, and layered over the map rather than competing with it.

---

## 7. Data model

v1 stores this shape in the **local browser store** (one JSON document keyed per record type). The same shape maps 1:1 to Postgres tables in the v2 cloud-sync phase.

```
place
  id              uuid
  google_place_id text|null      -- null for manual drops
  name            text
  address         text
  lat, lng        number
  status          'watchlist' | 'visited'      -- lifecycle, exclusive
  favorite        boolean                       -- preference flag (overlays visited)
  never_again     boolean                       -- preference flag (overlays visited)
  my_rating       number|null    -- 0–5, set once visited
  google_rating   number|null    -- cached reference
  my_budget_pp    number|null    -- your logged spend/person
  google_price    int|null       -- 0–4 ($ signs)
  notes           text
  tags            Tag[]          -- {namespace, value}; descriptive only (not status)
  photos          Photo[]        -- embedded in v1 local store
  visits          Visit[]        -- embedded in v1 local store
  source          'search' | 'paste' | 'manual'
  enriched_at     timestamp|null -- for the ~30-day refresh rule
  created_at      timestamp

Visit  { id, visited_on, who_with, notes, rating|null, created_at }   -- append-only history (the timeline)
Photo  { id, data_url, source:'mine'|'google', scope:'place'|'visit', visit_id|null, created_at }
Tag    { namespace:'type'|'cuisine'|'occasion'|'vibe'|'practical', value }
```

**Provenance / source snapshot:** Google-derived fields (`google_rating`, `google_price`, address, lat/lng, any Google photos) are a **cached snapshot**, stamped with `enriched_at`. They are reference data and are **never overwritten by your edits** — your truth lives in separate fields (`my_rating`, `my_budget_pp`, your photos, notes). A future "refresh from Google" action re-pulls the snapshot and updates `enriched_at`; it never touches your fields.

**Photo scope:** `scope:'place'` = a photo of the place in general; `scope:'visit'` = a photo tied to a specific visit (`visit_id` set). The detail Timeline shows visit photos under their visit; place photos show in the Summary gallery.

**v2 cloud mapping:** `place`/`visit`/`photo` become tables (visits/photos via `place_id` FK), tags normalize to `tags` + `place_tags`. **Every table gains a `user_id` column and an RLS policy `user_id = auth.uid()`** so a row is only ever readable/writable by its owner. Photos move from embedded data URLs to Supabase Storage object URLs. None of this is in v1.

---

## 8. Key flows

1. **Add (search):** type → Places Autocomplete (session token, free) → pick → Place Details (Pro fields: rating, price, hours, geometry) → write to `places` (status=watchlist), pull 1 photo → pin appears.
2. **Add (paste):** paste `maps.app.goo.gl/...` → resolve to place_id → same enrich path.
3. **Visit it:** open place → "Mark visited" → add my_rating + my_budget_pp + first visit entry → status flips, pin recolors, UI switches to showing *your* numbers.
4. **Decide tonight:** open filter panel → pick occasion=date, budget≤X, open-now, status≠visited → map + list narrow → tap → directions.

---

## 9. Google API cost (expected ~$0, with guardrails)

Maps cost nothing — rendering is MapLibre + OpenFreeMap (no Google map-load SKU). The only Google spend is Places **enrichment**.

**Assumption:** single user, ≤60 app opens/month, enrich-once-then-cache. Under that, every Places SKU's free monthly bucket is 20–∞× the usage, so the expected bill is **~$0**. This holds *only while the assumptions hold* — Google can change pricing/quotas, and uncached photo fetches are the first thing that would erode the smallest bucket (1,000 photos/mo).

**Guardrails / fallback if assumptions break:**
- Enrich once on save, store the result locally, never re-call to redisplay.
- Set a **billing budget alert** in Google Cloud (e.g. $1) so any drift is caught immediately.
- If Places ever starts costing, the enrichment layer is isolated behind one module — it can be disabled (manual entry only) or swapped without touching the rest of the app.
- (Google requires a card on file to activate the key even within the free tier.)

---

## 10. Build phases

0. **Design research + direction** — frontend-design skill + open-source references; lock the UI/UX direction *before* writing components (UI is near-equal priority).
1. **Scaffold** — Next.js PWA, env-gated (optional) Google key, local-first store. Boots with zero credentials.
2. **Map + data model** — MapLibre + OpenFreeMap, pins from the local store, **clustering**, **viewport-synced list**, seed data. *(Fully works before any Google key.)*
3. **Capture** — search-by-name + paste + pin-where-I-am, Place Details enrich (mock fallback), **duplicate guard**, pin on save.
4. **Place detail + lifecycle** — drawer/sheet detail with sections, tags editor, watchlist→visited (append visit), favorite/never-again flags, dual rating/budget.
5. **Visits + photos** — **Timeline** (append-only visit history), place vs visit photos, client-resized upload to local store.
6. **Recall + Decide** — plain filters (chips + panel) *and* the first-class **Decide mode** (ranked shortlist).
7. **Polish** — PWA install, empty states, the chosen UI direction throughout.
8. **(v2, later) Cloud sync** — Supabase tables + Storage, `user_id` + RLS, Google OAuth login.

---

## 11. What I need from you (external, can't self-serve)

**v1 — nothing is a hard blocker. The app boots and is usable with zero credentials.**

1. *(optional, for live enrichment)* **Google Places API key** — Places API enabled + billing card + a $1 budget alert. Until it's added, capture uses mock/manual enrichment. No Google *Maps* key is ever needed (maps are keyless).
2. **UI/UX direction** — researched in phase 0; I'll present concrete options for you to pick before building components.

**v2 (cloud sync) — only when we want cross-device + backup:**
3. **Supabase project** (free) — I'll give exact setup steps.
4. **Google OAuth client** (client ID + consent screen + redirect URIs) — for login. Separate from the Places key.
```

---

## 12. Open questions

- App name (working title for now).
- UI/UX direction — minimalist map-first vs. list-and-map split. Decide during phase 7.
