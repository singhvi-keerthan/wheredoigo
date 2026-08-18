import { describe, it, expect, beforeEach } from "vitest";

// skips.ts talks to localStorage directly and the test env is node, where the
// global doesn't exist — its try/catch would swallow every write and the tests
// would pass against a no-op. A tiny in-memory stand-in makes them mean
// something. Installed before the import so the module never sees a bare env.
const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { bumpSkip, resetSkip, decSkip, peekSkip, setSkip } = await import("./skips");

describe("skip ledger", () => {
  beforeEach(() => mem.clear());

  it("counts up from nothing", () => {
    expect(peekSkip("p")).toBe(0);
    expect(bumpSkip("p")).toBe(1);
    expect(bumpSkip("p")).toBe(2);
    expect(peekSkip("p")).toBe(2);
  });

  it("decSkip steps one back — the reverse of a left swipe", () => {
    bumpSkip("p");
    bumpSkip("p");
    decSkip("p");
    expect(peekSkip("p")).toBe(1);
  });

  it("forgets the place entirely once the count reaches zero", () => {
    bumpSkip("p");
    decSkip("p");
    expect(peekSkip("p")).toBe(0);
    setSkip("q", 0);
    expect(peekSkip("q")).toBe(0);
  });

  // The bug this pair exists for: a right swipe on a saved card RESETS the
  // count, and undo has to put the old value back. decSkip can't do it (one
  // step down from zero is still zero), so undo used to silently keep the
  // reset — pushing the hide-for-good prompt two skips further out than the
  // user ever asked for.
  it("restores an exact count after a reset, which decSkip cannot", () => {
    bumpSkip("p");
    bumpSkip("p");
    const prior = peekSkip("p");
    resetSkip("p");
    expect(peekSkip("p")).toBe(0);

    decSkip("p"); // what undo used to do — no help at all
    expect(peekSkip("p")).toBe(0);

    setSkip("p", prior); // what it does now
    expect(peekSkip("p")).toBe(2);
  });
});
