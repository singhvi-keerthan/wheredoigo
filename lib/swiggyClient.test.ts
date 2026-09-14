import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The wait Swiggy named has to hold across the deck's NEXT request — a lens
// change, the details call for the top card — not just the one that was
// refused. The client keeps busyUntil and answers `swiggy_busy` locally.
vi.mock("./sync/client", () => ({ ownerToken: () => "owner-token" }));
const { searchDineout, getDineoutDetails, swiggyBusyFor } = await import("./swiggyClient");

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("swiggyClient — honouring the server's Retry-After", () => {
  it("answers swiggy_busy on a 429 and refuses the next request locally until the wait passes", async () => {
    fetchMock.mockResolvedValueOnce(
      json(429, { error: "swiggy_busy", retryAfter: 45, results: [] }, { "Retry-After": "45" })
    );
    const first = await searchDineout({ terms: ["Bar"] });
    expect(first.error).toBe("swiggy_busy");
    expect(swiggyBusyFor()).toBeGreaterThanOrEqual(44);

    // The details call the deck makes for its top card: no fetch at all.
    const next = await getDineoutDetails({
      id: "1", name: "Toit", cuisines: [], area: "Indiranagar", address: "", lat: null, lng: null,
      rating: null, priceForTwo: null, photo: null,
    });
    expect(next.error).toBe("swiggy_busy");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
