import { describe, expect, it } from "vitest";
import type { Photo } from "./types";
import { dropBlobBackedBytes, mergePhotoHandles, preserveStoredPhotoHandles } from "./photoMerge";

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

describe("dropBlobBackedBytes", () => {
  it("empties bytes on own photos that have a Blob handle, and only those", () => {
    const inBlob = photo("a", "data:image/jpeg;base64,YQ==", "https://example.test/a");
    const notYet = photo("b", "data:image/jpeg;base64,Yg==");
    expect(dropBlobBackedBytes([inBlob, notYet])).toEqual([{ ...inBlob, dataUrl: "" }, notYet]);
  });

  it("returns the same array when nothing carries redundant bytes", () => {
    const photos = [photo("a", "", "https://example.test/a")];
    expect(dropBlobBackedBytes(photos)).toBe(photos);
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

  it("never brings back bytes the incoming row dropped once the photo is in Blob", () => {
    // The real sequence: push 1 carries bytes (not uploaded yet), push 2
    // carries the Blob handle with the bytes stripped. The stored row must end
    // up with the handle only — 8 photos/5.7M chars sat on the server otherwise.
    const incoming = { photos: [photo("p1", "", "https://example.test/p1")] };
    const stored = { photos: [photo("p1", "data:image/jpeg;base64,Ynl0ZXM=")] };
    expect(preserveStoredPhotoHandles(incoming, stored)).toEqual(incoming);
  });

  it("drops bytes an old client still sends for a photo the server knows is in Blob", () => {
    const incoming = { photos: [photo("p1", "data:image/jpeg;base64,Ynl0ZXM=")] };
    const stored = { photos: [photo("p1", "", "https://example.test/p1")] };
    expect(preserveStoredPhotoHandles(incoming, stored)).toEqual({
      photos: [photo("p1", "", "https://example.test/p1")],
    });
  });

  it("keeps the server's only bytes when an edit from a device without them arrives before upload", () => {
    const incoming = { name: "edited elsewhere", photos: [photo("p1")] };
    const stored = { photos: [photo("p1", "data:image/jpeg;base64,b25seQ==")] };
    expect(preserveStoredPhotoHandles(incoming, stored)).toEqual({
      ...incoming,
      photos: [photo("p1", "data:image/jpeg;base64,b25seQ==")],
    });
  });

  it("keeps bytes for a photo that is not in Blob yet, so it is never lost in transit", () => {
    const incoming = { photos: [photo("p1", "data:image/jpeg;base64,Ynl0ZXM=")] };
    expect(preserveStoredPhotoHandles(incoming, { photos: [] })).toBe(incoming);
  });

  it("does not make the permissive sync route throw on a malformed legacy photo", () => {
    const incoming = { name: "Legacy", photos: [null] };
    expect(preserveStoredPhotoHandles(incoming, { photos: [photo("p1")] })).toBe(incoming);
  });
});
