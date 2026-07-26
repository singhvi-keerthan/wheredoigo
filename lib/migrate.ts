// One-time storage rename: local keys moved from the `imhungry.*` prefix to
// `wheredoigokeerthan.*` (2026-07 rebrand). Each old key is copied to its new
// name — never overwriting data already under the new one — so existing devices
// keep their places, tags, and sync pairing across the rename. Old keys are
// left behind as a rollback safety net; nothing reads them anymore.
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
    }
  } catch {
    // private mode / quota — app starts empty, same as before the rename
  }
}

export {};
