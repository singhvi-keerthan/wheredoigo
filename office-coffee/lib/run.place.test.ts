// The money path, with Neon, Swiggy and Slack faked: once place_food_order
// has gone out, no later failure may put the run back in a retryable state.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Choice } from "./types";

const queries: string[] = [];
let swiggyCalls: string[] = [];
let slackFails = false;
let runRow: Record<string, unknown> | null = null;

const latte: Choice = { itemId: "L", name: "Latte", variantFormat: null, variants: [], addons: [], unitPrice: 300, note: null };
const settings = { addressId: "A", addressLabel: "Office", restaurantId: "R", restaurantName: "Café", orderTime: "11:30", reminderLeadMin: 10, days: [0, 1, 2, 3, 4, 5, 6], payment: "SwiggyPay", channelId: "C" };
const cartData = { data: { items: [{ menu_item_id: "L", name: "Latte", quantity: 1, in_stock: 1 }], pricing: { to_pay: 300 } } };

vi.mock("./db", () => ({
  ensureSchema: async () => undefined,
  getSettings: async () => settings,
  sql: () => async (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = strings.reduce((acc, s, i) => acc + s + (i < vals.length ? `$${JSON.stringify(vals[i])}` : ""), "");
    queries.push(q);
    if (/set status = 'placing'/.test(q)) {
      // The real WHERE requires cart->>'reviewId' to match the button's.
      if (!q.includes('$"rid1"')) return [];
      return [{ cart: { lines: [{ key: JSON.stringify(["L", [], []]), quantity: 1 }], toPay: 300, reviewId: "rid1", reviewed: { addressId: "A", payment: "SwiggyPay", restaurantId: "R" } } }];
    }
    if (/from coffee_runs where day/.test(q)) return runRow ? [runRow] : [];
    return [];
  },
}));
vi.mock("./menu", () => ({ getMenu: async () => ({ categories: [{ title: "x", items: [{ id: "L" }] }] }) }));
vi.mock("./people", () => ({
  dayEntries: async () => [{ person: { id: 1, name: "A", regular: latte }, override: null, skip: false, effective: latte }],
  picksFor: (entries: { person: { id: number; name: string }; effective: Choice }[]) => ({
    picks: entries.map((e) => ({ personId: e.person.id, personName: e.person.name, choice: e.effective })),
    stale: [],
  }),
}));
vi.mock("./swiggy", () => ({
  humanError: (e: unknown) => String((e as Error)?.message ?? e),
  tokenStatus: async () => null,
  read: async (name: string) => {
    swiggyCalls.push(name);
    if (name === "get_food_cart") return { data: cartData, text: "" };
    if (name === "get_payment_options") return { data: { data: { swiggyMoney: { available: true } } }, text: "" };
    return { data: null, text: "" };
  },
  write: async (name: string) => {
    swiggyCalls.push(name);
    if (name === "place_food_order") return { data: { data: { orderId: "O1", status: "CONFIRMED", normalizedStatus: "success", totalAmount: 300 } }, text: "" };
    return { data: null, text: "" };
  },
}));
vi.mock("./slack", async (orig) => ({
  ...(await orig<typeof import("./slack")>()),
  slack: async (method: string) => {
    if (slackFails && method === "chat.update") throw new Error("slack chat.update: message_not_found");
    return { ok: true };
  },
}));
vi.mock("./time", async (orig) => ({ ...(await orig<typeof import("./time")>()), istClock: () => ({ day: "2026-11-04", minutes: 700, weekday: 3 }) }));

const { placeDay, reviewDay } = await import("./run");
const { picksHash } = await import("./cart");
const hash = picksHash([{ personId: 1, personName: "A", choice: latte }]);

const statusWrites = () => queries.filter((q) => /set status = /.test(q) && !/'placing'/.test(q.split("where")[0]));

describe("placeDay", () => {
  beforeEach(() => {
    queries.length = 0;
    swiggyCalls = [];
    slackFails = false;
    runRow = null;
  });

  it("places once and records placed", async () => {
    await placeDay(`2026-11-04|${hash}|300|rid1`, "U1", "C", "1.1");
    expect(swiggyCalls.filter((c) => c === "place_food_order")).toHaveLength(1);
    expect(statusWrites().some((q) => q.includes('"placed"'))).toBe(true);
  });

  it("a Slack failure after a confirmed order never downgrades the run to failed", async () => {
    slackFails = true;
    await placeDay(`2026-11-04|${hash}|300|rid1`, "U1", "C", "1.1");
    expect(swiggyCalls.filter((c) => c === "place_food_order")).toHaveLength(1);
    expect(statusWrites().some((q) => q.includes("'failed'") || q.includes('"failed"'))).toBe(false);
    expect(statusWrites().some((q) => q.includes('"placed"'))).toBe(true);
  });

  it("refuses an old day's Yes without touching Swiggy", async () => {
    const why = await placeDay(`2026-11-03|${hash}|300|rid1`, "U1", "C", "1.1");
    expect(why).toMatch(/old coffee run/);
    expect(swiggyCalls).toEqual([]);
  });

  it("a changed total sends it back to review instead of ordering", async () => {
    await placeDay(`2026-11-04|${hash}|299|rid1`, "U1", "C", "1.1");
    expect(swiggyCalls).not.toContain("place_food_order");
  });

  it("a Yes from an older review is dead even with the same picks and total", async () => {
    const why = await placeDay(`2026-11-04|${hash}|300|old99`, "U1", "C", "1.1");
    expect(why).toMatch(/already handled or changed/);
    expect(swiggyCalls).toEqual([]);
  });

  it("an unknown order can't be rebuilt from the plain Review button", async () => {
    runRow = { day: "2026-11-04", status: "unknown", order_min: 690, error: "timed out", scheduled_ids: [] };
    const why = await reviewDay("2026-11-04", "C", "1.1");
    expect(why).toMatch(/Check Swiggy orders first/);
    expect(swiggyCalls).toEqual([]);
    expect(queries.some((q) => /set status = 'reviewing'/.test(q))).toBe(false);
  });
});
