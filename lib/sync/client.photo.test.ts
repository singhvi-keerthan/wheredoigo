import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const place: {
    id: string;
    createdAt: string;
    updatedAt: string;
    photos: {
      id: string;
      dataUrl: string;
      blobUrl?: string;
      source: "mine";
      scope: "place";
      visitId: null;
      createdAt: string;
    }[];
  } = {
    id: "place-1",
    createdAt: "2026-09-13T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    photos: [{
      id: "photo-1",
      dataUrl: "",
      source: "mine",
      scope: "place",
      visitId: null,
      createdAt: "2026-09-13T00:00:00.000Z",
    }],
  };
  return {
    place,
    applyRemotePhoto: vi.fn(),
    idbPutPhoto: vi.fn(),
  };
});

vi.mock("@/lib/store", () => ({
  applyRemotePlaces: (rows: { data: { photos?: { id: string; blobUrl?: string }[] } }[]) => {
    const remote = rows[0]?.data.photos?.find((photo) => photo.id === "photo-1");
    if (remote?.blobUrl) state.place.photos[0] = { ...state.place.photos[0], blobUrl: remote.blobUrl };
  },
  applyRemotePhoto: state.applyRemotePhoto,
  onLocalChange: () => () => {},
  setPhotoBlobUrl: vi.fn(),
  snapshotForSync: () => [state.place],
}));

vi.mock("@/lib/photoStore", () => ({
  idbGetAllPhotos: () => Promise.resolve(new Map()),
  idbPutPhoto: state.idbPutPhoto,
}));

vi.mock("@/lib/phrase", () => ({ normalizePhrase: (value: string) => value }));
vi.mock("@/lib/account", () => ({
  accountSecret: (phone: string, password: string) => `${phone}:${password}`,
  normalizePhone: (value: string) => value,
}));

const storage = new Map<string, string>();
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage.clear();
  delete state.place.photos[0].blobUrl;
  state.applyRemotePhoto.mockClear();
  state.idbPutPhoto.mockClear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("FileReader", class {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.result = "data:image/jpeg;base64,cGhvdG8=";
      queueMicrotask(() => this.onload?.());
    }
  });

  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "/api/sync" && init?.method === "POST") {
      return Response.json({ ok: true });
    }
    if (input === "/api/sync") {
      return Response.json({
        places: [{
          id: "place-1",
          data: {
            ...state.place,
            photos: [{ ...state.place.photos[0], blobUrl: "https://blob.test/photo-1" }],
          },
          updated_at: "2026-09-14T01:00:00.000Z",
          deleted_at: null,
        }],
      });
    }
    if (input.startsWith("/api/sync?since=")) return Response.json({ places: [] });
    if (input.startsWith("/api/photo?url=")) {
      return new Response(new Blob(["photo"], { type: "image/jpeg" }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("sync photo-handle repair", () => {
  it("full-pulls discarded Blob handles before pushing and downloads the Saved photo", async () => {
    const { connectAs } = await import("./client");
    await connectAs("owner-key", {});

    const requests = fetchMock.mock.calls.map(([input, init]) => ({
      input: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    }));
    const fullPull = requests.findIndex((request) => request.input === "/api/sync" && !request.body);
    const placePush = requests.findIndex((request) => request.body?.places?.length === 1);
    const photoGet = requests.findIndex((request) => request.input.startsWith("/api/photo?url="));

    expect(fullPull).toBeGreaterThan(-1);
    expect(placePush).toBeGreaterThan(fullPull);
    expect(photoGet).toBeGreaterThan(placePush);
    expect(requests[placePush].body.places[0].data.photos[0].blobUrl).toBe("https://blob.test/photo-1");
    expect(storage.get("wheredoigokeerthan.sync.photoHandles.v2")).toBe("1");
    expect(state.idbPutPhoto).toHaveBeenCalledWith("photo-1", "data:image/jpeg;base64,cGhvdG8=");
    expect(state.applyRemotePhoto).toHaveBeenCalledWith("photo-1", "data:image/jpeg;base64,cGhvdG8=");
  });
});
