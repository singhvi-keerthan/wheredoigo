import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Swiggy's ceiling counts every request — the initialize handshake included —
// and a 429 is the one answer whose retry makes it worse. So the meter and the
// 429 handling live in the transport's own fetch, under the SDK, and these
// tests drive that fetch directly, plus the call wrapper above it.
let connects = 0;
const callTool = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = vi.fn(async () => {
      connects++;
    });
    callTool = (...a: unknown[]) => callTool(...a);
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {},
}));
type Take = { ok: boolean; retryAfterSec: number };
const takeToken = vi.fn<(bucket: string, o: { rate: number; capacity: number; strict?: boolean }) => Promise<Take>>();
vi.mock("./ratelimit", () => ({
  takeToken: (bucket: string, o: { rate: number; capacity: number; strict?: boolean }) => takeToken(bucket, o),
}));

vi.stubEnv("SWIGGY_MCP_TOKEN", "test-token");
const mcp = await import("./swiggyMcp");

const okReply = { content: [{ type: "text", text: "1. A —  | 4.2★ |  | X (ID: 1)" }] };
const response = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? "{}" : "slow down", { status, headers });

beforeEach(() => {
  callTool.mockReset();
  takeToken.mockReset();
  takeToken.mockResolvedValue({ ok: true, retryAfterSec: 0 });
  mcp._resetRateLimitState();
});
afterEach(() => vi.unstubAllGlobals());

describe("notingFetch — the meter under the SDK", () => {
  it("spends a token from the shared, fail-closed bucket before every request", async () => {
    const fetch = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetch);
    await mcp.notingFetch("https://mcp.swiggy.com/dineout", { method: "POST" });
    expect(takeToken).toHaveBeenCalledWith("swiggy:calls", { rate: 1, capacity: 10, strict: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses without touching the network once the bucket is empty, saying how long", async () => {
    const fetch = vi.fn(async () => response(200));
    vi.stubGlobal("fetch", fetch);
    takeToken.mockResolvedValueOnce({ ok: false, retryAfterSec: 3 });
    const err = await mcp.notingFetch("https://mcp.swiggy.com/dineout").catch((e) => e);
    expect(err).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(err.retryAfterSec).toBe(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns a 429 into the typed error carrying Retry-After, and blocks the next request for that long", async () => {
    const fetch = vi.fn(async () => response(429, { "Retry-After": "7" }));
    vi.stubGlobal("fetch", fetch);
    const first = await mcp.notingFetch("https://mcp.swiggy.com/dineout").catch((e) => e);
    expect(first).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(first.retryAfterSec).toBe(7);
    // The block is checked before the meter and before the network.
    const second = await mcp.notingFetch("https://mcp.swiggy.com/dineout").catch((e) => e);
    expect(second).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(second.retryAfterSec).toBeGreaterThanOrEqual(6);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(takeToken).toHaveBeenCalledTimes(1);
  });

  it("waits for Swiggy's reset when a success says nothing is left", async () => {
    const reset = Math.floor(Date.now() / 1000) + 30;
    const fetch = vi.fn(async () =>
      response(200, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(reset) })
    );
    vi.stubGlobal("fetch", fetch);
    await mcp.notingFetch("https://mcp.swiggy.com/dineout");
    const next = await mcp.notingFetch("https://mcp.swiggy.com/dineout").catch((e) => e);
    expect(next).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(next.retryAfterSec).toBeGreaterThanOrEqual(28);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reads Retry-After in both its forms and never below one second", () => {
    expect(mcp.parseRetryAfter("30")).toBe(30);
    expect(mcp.parseRetryAfter("0.2")).toBe(1);
    expect(mcp.parseRetryAfter(null)).toBeNull();
    const soon = new Date(Date.now() + 90_000).toUTCString();
    expect(mcp.parseRetryAfter(soon)).toBeGreaterThanOrEqual(89);
    expect(mcp.parseRetryAfter("not a date")).toBeNull();
  });
});

describe("callSwiggyReply — a throttle is never retried and never costs the session", () => {
  it("passes the transport's typed error straight up after ONE call", async () => {
    callTool.mockRejectedValueOnce(new mcp.SwiggyRateLimitError(9));
    const err = await mcp.callSwiggyReply("search_restaurants_dineout", { query: "Bar" }).catch((e) => e);
    expect(err).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(err.retryAfterSec).toBe(9);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("keeps the session across a throttle — reconnecting is itself a counted auth event", async () => {
    callTool.mockResolvedValueOnce(okReply);
    await mcp.callSwiggyReply("search_restaurants_dineout", { query: "Bar" });
    const before = connects;
    callTool.mockRejectedValueOnce(new mcp.SwiggyRateLimitError(2));
    await mcp.callSwiggyReply("search_restaurants_dineout", { query: "Bar" }).catch(() => undefined);
    callTool.mockResolvedValueOnce(okReply);
    await mcp.callSwiggyReply("search_restaurants_dineout", { query: "Bar" });
    expect(connects).toBe(before);
  });

  it("recognises a throttle Swiggy phrases as a tool error, and blocks for a minute", async () => {
    callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "RATE_LIMITED: too many requests, please try again later." }],
    });
    const err = await mcp.callSwiggyReply("search_restaurants_dineout", { query: "Bar" }).catch((e) => e);
    expect(err).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(err.retryAfterSec).toBe(60);
    expect(callTool).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => response(200)));
    const blocked = await mcp.notingFetch("https://mcp.swiggy.com/dineout").catch((e) => e);
    expect(blocked).toBeInstanceOf(mcp.SwiggyRateLimitError);
  });

  it("still retries a plain transport error once, and reports a throttle on the retry as a throttle", async () => {
    callTool.mockRejectedValueOnce(new Error("socket hang up")).mockRejectedValueOnce(new mcp.SwiggyRateLimitError(4));
    const err = await mcp.callSwiggyReply("search_restaurants_dineout", { query: "Bar" }).catch((e) => e);
    expect(err).toBeInstanceOf(mcp.SwiggyRateLimitError);
    expect(callTool).toHaveBeenCalledTimes(2);
  });
});
