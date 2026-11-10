import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
});

describe("the imhungry.* rename", () => {
  it("copies an old key that has no new one, then gives its space back", async () => {
    storage.set("imhungry.places.v1", "[1]");
    await import("./migrate");
    expect(storage.get("wheredoigokeerthan.places.v1")).toBe("[1]");
    expect(storage.has("imhungry.places.v1")).toBe(false);
  });

  it("never overwrites the new key, and keeps an old copy that differs from it", async () => {
    storage.set("imhungry.places.v1", "[old]");
    storage.set("wheredoigokeerthan.places.v1", "[new]");
    await import("./migrate");
    expect(storage.get("wheredoigokeerthan.places.v1")).toBe("[new]");
    expect(storage.get("imhungry.places.v1")).toBe("[old]");
  });

  it("drops an old copy identical to the new one", async () => {
    storage.set("imhungry.tags.v1", "{}");
    storage.set("wheredoigokeerthan.tags.v1", "{}");
    await import("./migrate");
    expect(storage.has("imhungry.tags.v1")).toBe(false);
  });

  it("keeps the old key when the copy could not be written", async () => {
    storage.set("imhungry.places.v1", "[1]");
    (window.localStorage as { setItem: (k: string, v: string) => void }).setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    await import("./migrate");
    expect(storage.get("imhungry.places.v1")).toBe("[1]");
  });
});
