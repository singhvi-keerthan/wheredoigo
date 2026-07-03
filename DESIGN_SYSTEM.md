# im hungry — Design System (as shipped)

This documents the system the code actually implements (tokens live in
`app/globals.css`; anything here disagreeing with the code is a bug in one of
them — fix the divergence, don't improvise a third way).

## 0. The shape of the screen

**Warm dark chrome floating over a light paper map.** The map is the canvas and
carries the colour; the chrome is warm charcoal and tactile. Benchmark feel:
Beli (photo-forward warmth) + Partiful (rounded, springy delight).

1. **Map** — light ivory paper (CARTO Positron retuned on load: land `#f3f3f0`,
   lightened roads, gray-ink labels with pale halos). Gets the full screen.
2. **Floating controls** — dark **glass** (`--glass`: `rgba(22,24,30,0.66)` +
   22px blur): masthead button, filter tray, search dock, toast, empty state.
3. **Sheets** — solid ink, never frosted (`--sheet` for detail, `--bg-raised`
   for the rest), 26px top radius, grab handle, **drag-to-dismiss**
   (`useSheetDrag`), springy `animate-rise` entry.

## 1. Color roles

- **Primary action = white** (`oklch(0.97 0 0)` fill, dark ink text): Decide,
  Add, Directions, Save, selected chips. One language for "the thing to press."
- **Accent = sodium amber `#ffa850`** — small emphasis only (search glyphs,
  eyebrow labels, empty-state pin). Never fills buttons, never decorates.
- **State palette** (pin + status colours; state only, never actions):
  `--s-watchlist` amber `oklch(0.72 0.14 78)` · `--s-visited` sage
  `oklch(0.62 0.13 150)` · `--s-favorite` red `oklch(0.6 0.17 15)` ·
  `--s-never` gray `oklch(0.6 0.02 265)`. Priority: never → favorite →
  visited → watchlist (`displayState()`).
- **Tags are neutral chips.** A tag is a category, not a state — no state or
  accent hues on chips, ever.
- **Neutrals are warm** (`#f4f0ee` / `#a8a098` / `#726b66` on `#121013`-family
  surfaces). Warmth belongs to the chrome; the map stays paper-neutral.

## 2. Typography

| Role | Font | Notes |
|---|---|---|
| Brand + sheet titles | **Zodiak** (`--font-display`) | masthead "im hungry", sheet headers |
| Place names | **Instrument Serif** (`--font-serif`) | names only — the identity layer |
| UI / controls | **General Sans** (`--font-sans`) | everything else |
| Data | **Spline Sans Mono** (`--font-mono`) | ratings, prices, counts, distances — data ONLY |

## 3. Pins (the map's vocabulary)

Colour = **state**, glyph = **type** (lucide monoline via `PlaceGlyph`) — never
mixed. Three zoom renders (`Pin` variants, chosen in `MapView`):

- **full** — label-sticker: white card, state-coloured type disc, place name.
- **disc** — the state-coloured type disc alone (zoom 12–13.5).
- **dot** — 13px state dot (city-wide, zoom < 12).

Pins degrade by zoom regardless of how many are visible — even two
overlapping label-stickers read as clutter; the selected pin is always full.
Pins bloom in staggered ("lights turning on").

## 4. Surfaces & radius

`--radius-lg 26px` sheets · `--radius 20px` cards · `--radius-sm 14px`
inputs · `--radius-chip 999px` pills/chips/CTAs. Buttons get `.press`
(spring scale 0.94). Sheets stack: scrim `rgba(6-10,7-8,10-13,~0.64)` →
sheet → sticky handle header.

## 5. Status semantics

- Lifecycle is exclusive (`watchlist | visited`); `favorite` / `never_again`
  are independent overlay flags.
- Once visited, **your data leads** (your rating/spend, `--star` amber stars);
  Google's numbers demote to a labelled reference row ("ggl").
- Visited is always an **appended visit** (timeline invariant) — never a bare
  status flip.

## 6. Voice

Copy is first-person-adjacent, lowercase-friendly, short: "Been here",
"Skip", "Where to tonight?", "A solid shout". No corporate speak. Max one
line of explanation under any control.
