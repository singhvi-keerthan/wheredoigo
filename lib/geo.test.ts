import { describe, it, expect } from "vitest";
import { parseDistanceKm } from "./geo";

// Swiggy's distance is prose, and it arrives in more than one shape: the
// batched render's "5.4 km", the details call's address prefix "13.6 km •
// A11…", and metres for anything close. The deck ranks on the number.
describe("parseDistanceKm", () => {
  it.each([
    ["5.4 km", 5.4],
    ["13.9 km away", 13.9],
    ["850 m", 0.85],
    ["13.6 km • A11, Block A, Kr Road", 13.6],
    ["1,200 m", 1.2],
    ["0 km", 0],
    ["2KM", 2],
  ])("reads %j as %s km", (text, km) => {
    expect(parseDistanceKm(text)).toBeCloseTo(km, 6);
  });

  it.each([[null], [undefined], [""], ["far"], ["km"], ["about five km"]])(
    "is null, never zero, for %j",
    (text) => {
      expect(parseDistanceKm(text as string | null | undefined)).toBeNull();
    }
  );
});
