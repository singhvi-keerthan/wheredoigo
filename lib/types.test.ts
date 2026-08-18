import { describe, it, expect } from "vitest";
import {
  isOpenNow,
  openStatus,
  displayState,
  isFoodPlace,
  dimensionsFor,
  namespacesFor,
  type OpeningPeriod,
  type Tag,
} from "./types";

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

describe("openStatus", () => {
  it("returns null when hours are unknown", () => {
    expect(openStatus(undefined, at("2026-06-27T12:00:00"))).toBeNull();
  });

  it("flags closing_soon inside the last hour of a window, open before that", () => {
    const p: OpeningPeriod[] = [
      { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 17, minute: 0 } },
    ];
    expect(openStatus(p, at("2026-06-27T12:00:00"))).toEqual({
      state: "open",
      open: { day: 6, hour: 9, minute: 0 },
      close: { day: 6, hour: 17, minute: 0 },
    });
    expect(openStatus(p, at("2026-06-27T16:30:00"))).toEqual({
      state: "closing_soon",
      open: { day: 6, hour: 9, minute: 0 },
      close: { day: 6, hour: 17, minute: 0 },
    });
  });

  it("reports the next window's hours when closed", () => {
    const p: OpeningPeriod[] = [
      { open: { day: 6, hour: 9, minute: 0 }, close: { day: 6, hour: 17, minute: 0 } },
    ];
    expect(openStatus(p, at("2026-06-27T18:00:00"))).toEqual({
      state: "closed",
      open: { day: 6, hour: 9, minute: 0 }, // wraps to next week's Saturday window
      close: { day: 6, hour: 17, minute: 0 },
    });
  });

  it("treats the 24h convention as open with no close time", () => {
    const p: OpeningPeriod[] = [{ open: { day: 0, hour: 0, minute: 0 } }];
    expect(openStatus(p, at("2026-06-27T03:14:00"))).toEqual({
      state: "open",
      open: { day: 0, hour: 0, minute: 0 },
      close: null,
    });
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


// Which questions a place gets asked. The visit form reads all three of these,
// so a regression here silently asks a museum how the food was.
describe("food vs non-food places", () => {
  const t = (namespace: Tag["namespace"], value: string): Tag => ({ namespace, value });

  it("treats an untyped place as food — the library predates the wider vocabulary", () => {
    expect(isFoodPlace([])).toBe(true);
    expect(isFoodPlace([t("vibe", "cozy")])).toBe(true);
  });

  it("keeps every food question on a food place", () => {
    const cafe = [t("type", "café")];
    expect(isFoodPlace(cafe)).toBe(true);
    expect(dimensionsFor(cafe)).toEqual(["food", "ambiance", "service", "value"]);
    expect(namespacesFor(cafe)).toContain("cuisine");
    expect(namespacesFor(cafe)).toContain("staple");
  });

  it("swaps food for experience and drops cuisine/staple elsewhere", () => {
    const museum = [t("type", "museum")];
    expect(isFoodPlace(museum)).toBe(false);
    expect(dimensionsFor(museum)).toEqual(["experience", "ambiance", "service", "value"]);
    expect(namespacesFor(museum)).not.toContain("cuisine");
    expect(namespacesFor(museum)).not.toContain("staple");
    expect(namespacesFor(museum)).toEqual(["type", "occasion", "vibe", "practical"]);
  });

  it("answers yes when a place is both — a museum with a café still has food", () => {
    const both = [t("type", "museum"), t("type", "café")];
    expect(isFoodPlace(both)).toBe(true);
    expect(dimensionsFor(both)).toContain("food");
  });
});
