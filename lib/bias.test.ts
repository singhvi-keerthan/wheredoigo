import { describe, it, expect, beforeEach, vi } from "vitest";
import { noteGpsFix, noteMapCenter, searchBias } from "./bias";

// The module holds process-wide state, so every test starts from a known floor.
const reset = () => {
  noteGpsFix(null);
  noteMapCenter({ lat: 0, lng: 0 }, 0); // too wide to record — leaves lastCenter as-is
};

describe("searchBias", () => {
  beforeEach(reset);

  it("returns nothing when neither a fix nor a usable view exists", async () => {
    vi.resetModules();
    const fresh = await import("./bias");
    expect(fresh.searchBias()).toBeUndefined();
  });

  it("prefers a live GPS fix over the map centre", () => {
    noteMapCenter({ lat: 12.97, lng: 77.61 }, 12);
    noteGpsFix({ lat: 26.9, lng: 75.8 });
    expect(searchBias()).toEqual({ lat: 26.9, lng: 75.8 });
  });

  it("falls back to the map centre once the fix is gone", () => {
    noteMapCenter({ lat: 12.97, lng: 77.61 }, 12);
    noteGpsFix({ lat: 26.9, lng: 75.8 });
    noteGpsFix(null);
    expect(searchBias()).toEqual({ lat: 12.97, lng: 77.61 });
  });
});

describe("noteMapCenter · the multi-city centroid guard", () => {
  beforeEach(reset);

  it("ignores a view too wide to be about one place", () => {
    // Bengaluru + Jaipur fitBounds lands here — measured at ~zoom 5, centring on
    // open country in Maharashtra. Recording it made every search bias to a
    // point ~500km from any place in the library.
    noteMapCenter({ lat: 12.97, lng: 77.61 }, 12); // a real city view first
    noteMapCenter({ lat: 18.605, lng: 76.746 }, 5); // the two-city fit
    expect(searchBias()).toEqual({ lat: 12.97, lng: 77.61 }); // not the midpoint
  });

  it("records a city-scale view", () => {
    noteMapCenter({ lat: 26.9, lng: 75.8 }, 11);
    expect(searchBias()).toEqual({ lat: 26.9, lng: 75.8 });
  });

  it("records nothing at all when the only view ever seen is a wide one", async () => {
    // A fresh module: `lastCenter` is deliberately never cleared once set, so
    // this case can only be observed from a clean boot — which is exactly the
    // situation it describes (open the app, map fits two cities, search).
    vi.resetModules();
    const fresh = await import("./bias");
    fresh.noteMapCenter({ lat: 18.605, lng: 76.746 }, 5);
    // No bias beats a wrong bias — the caller sends no locationBias at all.
    expect(fresh.searchBias()).toBeUndefined();
  });

  it("keeps the last good centre when you zoom out to the whole country", () => {
    noteMapCenter({ lat: 12.97, lng: 77.61 }, 13);
    noteMapCenter({ lat: 20.0, lng: 78.0 }, 4);
    expect(searchBias()).toEqual({ lat: 12.97, lng: 77.61 });
  });
});
