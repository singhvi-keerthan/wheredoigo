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
  const photos = mergePhotoHandles(next.photos as Photo[], prev.photos as Photo[]);
  return photos === next.photos ? incoming : { ...next, photos };
}
