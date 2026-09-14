import { describe, expect, it } from "vitest";
import type { Photo } from "./types";
import { mergePhotoHandles, preserveStoredPhotoHandles } from "./photoMerge";

const photo = (id: string, dataUrl = "", blobUrl?: string): Photo => ({
  id,
  dataUrl,
  ...(blobUrl ? { blobUrl } : {}),
  source: "mine",
  scope: "place",
  visitId: null,
  createdAt: "2026-09-14T00:00:00.000Z",
});

describe("mergePhotoHandles", () => {
  it("combines this device's bytes with the server's Blob handle", () => {
    const local = photo("p1", "data:image/jpeg;base64,bG9jYWw=");
    const remote = photo("p1", "", "https://store.public.blob.vercel-storage.com/owner/p1");
    expect(mergePhotoHandles([local], [remote])).toEqual([
      { ...local, blobUrl: remote.blobUrl },
    ]);
  });

  it("keeps the authoritative list, so a deleted photo is not resurrected", () => {
    expect(mergePhotoHandles([photo("kept")], [photo("kept"), photo("deleted")]).map((p) => p.id)).toEqual([
      "kept",
    ]);
  });

  it("returns the original array when there is nothing to add", () => {
    const photos = [photo("p1", "data:image/jpeg;base64,bG9jYWw=", "https://example.test/p1")];
    expect(mergePhotoHandles(photos, [photo("p1")])).toBe(photos);
  });
});

describe("preserveStoredPhotoHandles", () => {
  it("prevents a stale client edit from stripping a stored Blob handle", () => {
    const incoming = { name: "Edited locally", photos: [photo("p1")] };
    const stored = { name: "Old name", photos: [photo("p1", "", "https://example.test/p1")] };
    expect(preserveStoredPhotoHandles(incoming, stored)).toEqual({
      ...incoming,
      photos: [{ ...incoming.photos[0], blobUrl: "https://example.test/p1" }],
    });
  });

  it("does not make the permissive sync route throw on a malformed legacy photo", () => {
    const incoming = { name: "Legacy", photos: [null] };
    expect(preserveStoredPhotoHandles(incoming, { photos: [photo("p1")] })).toBe(incoming);
  });
});
