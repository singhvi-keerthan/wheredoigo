// Device-local "how many times have I left-swiped past this place" ledger.
// Left-swipe stays non-destructive (a soft dismiss), but repeatedly skipping the
// same saved place ramps toward a permanent hide: the 2nd skip prompts to set
// `neverAgain`. Kept OUT of the synced Place model on purpose — this is ephemeral
// per-device UX state, not a fact about the place worth propagating.
//
// It has to persist across sessions because a left-swiped card leaves the
// current deck, so the "2nd time" only ever lands when the place resurfaces in a
// later session or after a reshuffle.

const KEY = "imhungry.skips.v1";
type SkipMap = Record<string, number>;

function read(): SkipMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(m: SkipMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // storage full / unavailable — the nudge just won't escalate, no crash
  }
}

// Record a skip, return the new count (drives the "2 → ask" threshold).
export function bumpSkip(id: string): number {
  const m = read();
  const n = (m[id] ?? 0) + 1;
  m[id] = n;
  write(m);
  return n;
}

// Back to zero — "Not now" on the prompt, or the user added/kept the place.
// After this it takes two fresh skips to prompt again.
export function resetSkip(id: string): void {
  const m = read();
  if (m[id] != null) {
    delete m[id];
    write(m);
  }
}

// Undo a single skip (reverses the last left-swipe's count bump).
export function decSkip(id: string): void {
  const m = read();
  if (m[id]) {
    const n = m[id] - 1;
    if (n <= 0) delete m[id];
    else m[id] = n;
    write(m);
  }
}
