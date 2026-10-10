import { describe, it, expect } from "vitest";
import { presentableReasons } from "./cardReasons";

// The ranker's reasons (lib/decide.ts, lib/deck.ts) were written for Ask's
// shortlist, where nothing else on the row says the place's state. On the
// swipe card the state row is right above them — "Favorite · Open now", the
// star with your rating — so the same reasons read as the card repeating
// itself. This strips only what the row already shows. Ranking is untouched:
// the reasons still decide the order, they just don't all get printed.

const saved = (over: Partial<Parameters<typeof presentableReasons>[1]> = {}) => ({
  ratingValue: 5,
  ratingMine: true,
  badge: "favorite" as const,
  open: true,
  ...over,
});

describe("presentableReasons — a reason the state row already states is dropped", () => {
  it("drops your-rating, favourite and open-now when the row shows all three", () => {
    expect(presentableReasons(["You rated it 5.0", "A place you love", "Open now"], saved())).toEqual([]);
  });

  it("keeps the same strings when the row does NOT show them", () => {
    // Unrated card, watchlist badge, hours unknown: nothing on the row says
    // any of this, so every reason earns its chip.
    expect(
      presentableReasons(["A place you love", "Open now"], saved({ ratingValue: null, badge: "watchlist", open: null }))
    ).toEqual(["A place you love", "Open now"]);
  });

  it("drops 'On your watchlist' only under a Watchlist badge", () => {
    expect(presentableReasons(["On your watchlist"], saved({ badge: "watchlist" }))).toEqual([]);
    expect(presentableReasons(["On your watchlist"], saved({ badge: "visited" }))).toEqual(["On your watchlist"]);
  });

  // The star row prints the number whoever it came from; "4.5 on Google" and
  // "4.4 on Swiggy" beside a ★4.5 / ★4.4 is the same fact twice.
  it("drops a provenance-rating reason when the row shows a rating", () => {
    expect(presentableReasons(["4.5 on Google"], saved({ ratingValue: 4.5, ratingMine: false }))).toEqual([]);
    expect(presentableReasons(["4.4 on Swiggy"], saved({ ratingValue: 4.4, ratingMine: false, badge: "new" }))).toEqual([]);
    expect(presentableReasons(["4.4 on Swiggy"], saved({ ratingValue: null, badge: "new" }))).toEqual(["4.4 on Swiggy"]);
  });

  it("drops the New deck's fallback under its own 'New · Swiggy' badge", () => {
    expect(presentableReasons(["New on Swiggy"], saved({ badge: "new", ratingValue: null, open: null }))).toEqual([]);
  });

  it("keeps everything that adds information, in order", () => {
    const kept = ["Been a while", "Good for date", "Great ambiance", "Matches your note", "Near Jayanagar", "A solid shout"];
    expect(presentableReasons(["You rated it 5.0", ...kept], saved())).toEqual(kept);
  });
});
