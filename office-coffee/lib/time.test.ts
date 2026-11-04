import { describe, expect, it } from "vitest";
import { istClock, istEpochSec, nextRunDay, parseHm } from "./time";

const WEEKDAYS = [1, 2, 3, 4, 5];

describe("IST clock", () => {
  it("rolls the date at IST midnight, not UTC", () => {
    expect(istClock(new Date("2026-11-04T18:29:00Z")).day).toBe("2026-11-04");
    expect(istClock(new Date("2026-11-04T18:31:00Z")).day).toBe("2026-11-05");
  });
  it("11:30 IST on 2026-11-04 is 06:00 UTC", () => {
    expect(istEpochSec("2026-11-04", parseHm("11:30"))).toBe(Date.parse("2026-11-04T06:00:00Z") / 1000);
  });
  it("falls back on a malformed time", () => {
    expect(parseHm("25:00")).toBe(690);
    expect(parseHm("oops")).toBe(690);
  });
});

describe("nextRunDay", () => {
  // 2026-11-04 is a Wednesday.
  it("is today before the order time", () => {
    expect(nextRunDay(WEEKDAYS, 690, new Date("2026-11-04T05:59:00Z"))).toBe("2026-11-04");
  });
  it("moves to tomorrow once the order time passes", () => {
    expect(nextRunDay(WEEKDAYS, 690, new Date("2026-11-04T06:00:00Z"))).toBe("2026-11-05");
  });
  it("skips the weekend", () => {
    // Friday 2026-11-06 after 11:30 → Monday 2026-11-09
    expect(nextRunDay(WEEKDAYS, 690, new Date("2026-11-06T07:00:00Z"))).toBe("2026-11-09");
  });
  it("is null with no run days", () => {
    expect(nextRunDay([], 690)).toBeNull();
  });
});
