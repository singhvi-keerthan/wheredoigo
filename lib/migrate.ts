// One-time storage rename: local keys moved from the `imhungry.*` prefix to
// `wheredoigokeerthan.*` (2026-07 rebrand). Each old key is copied to its new
// name — never overwriting data already under the new one — so existing devices
// keep their places, tags, and sync pairing across the rename. Old keys were
// first left behind as a rollback safety net; since 2026-11 each is removed
// once its new key holds an identical copy, to give its space back.
//
// Runs at module-eval time via the side-effect import in lib/store.ts, which
// every consumer imports (directly or transitively) — so the copy is
// structurally guaranteed to happen before any key is read. Photo bytes live in
// IndexedDB and migrate separately (lib/photoStore.ts).

const LEGACY_PREFIX = "imhungry.";
const PREFIX = "wheredoigokeerthan.";
const KEYS = [
  "places.v1",
  "tags.v1",
  "skips.v1",
  "mascotTipSeen.v1",
  "deckHintSeen.v1",
  "sync.owner",
  "sync.cursor",
  "sync.dirty",
];

if (typeof window !== "undefined") {
  try {
    for (const k of KEYS) {
      const legacy = window.localStorage.getItem(LEGACY_PREFIX + k);
      if (legacy !== null && window.localStorage.getItem(PREFIX + k) === null) {
        window.localStorage.setItem(PREFIX + k, legacy);
      }
      // The rollback copy has outlived its purpose (the rename was 2026-07)
      // and an old photo-heavy places.v1 is megabytes of a ~5MB quota. Gone
      // only when the new key holds the SAME value — a true duplicate. An old
      // copy that differs may hold something the new one lacks, so it stays
      // for /app/recover.
      if (legacy !== null && window.localStorage.getItem(PREFIX + k) === legacy) {
        window.localStorage.removeItem(LEGACY_PREFIX + k);
      }
    }
  } catch {
    // private mode / quota — app starts empty, same as before the rename
  }
}

export {};
