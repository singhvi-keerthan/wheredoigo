import { describe, it, expect } from "vitest";
import { isOpenNow, displayState, type OpeningPeriod } from "./types";

// 2026-06-27 is a Saturday, 2026-06-28 a Sunday.
const at = (iso: string) => new Date(iso);

describe("isOpenNow", () => {
  it("returns null when hours are unknown", () => {
    expect(isOpenNow(undefined, at("2026-06-27T12:00:00"))).toBeNull();
    expect(isOpenNow([], at("2026-06-27T12:00:00"))).toBeNull();
  });

  it("handles the 24h convention (single open at day 0 00:00, no close)", () => {
    const p: OpeningPeriod[] = [{ open: { day: 0, hour: 0, minute: 0 } }];
    expect(isOpenNow(p, at("2026-06-27T03:14:00"))).toBe(true);
  });

  it("handles a plain daytime window", () => {
    const p: OpeningPeriod[] = [
      { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 17, minute: 0 } },
    ];
    expect(isOpenNow(p, at("2026-06-27T12:00:00"))).toBe(true);
    expect(isOpenNow(p, at("2026-06-27T18:00:00"))).toBe(false);
    expect(isOpenNow(p, at("2026-06-28T12:00:00"))).toBe(false); // Sunday: closed
  });

  it("handles an overnight wrap across the week boundary (Sat 21:00 → Sun 02:00)", () => {
    const p: OpeningPeriod[] = [
      { open: { day: 6, hour: 21, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } },
    ];
    expect(isOpenNow(p, at("2026-06-27T23:00:00"))).toBe(true);
    expect(isOpenNow(p, at("2026-06-28T01:00:00"))).toBe(true);
    expect(isOpenNow(p, at("2026-06-28T03:00:00"))).toBe(false);
  });
});

describe("displayState", () => {
  it("resolves by priority never_again → favorite → lifecycle", () => {
    expect(displayState({ status: "visited", favorite: true, neverAgain: true })).toBe("never_again");
    expect(displayState({ status: "visited", favorite: true, neverAgain: false })).toBe("favorite");
    expect(displayState({ status: "visited", favorite: false, neverAgain: false })).toBe("visited");
    expect(displayState({ status: "watchlist", favorite: false, neverAgain: false })).toBe("watchlist");
  });
});
