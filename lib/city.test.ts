import { describe, it, expect } from "vitest";
import { cityFromAddress, cityLabel, cityOf } from "./city";

describe("cityFromAddress", () => {
  it("reads the city out of a full Google address", () => {
    expect(cityFromAddress("298, 100 Feet Rd, Indiranagar, Bengaluru, Karnataka 560038, India"))
      .toBe("Bengaluru");
  });

  it("reads it when the state segment carries no PIN", () => {
    // The case a shape-only rule gets wrong — Rajasthan and Jaipur look alike.
    expect(cityFromAddress("Hawa Mahal Rd, Badi Choupad, Jaipur, Rajasthan, India")).toBe("Jaipur");
    expect(cityFromAddress("Jaipur, Rajasthan, India")).toBe("Jaipur");
  });

  it("reads a Swiggy-shaped address with no state, PIN, or country", () => {
    expect(cityFromAddress("100 Feet Road, Indiranagar, Bengaluru")).toBe("Bengaluru");
  });

  it("keeps a name that is both a city and its own admin unit", () => {
    expect(cityFromAddress("Connaught Place, New Delhi, Delhi 110001, India")).toBe("New Delhi");
    expect(cityFromAddress("Delhi, India")).toBe("Delhi");
    expect(cityFromAddress("Chandigarh, India")).toBe("Chandigarh");
  });

  it("returns blank rather than labelling a place with its state", () => {
    expect(cityFromAddress("Rajasthan, India")).toBe("");
    expect(cityFromAddress("Karnataka 560038, India")).toBe("");
  });

  it("returns blank on nothing useful", () => {
    expect(cityFromAddress("")).toBe("");
    expect(cityFromAddress("560038")).toBe("");
  });

  it("degrades sensibly outside India", () => {
    expect(cityFromAddress("Austin, TX 78701, USA")).toBe("Austin");
    expect(cityFromAddress("12 Rue de Rivoli, Paris, France")).toBe("Paris");
  });
});

describe("cityOf", () => {
  it("prefers Google's authoritative city over the parsed address", () => {
    expect(cityOf({ city: "Jaipur", address: "somewhere, Bengaluru" })).toBe("Jaipur");
  });

  it("falls back to the address when there is no stored city", () => {
    expect(cityOf({ city: undefined, address: "MG Rd, Bengaluru, Karnataka 560001, India" }))
      .toBe("Bengaluru");
    expect(cityOf({ city: "   ", address: "MG Rd, Bengaluru" })).toBe("Bengaluru");
  });
});

describe("cityLabel", () => {
  const p = (city: string) => ({ city, address: "" });

  it("names a single city", () => {
    expect(cityLabel([p("Bengaluru"), p("Bengaluru")])).toBe("Bengaluru");
  });

  it("names both when there are two, busiest first", () => {
    expect(cityLabel([p("Jaipur"), p("Bengaluru"), p("Bengaluru")])).toBe("Bengaluru & Jaipur");
  });

  it("counts once past two", () => {
    expect(cityLabel([p("Bengaluru"), p("Jaipur"), p("Goa"), p("Mumbai")])).toBe("4 cities");
  });

  it("says nothing when no city can be resolved", () => {
    expect(cityLabel([])).toBe("");
    expect(cityLabel([{ city: undefined, address: "" }])).toBe("");
  });

  it("ignores places it cannot place, without hiding the ones it can", () => {
    expect(cityLabel([p("Bengaluru"), { city: undefined, address: "" }])).toBe("Bengaluru");
  });
});
