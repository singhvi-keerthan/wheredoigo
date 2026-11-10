import { beforeEach, describe, expect, it, vi } from "vitest";

// The localStorage snapshot's two failure modes that a phone with a ~5MB quota
// actually hits: an older write landing over a newer one, and photo bytes that
// reach localStorage without passing through the photo store first.

const idb = vi.hoisted(() => {
  const pending: { id: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  return {
    pending,
    available: true,
    put: vi.fn(
      (id: string) =>
        new Promise<void>((resolve, reject) => {
          pending.push({ id, resolve, reject });
        })
    ),
  };
});

vi.mock("./photoStore", () => ({
  idbAvailable: () => idb.available,
  idbGetAllPhotos: () => Promise.resolve(new Map()),
  idbPutPhoto: idb.put,
  idbDeletePhoto: () => Promise.resolve(),
}));

const KEY = "wheredoigokeerthan.places.v1";
const storage = new Map<string, string>();
const flush = () => new Promise((r) => setTimeout(r, 0));
const saved = () => JSON.parse(storage.get(KEY) ?? "[]") as { id: string; photos: { id: string; dataUrl: string }[] }[];

async function freshStore() {
  vi.resetModules();
  idb.pending.length = 0;
  idb.put.mockClear();
  return await import("./store");
}

beforeEach(() => {
  storage.clear();
  idb.available = true;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
});

const base = {
  googlePlaceId: null,
  name: "Toit",
  address: "",
  lat: 12.97,
  lng: 77.64,
  status: "watchlist" as const,
  myRating: null,
  googleRating: null,
  myBudgetPerPerson: null,
  googlePriceLevel: null,
  notes: "",
  tags: [],
  source: "search" as const,
  enrichedAt: null,
};

describe("persisting the place snapshot", () => {
  it("does not let an older write, still waiting on the photo store, overwrite a newer one", async () => {
    const store = await freshStore();
    store.snapshotForSync(); // boot
    await flush();
    const place = store.addPlace(base);
    await flush();
    store.addPhoto(place.id, { dataUrl: "data:image/jpeg;base64,b2xk", source: "mine", scope: "place", visitId: null });
    const photoId = store.snapshotForSync()[0].photos[0].id;
    await flush();
    store.removePhoto(place.id, photoId); // newer snapshot: no photo
    await flush();
    expect(saved()[0].photos).toHaveLength(0);

    // The add's photo-store write finishes only now.
    idb.pending.find((p) => p.id === photoId)!.resolve();
    await flush();
    expect(saved()[0].photos).toHaveLength(0);
  });

  it("puts a pulled row's photo bytes in the photo store, not in localStorage", async () => {
    const store = await freshStore();
    store.snapshotForSync();
    await flush();
    const bytes = "data:image/jpeg;base64," + "A".repeat(1000);
    store.applyRemotePlaces([
      {
        id: "remote-1",
        updated_at: "2026-11-07T00:00:00.000Z",
        deleted_at: null,
        data: {
          ...base,
          id: "remote-1",
          favorite: false,
          neverAgain: false,
          visits: [],
          createdAt: "2026-11-07T00:00:00.000Z",
          // Not uploaded to Blob yet, so the bytes are the only copy and must be kept.
          photos: [{ id: "ph-1", dataUrl: bytes, source: "mine", scope: "place", visitId: null, createdAt: "2026-11-07T00:00:00.000Z" }],
        },
      },
    ]);
    await flush();
    expect(idb.put).toHaveBeenCalledWith("ph-1", bytes);
    idb.pending.find((p) => p.id === "ph-1")!.resolve();
    await flush();
    expect(saved()[0].photos[0]).toMatchObject({ id: "ph-1", dataUrl: "" });
    // Still on screen: only the localStorage copy leaves the bytes out.
    expect(store.snapshotForSync()[0].photos[0].dataUrl).toBe(bytes);
  });

  it("tells the sync queue each time the snapshot is written, so a queue write that failed for space retries", async () => {
    const store = await freshStore();
    const seen = vi.fn();
    store.onPersisted(seen);
    store.snapshotForSync();
    await flush();
    store.addPlace(base);
    await flush();
    expect(seen).toHaveBeenCalled();
  });

  it("leaves an unreadable library untouched when there is no room to copy it aside", async () => {
    storage.set(KEY, "{not json");
    const realSet = (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window
      .localStorage.setItem;
    (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage.setItem = (
      k: string,
      v: string
    ) => {
      if (k.includes(".corrupt.")) throw new DOMException("full", "QuotaExceededError");
      realSet(k, v);
    };
    const store = await freshStore();
    store.snapshotForSync();
    await flush();
    store.addPlace(base);
    await flush();
    expect(storage.get(KEY)).toBe("{not json");
  });
});

describe("a pull's records are on disk before its cursor moves", () => {
  const row = (id: string) => ({
    id,
    updated_at: "2026-11-07T00:00:00.000Z",
    deleted_at: null,
    data: {
      ...base,
      id,
      favorite: false,
      neverAgain: false,
      visits: [],
      createdAt: "2026-11-07T00:00:00.000Z",
      photos: [],
    },
  });
  const ls = () =>
    (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage;
  const settled = (p: Promise<void>) =>
    Promise.race([
      p.then(() => "resolved", () => "rejected"),
      new Promise((r) => setTimeout(() => r("pending"), 50)),
    ]);

  it("writes again on a retry of rows that are already in memory but failed to save", async () => {
    const store = await freshStore();
    store.snapshotForSync();
    await flush();
    const realSet = ls().setItem;
    let fail = true;
    ls().setItem = (k, v) => {
      if (fail && k === KEY) throw new Error("disk said no");
      realSet(k, v);
    };
    expect(await settled(store.applyRemotePlaces([row("r1")]))).toBe("rejected");
    expect(saved()).toHaveLength(0);

    fail = false;
    // Same rows again: unchanged in memory, still not on disk.
    expect(await settled(store.applyRemotePlaces([row("r1")]))).toBe("resolved");
    expect(saved().map((p) => p.id)).toEqual(["r1"]);
  });

  it("settles when the write fails at once (no photo store), so sync is not left hanging", async () => {
    idb.available = false;
    const store = await freshStore();
    store.snapshotForSync();
    await flush();
    ls().setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    expect(await settled(store.applyRemotePlaces([row("r2")]))).toBe("rejected");
  });
});
