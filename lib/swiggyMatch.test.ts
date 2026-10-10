import { describe, it, expect, vi } from "vitest";
import type { SwiggyRestaurant } from "./swiggy";

vi.mock("./sync/client", () => ({ ownerToken: () => "owner-token" }));
const { pickSwiggyMatch, offersBesidesDeal } = await import("./swiggyClient");

const row = (id: string, name: string, area: string): SwiggyRestaurant => ({
  id, name, area, cuisines: [], address: "", lat: null, lng: null, rating: null, priceForTwo: null, photo: null,
});

describe("finding a saved place on Swiggy", () => {
  it("never banks another branch of a chain", () => {
    const results = [row("1", "Cafe Coffee Day", "Whitefield")];
    expect(pickSwiggyMatch({ name: "Cafe Coffee Day", area: "Indiranagar" }, results)).toBeNull();
    const both = [...results, row("2", "Cafe Coffee Day", "Indiranagar")];
    expect(pickSwiggyMatch({ name: "Cafe Coffee Day", area: "Indiranagar" }, both)?.id).toBe("2");
  });

  it("calls two same-name candidates ambiguous when it can't tell them apart", () => {
    const results = [row("1", "Toit", "Indiranagar"), row("2", "Toit", "Whitefield")];
    expect(pickSwiggyMatch({ name: "Toit" }, results)).toBeNull();
    expect(pickSwiggyMatch({ name: "Toit" }, [results[0]])?.id).toBe("1");
  });

  it("tells non-Latin names apart, and matches none to an empty name", () => {
    expect(pickSwiggyMatch({ name: "कमल" }, [row("1", "मिलन", "")])).toBeNull();
    expect(pickSwiggyMatch({ name: "कमल" }, [row("1", "कमल", "")])?.id).toBe("1");
    expect(pickSwiggyMatch({ name: "—" }, [row("1", "…", "")])).toBeNull();
  });
});

describe("the offer list beside the headline deal", () => {
  const deal = "Flat 15% off on pre-booking";
  it("drops the one entry that only repeats the headline", () => {
    expect(offersBesidesDeal(["Flat 15% off · total bill", "Flat 10% off · total bill"], deal)).toEqual([
      "Flat 10% off · total bill",
    ]);
  });
  it("keeps an offer that carries a condition of its own", () => {
    const offers = ["Flat 15% off · maximum discount ₹500"];
    expect(offersBesidesDeal(offers, deal)).toEqual(offers);
  });
});
