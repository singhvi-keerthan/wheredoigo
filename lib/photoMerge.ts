import type { Photo } from "./types";

// A place record is last-write-wins, but a photo's two payload handles are not
// competing edits: dataUrl is the bytes this device has, while blobUrl is the
// server handle another device may have added after upload. Keep the
// authoritative list (so a real photo deletion still wins) and fill either
// handle from the matching supplemental record when it is missing.
export function mergePhotoHandles(authoritative: Photo[], supplemental: Photo[]): Photo[] {
  if (!authoritative.length || !supplemental.length) return authoritative;
  const byId = new Map(supplemental.map((photo) => [photo.id, photo]));
  let changed = false;
  const merged = authoritative.map((photo) => {
    const other = byId.get(photo.id);
    if (!other) return photo;
    const dataUrl = photo.dataUrl || other.dataUrl;
    const blobUrl = photo.blobUrl || other.blobUrl;
    if (dataUrl === photo.dataUrl && blobUrl === photo.blobUrl) return photo;
    changed = true;
    return { ...photo, dataUrl, ...(blobUrl ? { blobUrl } : {}) };
  });
  return changed ? merged : authoritative;
}

// Server-side companion to mergePhotoHandles. Older clients can hold the
// right photo id with an empty dataUrl and no blobUrl; a later edit to that
// place must not erase a Blob handle the server already knows.
export function preserveStoredPhotoHandles(incoming: unknown, stored: unknown): unknown {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return incoming;
  const next = incoming as { photos?: unknown };
  const prev = stored as { photos?: unknown };
  if (!Array.isArray(next.photos) || !Array.isArray(prev.photos)) return incoming;
  const isPhotoHandle = (value: unknown): value is Photo =>
    Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string");
  // The sync route accepts old client payloads rather than enforcing a full
  // Place schema. Keep that tolerance here: malformed arrays should remain the
  // upsert guard's concern, not throw merely because handle preservation ran.
  if (!next.photos.every(isPhotoHandle) || !prev.photos.every(isPhotoHandle)) return incoming;
  // Only the Blob HANDLE is carried over from the stored row, never its bytes.
  // Taking dataUrl too (mergePhotoHandles does, for a device's own cache) meant
  // a photo's first push — bytes, before upload — was resurrected under every
  // later stripped push, and the row kept 400–900K chars per photo for good.
  const storedById = new Map((prev.photos as Photo[]).map((photo) => [photo.id, photo]));
  let changed = false;
  const withHandles = (next.photos as Photo[]).map((photo) => {
    const stored = storedById.get(photo.id);
    if (!stored) return photo;
    if (!photo.blobUrl && stored.blobUrl) {
      changed = true;
      return { ...photo, blobUrl: stored.blobUrl };
    }
    // Not in Blob on either side: the stored bytes may be the only copy the
    // server has, so a device that never had them cannot erase them by
    // saving an unrelated edit. Dropped once the photo reaches Blob, below.
    if (!photo.blobUrl && !stored.blobUrl && !photo.dataUrl && stored.dataUrl) {
      changed = true;
      return { ...photo, dataUrl: stored.dataUrl };
    }
    return photo;
  });
  const photos = dropBlobBackedBytes(withHandles);
  return !changed && photos === withHandles ? incoming : { ...next, photos };
}

// Own photos whose bytes are in Blob carry no bytes in a synced record: the
// Blob is the copy, and each device caches it in IndexedDB on download. Bytes
// for a photo not uploaded yet stay, so nothing is lost in transit.
export function dropBlobBackedBytes(photos: Photo[]): Photo[] {
  if (!photos.some((photo) => photo.source === "mine" && photo.blobUrl && photo.dataUrl)) return photos;
  return photos.map((photo) =>
    photo.source === "mine" && photo.blobUrl && photo.dataUrl ? { ...photo, dataUrl: "" } : photo
  );
}
