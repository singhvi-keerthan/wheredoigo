import { describe, it, expect, vi, beforeEach } from "vitest";

// Production runs with SWIGGY_WIDE_SEARCH unset: ONE search, the most specific
// term. The fan-out suite forces the flag on at import, so this module loads
// the search without it — the path every deck actually takes today.
const callSwiggyReply = vi.fn();
const callSwiggyTool = vi.fn();
vi.mock("./swiggyMcp", async () => {
  const actual = await vi.importActual<typeof import("./swiggyMcp")>("./swiggyMcp");
  return {
    ...actual,
    swiggyLive: () => true,
    callSwiggyReply: (...a: unknown[]) => callSwiggyReply(...a),
    callSwiggyTool: (...a: unknown[]) => callSwiggyTool(...a),
  };
});
vi.stubEnv("SWIGGY_MCP_TOKEN", "test-token");
vi.stubEnv("SWIGGY_WIDE_SEARCH", "");
const { searchDineoutRestaurants } = await import("./swiggy");

const prose = (rows: [string, string, string][]) =>
  `Found ${rows.length} restaurant(s), showing ${rows.length}.\n` +
  rows.map(([id, name, area], i) => `${i + 1}. ${name} —  | 4.2★ |  | ${area} (ID: ${id})`).join("\n");
const reply = (rows: [string, string, string][]) => ({ data: null, text: prose(rows) });

beforeEach(() => {
  callSwiggyReply.mockReset();
  callSwiggyTool.mockReset();
  callSwiggyTool.mockResolvedValue({});
});

describe("searchDineoutRestaurants — narrow (the flag off)", () => {
  it("makes one search for the most specific term, and reports only that as attempted", async () => {
    callSwiggyReply.mockResolvedValueOnce(reply([["1", "Toit", "Indiranagar"]]));
    const { results, searched, attempted } = await searchDineoutRestaurants({
      terms: ["Bar", "Rooftop"],
      area: "Koramangala", // no rows in it — wide mode would top up; narrow never does
    });
    expect(callSwiggyReply).toHaveBeenCalledTimes(1);
    expect(searched).toEqual(["Bar"]);
    expect(attempted).toEqual(["Bar"]);
    expect(results[0].matchedTerms).toEqual(["Bar"]);
  });

  it("carries a 429 up as the whole answer", async () => {
    const { SwiggyRateLimitError } = await import("./swiggyMcp");
    callSwiggyReply.mockRejectedValueOnce(new SwiggyRateLimitError(12));
    await expect(searchDineoutRestaurants({ terms: ["Bar"] })).rejects.toBeInstanceOf(SwiggyRateLimitError);
  });
});
