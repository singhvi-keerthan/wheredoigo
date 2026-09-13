import { describe, it, expect } from "vitest";
import { mapGooglePlace, FIELD_MASK_DETAIL, FIELD_MASK_SEARCH } from "./google";

// The review count is captured for a later confidence rule and read by nothing
// yet. What matters now is that it is asked for on both calls, and that a
// place Google has no count for stays "unknown" — a zero would later read as
// "no one trusts this rating", which is a claim, not an absence.
describe("Google review count", () => {
  it("is requested on both field masks", () => {
    expect(FIELD_MASK_DETAIL.split(",")).toContain("userRatingCount");
    expect(FIELD_MASK_SEARCH.split(",")).toContain("places.userRatingCount");
  });

  it("maps userRatingCount, and a missing one to null rather than zero", () => {
    const base = { id: "x", displayName: { text: "Toit" }, rating: 4.5 };
    expect(mapGooglePlace({ ...base, userRatingCount: 12345 }).googleReviewCount).toBe(12345);
    expect(mapGooglePlace(base).googleReviewCount).toBeNull();
    expect(mapGooglePlace({ ...base, userRatingCount: "12345" }).googleReviewCount).toBeNull();
    expect(mapGooglePlace(base).googleRating).toBe(4.5);
  });
});
