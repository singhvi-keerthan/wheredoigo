"use client";

import { useState, type CSSProperties } from "react";
import {
  Star,
  MapPin,
  Clock,
  Navigation,
  CalendarClock,
  SquarePen,
} from "lucide-react";
import { isOpenNow, type Place, type Visit } from "@/lib/types";
import { coverPhoto, photosSorted, leadRating, leadPrice, stateMeta, hoursPill, directionsUrl } from "@/lib/format";
import type { DeckCard } from "@/lib/deck";
import { PoweredBySwiggy } from "./PoweredBySwiggy";

// Height of the coach bar SwipeMode deals in at the start of a run. The card
// doesn't reserve it as padding any more — the bar is temporary now, so the
// card's content flows to the bottom and the bar floats over it for its ~2.5s.
export const FOOTER_SPACE = 124;

// The card's own surface. The photo sits ON it rather than filling it, so this
// is what you see above/below and between the sections.
const BODY_BG = "#06070a";

// The photo keeps its OWN aspect, clamped to the standard photographic range:
// 4:5 (portrait) at the tall end, 3:2 (landscape) at the wide end. Anything
// outside that is cropped a little; nothing is ever stretched into a slot.
// Before this the photo was `height: 100%` of a near-full-screen card — a slot
// around 1:2, which meant a 3:2 restaurant shot lost two-thirds of its frame
// and read as blown-up. 4:5 is also the no-photo default, so a card with no
// image has the same shape as one with.
const PHOTO_MIN = 0.8; // 4:5
const PHOTO_MAX = 1.5; // 3:2
const PHOTO_DEFAULT = 0.8;

// Where the photo pager's tap zones start — below the floating chrome (the
// lens chip and the mode switch) and the progress dots.
const PAGER_TOP = 92;

// Tail room under the last section, so the final control clears the home
// indicator instead of sitting on it.
const BODY_TAIL = "calc(2.5rem + env(safe-area-inset-bottom))";

// Normalised display fields, so the card renders the same shape whether it's a
// saved Place or a raw Swiggy result (which has no photos, tags or hours).
type CardView = {
  name: string;
  cover: string | null;
  ratingValue: number | null;
  ratingMine: boolean;
  priceLabel: string;
  area: string | null;
  chips: string[]; // cuisine/staple tags, or Swiggy cuisines
  reasons: string[];
  open: boolean | null;
  hours: { label: string; color: string } | null;
  badge: { label: string; color: string };
};

function savedView(place: Place, reasons: string[]): CardView {
  const cover = coverPhoto(place);
  const rating = leadRating(place);
  const meta = stateMeta(place);
  const chips = place.tags
    .filter((t) => t.namespace === "cuisine" || t.namespace === "staple")
    .map((t) => t.value);
  return {
    name: place.name,
    cover: cover?.dataUrl ?? null,
    ratingValue: rating.value,
    ratingMine: rating.mine,
    priceLabel: leadPrice(place).label,
    area: place.area ?? null,
    chips,
    reasons,
    open: isOpenNow(place.openingPeriods),
    hours: hoursPill(place),
    badge: { label: meta.label, color: meta.color },
  };
}

function newView(card: Extract<DeckCard, { kind: "new" }>): CardView {
  const { r } = card;
  return {
    name: r.name,
    cover: r.photo,
    ratingValue: r.rating,
    ratingMine: false,
    priceLabel: r.priceForTwo != null ? `₹${r.priceForTwo.toLocaleString("en-IN")} for two` : "—",
    area: r.area ?? null,
    chips: r.cuisines,
    reasons: [],
    open: null,
    hours: null,
    badge: { label: "New · Swiggy", color: "var(--accent)" },
  };
}

export function cardView(card: DeckCard): CardView {
  return card.kind === "saved" ? savedView(card.place, card.reasons) : newView(card);
}

// Every image the hero can page through. A saved place can genuinely have
// several (your own uploads, ordered mine-first by photosSorted); a Swiggy
// result carries exactly one. Google's own photos are NOT in here today — see
// the note on the pager below.
function heroPhotos(card: DeckCard): string[] {
  if (card.kind === "saved") return photosSorted(card.place).map((p) => p.dataUrl).filter(Boolean);
  return card.r.photo ? [card.r.photo] : [];
}

// The most recent visit that actually recorded something worth re-reading.
function lastNotedVisit(visits: Visit[]): Visit | null {
  return (
    [...visits]
      .filter((v) => v.notes.trim())
      .sort((a, b) => b.visitedOn.localeCompare(a.visitedOn))[0] ?? null
  );
}

/* ---------------------------------------------------------------- *
 * Body sections — everything below the fold
 * ---------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3
        className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]"
        style={{ color: "var(--text-tertiary)" }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14.5px] leading-[1.55]" style={{ color: "var(--text-secondary)" }}>
      {children}
    </p>
  );
}

function Chips({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span
          key={v}
          className="px-2.5 py-[5px] text-[12px] capitalize"
          style={{
            borderRadius: "var(--radius-chip)",
            background: "rgba(255,255,255,0.09)",
            color: "var(--text-primary)",
          }}
        >
          {v}
        </span>
      ))}
    </div>
  );
}

function ActionButton({
  href,
  onClick,
  icon,
  label,
}: {
  href?: string;
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  const className = "press flex w-full items-center justify-center gap-2 py-3 text-[13.5px] font-semibold";
  const style: CSSProperties = {
    borderRadius: "var(--radius-chip)",
    border: "1px solid var(--border-strong)",
    color: "var(--text-primary)",
  };
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} style={style}>
      {icon}
      {label}
    </a>
  ) : (
    <button onClick={onClick} className={className} style={style}>
      {icon}
      {label}
    </button>
  );
}

function SavedBody({
  place,
  onOpenDetails,
}: {
  place: Place;
  onOpenDetails: () => void;
}) {
  const visit = lastNotedVisit(place.visits);
  const tags = place.tags.map((t) => t.value);
  const hasStory = Boolean(place.summary || place.notes.trim() || visit);

  return (
    <>
      {hasStory && (
        <Section title="The story">
          {place.summary && <Prose>{place.summary}</Prose>}
          {place.notes.trim() && (
            <p
              className="mt-3 border-l-2 pl-3 text-[14px] leading-[1.55]"
              style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)" }}
            >
              {place.notes}
            </p>
          )}
          {visit && (
            <p className="mt-3 text-[13.5px] leading-[1.5]" style={{ color: "var(--text-tertiary)" }}>
              <span style={{ color: "var(--text-secondary)" }}>Last visit</span> — {visit.notes}
            </p>
          )}
        </Section>
      )}

      {tags.length > 0 && (
        <Section title="Tags">
          <Chips values={tags} />
        </Section>
      )}

      <Section title="Where">
        <Prose>{place.address || place.area || "No address on file"}</Prose>
      </Section>

      {place.hoursText && place.hoursText.length > 0 && (
        <Section title="Hours">
          <div className="text-[13px] leading-[1.7]" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
            {place.hoursText.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Go">
        <ActionButton
          href={directionsUrl(place)}
          icon={<Navigation size={14} strokeWidth={2.5} fill="currentColor" />}
          label="Directions"
        />
      </Section>

      {/* The escape hatch. Deliberately the LAST thing and the only edit
          affordance in swipe mode — rating, visits and photos all live on the
          full place screen, and an edit control mid-card breaks the swipe
          rhythm. */}
      <div className="mt-8 pt-5" style={{ borderTop: "1px solid var(--ink-line)" }}>
        <button
          onClick={onOpenDetails}
          className="press flex w-full items-center justify-center gap-2 py-3 text-[13.5px] font-semibold"
          style={{ borderRadius: "var(--radius-chip)", color: "var(--text-tertiary)" }}
        >
          <SquarePen size={14} strokeWidth={2.25} />
          Full details / Edit
        </button>
      </div>
    </>
  );
}

function NewBody({
  card,
  onBook,
}: {
  card: Extract<DeckCard, { kind: "new" }>;
  onBook: () => void;
}) {
  const { r } = card;
  return (
    <>
      {r.cuisines.length > 0 && (
        <Section title="Cuisines">
          <Chips values={r.cuisines} />
        </Section>
      )}

      <Section title="Where">
        <Prose>{r.address || r.area || "No address on file"}</Prose>
      </Section>

      <Section title="Go">
        <div className="flex flex-col gap-2">
          <ActionButton
            href={`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`}
            icon={<Navigation size={14} strokeWidth={2.5} fill="currentColor" />}
            label="Directions"
          />
          <ActionButton
            onClick={onBook}
            icon={<CalendarClock size={14} strokeWidth={2.5} />}
            label="Book a table"
          />
        </div>
      </Section>

      <p
        className="mt-8 text-center text-[12.5px] leading-snug"
        style={{ color: "var(--text-tertiary)" }}
      >
        Swipe right to add it to your watchlist — then it gets a full page of its own.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------- */

// A full-screen swipeable profile: a hero photo that fills the card, and
// everything else one scroll below it. Purely presentational — the horizontal
// gesture lives in useCardSwipe (driven by SwipeMode); this component only has
// to make sure the vertical one reaches the browser, which is what
// `touch-action: pan-y` on the scroller is for. See useCardSwipe for why that
// pairing is load-bearing rather than cosmetic.
export default function SwipeCard({
  card,
  style,
  stamp,
  interactive = true,
  onOpenDetails,
  onBook,
  wasDrag,
}: {
  card: DeckCard;
  style?: CSSProperties;
  stamp?: { label: string; color: string; opacity: number } | null;
  interactive?: boolean;
  onOpenDetails: () => void; // saved cards → the full place screen
  onBook: () => void; // new cards → the Swiggy booking flow
  // "the gesture that just ended was a drag" — the pager asks before paging so
  // a swipe can never double as a tap. See useCardSwipe.
  wasDrag?: () => boolean;
}) {
  const v = cardView(card);
  // Flips once, not per-pixel: the cue has done its job the moment you move.
  const [scrolled, setScrolled] = useState(false);
  // Photo pager. Tap-to-page rather than swipe-to-page on purpose: horizontal
  // drag is already spoken for by the card decision, and two horizontal
  // meanings on one surface is exactly the ambiguity the axis lock exists to
  // avoid. Resets per card for free — SwipeMode keys each wrapper by card.key,
  // so this component remounts rather than carrying a stale index.
  const photos = heroPhotos(card);
  const [shot, setShot] = useState(0);
  // Photo bytes hydrate from IndexedDB after mount, so this list can grow (or
  // shrink, if one fails to load) under a `shot` that was valid a moment ago.
  // Clamping at render keeps the dots, the image and the end-stops describing
  // the same photo instead of drifting apart.
  const at = Math.min(shot, Math.max(0, photos.length - 1));
  const cover = photos[at] ?? v.cover;

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        borderRadius: "var(--radius-lg)",
        background: BODY_BG,
        border: "1px solid var(--border-strong)",
        boxShadow: "0 18px 40px -20px rgba(0,0,0,0.55)",
        userSelect: "none",
        WebkitUserSelect: "none",
        ...style,
      }}
    >
      <div
        className="scroll-quiet h-full overflow-y-auto"
        onScroll={(e) => {
          const past = e.currentTarget.scrollTop > 24;
          if (past !== scrolled) setScrolled(past);
        }}
        style={{
          // pan-y: the browser owns vertical scrolling and is guaranteed never
          // to pan horizontally, which is what lets the axis lock take a
          // sideways gesture without ever racing a started scroll.
          touchAction: interactive ? "pan-y" : "none",
          overscrollBehavior: "contain",
          // Only the top card scrolls; the peeking ones underneath must not
          // steal a flick or show a scrollbar.
          overflowY: interactive ? "auto" : "hidden",
        }}
      >
        {/* ---- hero: fills the card, so the first screen is the photo ---- */}
        <div className="relative" style={{ height: "100%" }}>
          {/* Typographic gradient always renders; the photo lays over it. Swiggy's
              images are remote CDN URLs, so a 404 or a blocked request degrades to
              the initial instead of leaving a blank card. */}
          <div
            className="pointer-events-none absolute inset-0 grid place-items-center"
            style={{ background: "linear-gradient(155deg, oklch(0.34 0.05 265), oklch(0.22 0.03 265))" }}
          >
            <span
              className="text-[84px] leading-none opacity-25"
              style={{ fontFamily: "var(--font-serif)", color: "#fff" }}
            >
              {v.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
          {cover && (
            // A real <img>, not a CSS background: Swiggy's photos are remote CDN
            // URLs, and an element gives us an onError to fall back to the initial
            // when one 404s. draggable=false keeps the native image drag from
            // hijacking the swipe gesture.
            <img
              key={at}
              src={cover}
              alt=""
              aria-hidden
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}

          {/* Scrim so the info reads over any photo. pointer-events-none is
              load-bearing, not tidiness: it covers the bottom 60% of the hero,
              so without it the photo pager underneath is dead everywhere the
              gradient reaches — which is most of where a thumb lands. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5"
            style={{ background: "linear-gradient(0deg, rgba(6,7,10,0.92) 8%, rgba(6,7,10,0.55) 45%, transparent)" }}
          />

          {/* Tap zones + segment dots, only once there's more than one image.
              They cover the upper part of the hero only, so a tap near the name
              does nothing rather than surprising you. A scroll cancels the
              click, so paging can't fire mid-flick. */}
          {interactive && photos.length > 1 && (
            <>
              <div className="absolute inset-x-0 top-0 flex gap-1.5 px-4 pt-[max(6.75rem,calc(env(safe-area-inset-top)+6rem))]">
                {photos.map((_, i) => (
                  <span
                    key={i}
                    className="h-[3px] flex-1 rounded-full"
                    style={{
                      background: i === at ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.3)",
                      transition: "background 0.2s ease",
                    }}
                  />
                ))}
              </div>
              {/* Left and right HALVES, not thirds, and inset below the mode
                  chrome. The old zones were a third wide and started at the very
                  top: the close button sat inside the left one (so the top-left
                  corner left the mode instead of paging back), the middle third
                  did nothing at all, and the bottom 40% was inert. A pager you
                  have to aim at isn't a pager. */}
              <button
                aria-label="Previous photo"
                onClick={() => {
                  if (wasDrag?.()) return;
                  setShot(Math.max(0, at - 1));
                }}
                disabled={at === 0}
                className="absolute left-0 w-1/2 disabled:pointer-events-none"
                style={{ top: PAGER_TOP, bottom: FOOTER_SPACE }}
              />
              <button
                aria-label="Next photo"
                onClick={() => {
                  if (wasDrag?.()) return;
                  setShot(Math.min(photos.length - 1, at + 1));
                }}
                disabled={at === photos.length - 1}
                className="absolute right-0 w-1/2 disabled:pointer-events-none"
                style={{ top: PAGER_TOP, bottom: FOOTER_SPACE }}
              />
            </>
          )}

          {/* info */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 p-5"
            style={{ paddingBottom: FOOTER_SPACE }}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: v.badge.color }} />
              <span className="text-[11.5px] font-semibold" style={{ color: v.badge.color }}>
                {v.badge.label}
              </span>
              {v.open === true && (
                <span className="ml-1 text-[11px] font-medium" style={{ color: "var(--s-watchlist)" }}>
                  · Open now
                </span>
              )}
            </div>

            <h2
              className="mt-1 text-[34px] leading-[1.02] tracking-[-0.01em]"
              style={{ fontFamily: "var(--font-serif)", color: "#fff" }}
            >
              {v.name}
            </h2>

            <div
              className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {v.ratingValue != null && (
                <span
                  className="inline-flex items-center gap-1"
                  style={{ color: v.ratingMine ? "var(--star)" : "rgba(255,255,255,0.85)" }}
                >
                  <Star size={11} strokeWidth={0} fill="currentColor" />
                  {v.ratingValue.toFixed(1)}
                </span>
              )}
              <span style={{ color: "rgba(255,255,255,0.8)" }}>{v.priceLabel}</span>
              {v.area && (
                <span className="inline-flex items-center gap-1" style={{ color: "rgba(255,255,255,0.7)" }}>
                  <MapPin size={10} strokeWidth={2} />
                  {v.area}
                </span>
              )}
              {v.hours && (
                <span className="inline-flex items-center gap-1" style={{ color: v.hours.color }}>
                  <Clock size={10} strokeWidth={2} />
                  {v.hours.label}
                </span>
              )}
            </div>

            {(v.reasons.length > 0 || v.chips.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(v.reasons.length > 0 ? v.reasons : v.chips.slice(0, 3)).map((r) => (
                  <span
                    key={r}
                    className="px-2 py-[3px] text-[11px] capitalize"
                    style={{
                      borderRadius: "var(--radius-chip)",
                      background: "rgba(255,255,255,0.14)",
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}

            {/* Cl. 3.4(ii): the notation travels with the Swiggy content, so it
                is on-screen for every deck card sourced from the MCP — and never
                on a saved card, which owes Swiggy nothing. */}
            {card.kind === "new" && <PoweredBySwiggy tone="overlay" className="mt-3" />}

            {/* the only thing that tells you there IS a below-the-fold */}
            {interactive && (
              <div
                className="mt-4 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  color: "rgba(255,255,255,0.55)",
                  opacity: scrolled ? 0 : 1,
                  transition: "opacity 0.2s ease",
                }}
              >
                <ChevronsDown size={13} strokeWidth={2.5} className="hint-y" />
                Scroll for more
              </div>
            )}
          </div>
        </div>

        {/* ---- body: below the fold ---- */}
        <div
          className="px-5 pt-7"
          style={{ paddingBottom: FOOTER_SPACE + 24, background: BODY_BG }}
        >
          {card.kind === "saved" ? (
            <SavedBody place={card.place} onOpenDetails={onOpenDetails} />
          ) : (
            <NewBody card={card} onBook={onBook} />
          )}
        </div>
      </div>

      {/* drag stamp — the Tinder tell: what a release right now commits to.
          Outside the scroller so it stays put while the card's content moves. */}
      {stamp && stamp.opacity > 0.02 && (
        <div
          className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2"
          style={{
            opacity: Math.min(1, stamp.opacity),
            transform: `translateX(-50%) rotate(-11deg)`,
          }}
        >
          <span
            className="block px-4 py-1.5 text-[26px] font-extrabold uppercase tracking-[0.06em]"
            style={{
              color: stamp.color,
              border: `4px solid ${stamp.color}`,
              borderRadius: 12,
              textShadow: "0 1px 2px rgba(0,0,0,0.3)",
            }}
          >
            {stamp.label}
          </span>
        </div>
      )}
    </div>
  );
}
