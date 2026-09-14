import type { DeckCard } from "./deck";
import { coverPhoto } from "./format";

// A card is dealt only once its cover is in hand.
//
// The picture is the card. One that lands as a lettered blank and fills in a
// beat later reads as a loading screen, not a deal — and Swiggy's photos are
// remote, so that beat is the CDN's round trip on every card, on every run.
// SwipeMode warms the covers ahead of the stack through here and holds a card
// back until its cover has SETTLED: decoded, failed (the card falls back to its
// initial, and there is nothing left to wait for), or waited out — a stalled
// CDN must not stall the deck, so the wait is bounded. A cover that was waited
// out or failed is never mounted afterwards, so the one thing this exists to
// prevent — a card up, then its photo arriving — cannot happen through the
// bound either. The card keeps its initial; the photo is there for the next
// time that place comes round.
//
// Module-level on purpose: what has settled outlives a remount (leaving the
// mode and coming back), and the CDN answers with a year-long public
// cache-control, so a warmed URL is served from cache when the card's own
// <img> asks for it.

export const COVER_WAIT_MS = 3000;

export type CoverOutcome = "loaded" | "failed" | "timeout";

const warming = new Map<string, Promise<void>>();
const outcomes = new Map<string, CoverOutcome>();
const shapes = new Map<string, number>(); // width / height, once loaded
// Keeps an in-flight Image reachable until it settles.
const inFlight = new Set<HTMLImageElement>();

// The photo the card will actually open on — the same choice SwipeCard makes.
export function coverUrl(card: DeckCard): string | null {
  if (card.kind === "saved") return coverPhoto(card.place)?.dataUrl ?? null;
  return card.r.photos?.[0] ?? card.r.photo ?? null;
}

// Nothing to fetch: no photo, or the bytes are already in the document (a saved
// place's data URL).
function instant(url: string | null | undefined): url is null | undefined {
  return !url || /^(data|blob):/.test(url);
}

export function coverSettled(url: string | null | undefined): boolean {
  return instant(url) || outcomes.has(url);
}

// Whether the card should mount this photo at all. A cover that failed or was
// waited out stays off the card (see above). A URL never warmed — a gallery
// page, say — is the browser's to load as it always was.
export function coverUsable(url: string | null | undefined): boolean {
  if (instant(url)) return true;
  const o = outcomes.get(url);
  return o === undefined || o === "loaded";
}

// The cover's aspect, when it has loaded through here — lets the card open at
// the photo's own shape instead of measuring it a frame after the deal.
export function coverShape(url: string | null | undefined): number | null {
  return instant(url) ? null : (shapes.get(url) ?? null);
}

// Resolves once the URL has settled. Idempotent: one fetch per URL, and a
// settled URL resolves at once.
export function warmCover(url: string | null | undefined): Promise<void> {
  if (instant(url)) return Promise.resolve();
  let pending = warming.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve) => {
      let done = false;
      const finish = (img: HTMLImageElement | null, outcome: CoverOutcome) => {
        if (img) inFlight.delete(img);
        // A late load after the wait ran out still counts for next time — it
        // just never reaches the card that was dealt without it.
        if (outcome === "loaded" || !outcomes.has(url)) outcomes.set(url, outcome);
        if (done) return;
        done = true;
        resolve();
      };
      if (typeof Image === "undefined") {
        finish(null, "failed");
        return;
      }
      const img = new Image();
      inFlight.add(img);
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) shapes.set(url, img.naturalWidth / img.naturalHeight);
        // Loaded is not painted: decode() is what promises the bitmap is
        // ready, so the card's first frame is the photo and not a blank.
        const settle = () => finish(img, "loaded");
        if (typeof img.decode === "function") img.decode().then(settle, settle);
        else settle();
      };
      img.onerror = () => finish(img, "failed");
      img.src = url;
      setTimeout(() => finish(img, "timeout"), COVER_WAIT_MS);
    });
    warming.set(url, pending);
  }
  return pending;
}

// Tests only.
export function _resetCovers(): void {
  warming.clear();
  outcomes.clear();
  shapes.clear();
  inFlight.clear();
}
