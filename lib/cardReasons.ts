// What the swipe card may PRINT of the deck's reasons.
//
// The reasons come from the ranker (lib/decide.ts for saved places,
// lib/deck.ts for Swiggy rows) and were written for Ask's shortlist, where a
// row is a name and three chips and nothing else says the place's state. The
// swipe card has a state row above them — the badge ("Favorite", "Watchlist",
// "New · Swiggy"), "· Open now", and the star with the rating — so the same
// three chips there read as the card saying everything twice: "Favorite" and
// "A place you love", "· Open now" and "Open now", "★ 5.0" and "You rated it
// 5.0" (the 2026-10-10 review's first finding).
//
// This is presentation only. The ranker still produces every reason and the
// deck still orders cards by them; the card just skips the ones the row has
// already stated. A reason the row does NOT state is kept verbatim — on an
// unrated card "You rated it" can't occur, and "A place you love" under a
// Visited badge (a favourite that is also never-again cannot reach the deck)
// is new information.

export type ShownState = {
  ratingValue: number | null; // the number in the star row, whoever rated it
  ratingMine: boolean;
  badge: "favorite" | "watchlist" | "visited" | "never_again" | "new";
  open: boolean | null; // true → the row says "· Open now"
};

const YOUR_RATING = /^You rated it \d/;
const PROVENANCE_RATING = /^\d(?:\.\d)? on (?:Google|Swiggy)$/;

export function presentableReasons(reasons: string[], shown: ShownState): string[] {
  return reasons.filter((r) => {
    if (YOUR_RATING.test(r)) return !(shown.ratingMine && shown.ratingValue != null);
    if (PROVENANCE_RATING.test(r)) return shown.ratingValue == null;
    if (r === "A place you love") return shown.badge !== "favorite";
    if (r === "On your watchlist") return shown.badge !== "watchlist";
    if (r === "Open now") return shown.open !== true;
    if (r === "New on Swiggy") return shown.badge !== "new";
    return true;
  });
}
