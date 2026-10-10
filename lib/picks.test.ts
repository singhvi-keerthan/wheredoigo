import { describe, it, expect, beforeEach } from "vitest";

// picks.ts talks to localStorage directly and the test env is node, where the
// global doesn't exist — its try/catch would swallow every write and the tests
// would pass against a no-op. Same stand-in skips.test.ts uses, installed
// before the import so the module never sees a bare env.
const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { readPicks, addPick, removePick, hasPick, clearPicks, subscribePicks, _resetPicksForTests } =
  await import("./picks");

describe("picks ledger — the yeses a run of the deck keeps", () => {
  beforeEach(() => {
    mem.clear();
    _resetPicksForTests();
  });

  it("starts empty and keeps picks in the order they were made", () => {
    expect(readPicks()).toEqual([]);
    expect(addPick("a")).toBe(true);
    expect(addPick("b")).toBe(true);
    expect(readPicks().map((p) => p.id)).toEqual(["a", "b"]);
  });

  // A second yes on the same place is not a second pick: the list is a
  // shortlist, not a swipe log, and undo relies on "was it new?" to know
  // whether taking the swipe back should also take the pick back.
  it("reports whether a pick was new, and never holds a place twice", () => {
    expect(addPick("a")).toBe(true);
    expect(addPick("a")).toBe(false);
    expect(readPicks()).toHaveLength(1);
    expect(hasPick("a")).toBe(true);
    expect(hasPick("zzz")).toBe(false);
  });

  it("removes one pick and leaves the rest", () => {
    addPick("a");
    addPick("b");
    addPick("c");
    removePick("b");
    expect(readPicks().map((p) => p.id)).toEqual(["a", "c"]);
    removePick("never-there"); // a no-op, not a throw
    expect(readPicks()).toHaveLength(2);
  });

  // The whole point of the list: a refresh, a lens change or a new deck must
  // not lose what you said yes to. Persistence is the storage key, nothing in
  // memory — a fresh read after a cache reset sees the same list.
  it("survives a reload — the list lives in storage, not in the module", () => {
    addPick("a");
    addPick("b");
    _resetPicksForTests(); // simulates a fresh page: the in-memory cache is gone
    expect(readPicks().map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("clears to nothing", () => {
    addPick("a");
    clearPicks();
    expect(readPicks()).toEqual([]);
  });

  it("tells subscribers about every change, and stops when unsubscribed", () => {
    let calls = 0;
    const off = subscribePicks(() => {
      calls++;
    });
    addPick("a");
    removePick("a");
    expect(calls).toBe(2);
    off();
    addPick("b");
    expect(calls).toBe(2);
  });

  // A corrupt or foreign value under the key is an empty list, never a crash:
  // the deck must still open.
  it("treats unreadable storage as empty", () => {
    mem.set("wheredoigokeerthan.picks.v1", "{not json");
    expect(readPicks()).toEqual([]);
    mem.set("wheredoigokeerthan.picks.v1", JSON.stringify({ nope: 1 }));
    _resetPicksForTests();
    expect(readPicks()).toEqual([]);
  });
});
