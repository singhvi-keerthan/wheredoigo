# Nightfall — Design System (strict)

The theme is settled. This file makes it a *system*: explicit roles and rules so
the UI is authored, not improvised. Every component obeys these. When in doubt,
the rule wins over the instinct.

## 0. Interaction hierarchy (what the screen must say instantly)

1. **Command** (search + add/paste) — the one **primary** surface. Hero control.
2. **Filters** — **secondary** decision tools. Compact rail, never competes with Command.
3. **Map** — the **canvas / workspace**. Gets the most space.
4. **Detail** — the **next step** after tapping a pin. Docked sheet.

Capture → Decide is the loop. Command serves capture; Filters + Map + Detail serve decide.

## 1. Three planes (depth is mandatory)

Value must increase across planes so depth reads. Darkest → lightest:

| Plane | Role | Token | Value |
|---|---|---|---|
| 0 Shell | chrome backdrop / safe-area | `--shell` | `#0e0f12` (darkest) |
| 1 Map | content workspace | map paint (land) | `~#15171c` (lifted *above* shell) |
| 2 Surface | controls, masthead, sheet | `--surface` | `#1f222a` |
| 2+ Raised | inputs, command bar | `--raised` | `#282c36` |

Rule: **the map must never be darker than the shell** — it's content, not void. The
map is tuned on load (lifted land, lightened roads, legible labels) so it has presence.

## 2. Color roles (strict)

- **Accent (gold `#e0a04a`)** — primary action + the single key emphasis only:
  Command affordance, primary CTA (Directions), selected-pin. **Never** for filters,
  decoration, or every number.
- **Status colors** — state only (see §6). Never used for actions.
- **Neutrals** — structure only (text, borders, surfaces). **Cool-neutral, not warm.**
  Warmth comes from the accent + photos, *not* from tinting surfaces.

Neutral ramp (cool):
`--text-1 #e8eaee` (primary) · `--text-2 #9aa0ac` (secondary) · `--text-3 #6a6f7a` (meta/structure)
`--border #ffffff17` · `--border-strong #ffffff2b` · `--ink-line #2a2d35`

## 3. Typography (hierarchy, not mood)

| Role | Font | Size / weight | Color |
|---|---|---|---|
| Brand / place name | Clash Display | 18–20 / 600, tracking -0.01em | text-1 |
| Control labels | General Sans | 14 / 500, ~0 tracking | text-1/2 |
| Meta label (status, city) | General Sans | 11.5 / 600, small-caps feel, ≤0.02em | text-2/3 or status |
| **Data only** (ratings, prices, counts) | mono | 12.5 / 500 | per role |

Rules: mono = **data only**, never decoration. Letter-spacing used **sparingly** (over-tracking
reads as template). Clash Display is an **identity layer** (brand + names), not the whole UI.

## 4. Spacing & density (contrast, not uniformity)

- Command cluster = **dense** (tight padding, the one tall control).
- Map = **breathes** (chrome is short; map gets the height).
- Detail sheet = **generous**.
- Radius is **varied by role**, not global: controls/inputs `8px`, chips `6px`, sheet `14px` top only.
- Avoid the repeated identical "rounded gray box" motif. Differentiate primary vs secondary surfaces by value + density, not just borders.

## 5. Icons

One set (lucide), stroke `2`, sizes `15–18`. The **add action is part of Command**, not an
orphan `+` button — tapping Command opens the palette (search *or* paste-to-add). Pins share the
control language (same weight/feel).

## 6. Status semantics (this app lives on this)

Three independent visual languages — never blurred:

- **Lifecycle** (exclusive base): `watchlist` = ochre `#c2965a` · `visited` = sage `#7fa98f`.
- **Preference** (overlay on visited): `favorite` = terracotta `#cc6357` (heart glyph) · `never_again` = slate `#5e636c` (also dimmed).
- **Category tags** = neutral bordered chips (no status color).

Pin color = preference if set, else lifecycle (`displayState()`). Documented priority:
`never_again → favorite → visited → watchlist`.

## 7. Controls / filters

Filters are **operating controls**, not nav pills. Active = strong neutral fill (bone), inactive =
ghost text. The state change must feel like it changes the map. `Decide` is a distinct mode entry,
visually separated from the plain status filters.

## 8. Legibility

Secondary text must stay readable (≥ ~4.5:1 where it carries meaning). Interactive vs inactive must
be unmistakable. Map labels must win against chrome (dark halo + lifted ink).

## 9. Brand read (target)

personal · useful · evening-aware · opinionated · memory-driven · fast.
Not just "dark + amber" — singular through rigor, restraint, and a strong command-first loop.
