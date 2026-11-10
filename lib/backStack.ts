// The phone's Back, for surfaces that open over the app without a URL of their
// own: the deck, and the sheets on top of it (Filters, Picks). Each open
// surface holds one history entry; Back closes only the topmost (Filters
// first, then the deck — his call, 2026-11-07: "Just the filters"; Picks the
// same, 2026-11-10).
//
// A surface closed any other way (its own button, Escape) gives its entry back
// with history.back(). Every entry we push records its depth, so after any
// traversal — the user's Back or one of ours, coalesced or not — the listener
// reads where history actually is and reconciles: deeper than the open
// surfaces means a give-back is still owed (step back again, close nothing);
// shallower means the user went back past surfaces (close those, topmost
// first). A count of our own traversals could drift; the depth cannot.

type Entry = { id: number; onBack: () => void };

const stack: Entry[] = [];
let nextId = 1;
let installed = false;

const depthOf = (state: unknown) =>
  typeof (state as { wdgDepth?: unknown } | null)?.wdgDepth === "number"
    ? (state as { wdgDepth: number }).wdgDepth
    : 0;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", (e) => {
    const depth = depthOf(e.state);
    if (depth > stack.length) {
      window.history.back();
      return;
    }
    while (stack.length > depth) stack.pop()?.onBack();
  });
}

// Take an entry. Returns `release`, to call when the surface closes by any
// means; it is a no-op if Back already took the entry.
export function pushBack(onBack: () => void): () => void {
  install();
  const id = nextId++;
  stack.push({ id, onBack });
  window.history.pushState({ ...window.history.state, wdgDepth: stack.length }, "");
  return () => {
    const i = stack.findIndex((e) => e.id === id);
    if (i === -1) return;
    stack.splice(i, 1);
    window.history.back();
  };
}
