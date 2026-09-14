import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVER_WAIT_MS, _resetCovers, coverSettled, coverShape, coverUrl, coverUsable, warmCover } from "./covers";
import type { DeckCard } from "./deck";
import type { Place, Photo } from "./types";
import type { SwiggyRestaurant } from "./swiggy";

// Stands in for the browser's Image: records what was asked for and lets a
// test decide whether — and how — it answers.
class FakeImage {
  static all: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private url = "";
  set src(v: string) {
    this.url = v;
    FakeImage.all.push(this);
  }
  get src(): string {
    return this.url;
  }
  load(w: number, h: number) {
    this.naturalWidth = w;
    this.naturalHeight = h;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
}

beforeEach(() => {
  _resetCovers();
  FakeImage.all = [];
  vi.useFakeTimers();
  vi.stubGlobal("Image", FakeImage);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const URL_A = "https://media-assets.swiggy.com/swiggy/image/upload/a.jpg";

describe("warmCover — a card is dealt only once its cover is in hand", () => {
  it("settles when the photo loads, and remembers its shape", async () => {
    expect(coverSettled(URL_A)).toBe(false);
    const p = warmCover(URL_A);
    expect(FakeImage.all).toHaveLength(1);
    expect(FakeImage.all[0].src).toBe(URL_A);
    expect(coverSettled(URL_A)).toBe(false);
    FakeImage.all[0].load(800, 470);
    await p;
    expect(coverSettled(URL_A)).toBe(true);
    expect(coverUsable(URL_A)).toBe(true);
    expect(coverShape(URL_A)).toBeCloseTo(800 / 470);
  });

  it("fetches a URL once — a second warm joins the first", () => {
    const first = warmCover(URL_A);
    const second = warmCover(URL_A);
    expect(second).toBe(first);
    expect(FakeImage.all).toHaveLength(1);
  });

  it("a failed load settles too — the card falls back to its initial", async () => {
    const p = warmCover(URL_A);
    FakeImage.all[0].fail();
    await p;
    expect(coverSettled(URL_A)).toBe(true);
    expect(coverUsable(URL_A)).toBe(false);
    expect(coverShape(URL_A)).toBeNull();
  });

  it("waits out a photo the CDN never answers, so a stalled CDN cannot stall the deck", async () => {
    const p = warmCover(URL_A);
    vi.advanceTimersByTime(COVER_WAIT_MS - 1);
    expect(coverSettled(URL_A)).toBe(false);
    vi.advanceTimersByTime(1);
    await p;
    expect(coverSettled(URL_A)).toBe(true);
    // Dealt without it, so it never mounts on that card...
    expect(coverUsable(URL_A)).toBe(false);
    // ...and a photo that turns up late counts for the next time round.
    FakeImage.all[0].load(800, 470);
    await Promise.resolve();
    expect(coverUsable(URL_A)).toBe(true);
    expect(coverShape(URL_A)).toBeCloseTo(800 / 470);
  });

  it("leaves a URL it never warmed to the browser", () => {
    expect(coverUsable("https://media-assets.swiggy.com/swiggy/image/upload/page-two.jpg")).toBe(true);
  });

  it("has nothing to wait for without a photo, or with bytes already in the document", async () => {
    expect(coverSettled(null)).toBe(true);
    expect(coverSettled(undefined)).toBe(true);
    expect(coverSettled("data:image/jpeg;base64,/9j/")).toBe(true);
    expect(coverUsable(null)).toBe(true);
    await warmCover(null);
    await warmCover("data:image/jpeg;base64,/9j/");
    expect(FakeImage.all).toHaveLength(0);
  });
});

describe("coverUrl — the photo the card opens on", () => {
  const r = (over: Partial<SwiggyRestaurant>): SwiggyRestaurant => ({
    id: "1",
    name: "Base Bistro",
    cuisines: [],
    area: "Indiranagar",
    address: "12th Main, Indiranagar",
    lat: null,
    lng: null,
    rating: null,
    priceForTwo: null,
    photo: null,
    ...over,
  });
  const newCard = (over: Partial<SwiggyRestaurant>): DeckCard => ({
    key: "n1",
    kind: "new",
    r: r(over),
    score: 0,
    reasons: [],
  });
  const photo = (dataUrl: string, source: Photo["source"]): Photo => ({
    id: dataUrl || "pending",
    dataUrl,
    source,
    scope: "place",
    visitId: null,
    createdAt: "2026-09-14T00:00:00.000Z",
  });
  const savedCard = (photos: Photo[]): DeckCard => ({
    key: "s1",
    kind: "saved",
    place: { photos } as unknown as Place,
    score: 0,
    reasons: [],
  });

  it("is the gallery's first photo, else the row's photo, for a Swiggy card", () => {
    expect(coverUrl(newCard({ photo: "p", photos: ["g1", "g2"] }))).toBe("g1");
    expect(coverUrl(newCard({ photo: "p" }))).toBe("p");
    expect(coverUrl(newCard({}))).toBeNull();
  });

  it("is the cover photo of a saved place, skipping bytes still hydrating", () => {
    expect(coverUrl(savedCard([photo("", "mine"), photo("data:g", "google")]))).toBe("data:g");
    expect(coverUrl(savedCard([photo("", "mine")]))).toBeNull();
    expect(coverUrl(savedCard([]))).toBeNull();
  });
});
