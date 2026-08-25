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

// The card's own surface. The photo sits ON it rather than filling it, so this
// is what you see above/below and between the sections. Same value SwipeMode
// paints its ground with — they are one surface now, not a card on a field.
const BODY_BG = "var(--deck-bg)";

// The photo keeps its OWN aspect, clamped to the standard photographic range:
// 4:5 (portrait) at the tall end, 3:2 (landscape) at the wide end. Anything
// outside that is cropped a little; nothing is ever stretched into a slot.
// Before this the photo was `height: 100%` of a near-full-screen card — a slot
// around 1:2, which meant a 3:2 restaurant shot lost two-thirds of its frame
// and read as blown-up. 4:5 is what a card holds before its photo has loaded
// and reported its real shape.
const PHOTO_MIN = 0.8; // 4:5
const PHOTO_MAX = 1.5; // 3:2
const PHOTO_DEFAULT = 0.8;
// A place with no picture at all gets the short band instead: a half-screen of
// monogrammed gradient is a void, and the card is better off leading with what
// it actually knows about the place.
const PHOTO_NONE = 1.5;

// Where the photo pager's tap zones start — below the progress dots, which is
// all that sits on the photo now. It was 92px when the wordmark and the lens
// chip floated over this corner; they sit above the card since, so the pager
// gets that inch of photo back.
const PAGER_TOP = 30;

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
  entering = false,
  onOpenDetails,
  onBook,
  wasDrag,
}: {
  card: DeckCard;
  style?: CSSProperties;
  // `soft` = the stamp was put there by the coach demo, not by a finger, so it
  // fades in instead of tracking a drag pixel-for-pixel.
  stamp?: { label: string; color: string; opacity: number; soft?: boolean } | null;
  interactive?: boolean;
  // This card is arriving with the deal — the photo lands with it (a hair of
  // zoom coming to rest) instead of just being there.
  entering?: boolean;
  onOpenDetails: () => void; // saved cards → the full place screen
  onBook: () => void; // new cards → the Swiggy booking flow
  // "the gesture that just ended was a drag" — the pager asks before paging so
  // a swipe can never double as a tap. See useCardSwipe.
  wasDrag?: () => boolean;
}) {
  const v = cardView(card);
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
  // The box takes the COVER photo's own aspect (clamped), measured on load.
  // Deliberately locked to the first photo: paging is a look at the same place,
  // not a new layout, and a box that resized under the thumb would bounce the
  // whole card. Later photos cover into the shape the cover established.
  const [ratio, setRatio] = useState<number | null>(null);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        // No radius, no border, no drop shadow. Those three are what made this
        // read as a card floating on the phone; the deck is the screen now, and
        // a screen has no edges to draw. The photo runs to the glass.
        background: BODY_BG,
        userSelect: "none",
        WebkitUserSelect: "none",
        ...style,
      }}
    >
      <div
        className="scroll-quiet h-full overflow-y-auto"
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
        {/* ---- the photo, at its own size ---- */}
        <div className="relative w-full" style={{ aspectRatio: String(ratio ?? (cover ? PHOTO_DEFAULT : PHOTO_NONE)) }}>
          {/* Typographic fallback always renders; the photo lays over it. Swiggy's
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
            // when one 404s — and an onLoad, which is where the box learns what
            // shape the photo actually is. draggable=false keeps the native image
            // drag from hijacking the swipe gesture.
            <img
              key={at}
              src={cover}
              alt=""
              aria-hidden
              draggable={false}
              className={`pointer-events-none absolute inset-0 h-full w-full object-cover${entering ? " photo-settle" : ""}`}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (!img.naturalWidth || !img.naturalHeight) return;
                if (at !== 0 && ratio != null) return; // the cover sets the shape
                const r = img.naturalWidth / img.naturalHeight;
                setRatio(Math.min(PHOTO_MAX, Math.max(PHOTO_MIN, r)));
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}

          {/* No top wash. Nothing floats over the photo any more — the card
              starts below the masthead — so the picture opens at full strength
              on a clean edge instead of under half a stop of darkening. */}
          {/* Bottom feather into the card surface, so the photo ends as an edge
              of the card rather than a hard seam against the info block. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
            style={{ background: `linear-gradient(0deg, ${BODY_BG}, rgba(6,7,10,0))` }}
          />

          {/* Tap zones + segment dots, only once there's more than one image.
              A scroll cancels the click, so paging can't fire mid-flick. */}
          {interactive && photos.length > 1 && (
            <>
              <div className="absolute inset-x-0 top-0 flex gap-1.5 px-4 pt-3">
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
              {/* Left and right HALVES, not thirds, and inset below the chrome.
                  A pager you have to aim at isn't a pager. */}
              <button
                aria-label="Previous photo"
                onClick={() => {
                  if (wasDrag?.()) return;
                  setShot(Math.max(0, at - 1));
                }}
                disabled={at === 0}
                className="absolute bottom-0 left-0 w-1/2 disabled:pointer-events-none"
                style={{ top: PAGER_TOP }}
              />
              <button
                aria-label="Next photo"
                onClick={() => {
                  if (wasDrag?.()) return;
                  setShot(Math.min(photos.length - 1, at + 1));
                }}
                disabled={at === photos.length - 1}
                className="absolute bottom-0 right-0 w-1/2 disabled:pointer-events-none"
                style={{ top: PAGER_TOP }}
              />
            </>
          )}
        </div>

        {/* ---- who this is: on the card, not over the photo ---- */}
        <div className="px-5 pt-3">
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
            className="mt-1 text-[32px] leading-[1.04] tracking-[-0.01em]"
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
              on a saved card, which owes Swiggy nothing. Kept in the info block
              (above the fold, clear of the coach bar), not in the body. */}
          {card.kind === "new" && <PoweredBySwiggy tone="overlay" className="mt-3" />}
        </div>

        {/* ---- body: the rest of the story ---- */}
        <div className="px-5 pt-6" style={{ paddingBottom: BODY_TAIL, background: BODY_BG }}>
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
          className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2"
          style={{
            opacity: Math.min(1, stamp.opacity),
            transform: `translateX(-50%) rotate(-11deg)`,
            // A finger-driven stamp must track the finger with no lag; the
            // coach's demo stamp has no finger behind it, so it fades.
            transition: stamp.soft ? "opacity 200ms ease" : undefined,
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
