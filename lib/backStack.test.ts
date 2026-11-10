import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal history: entries with state, an index, and popstate fired on
// traversal. `coalesce` makes back() calls queue and land as ONE event — the
// case where a count of our own traversals used to drift.
function fakeHistory() {
  const entries: unknown[] = [null];
  let index = 0;
  let queued = 0;
  const listeners: ((e: { state: unknown }) => void)[] = [];
  const fire = () => listeners.forEach((l) => l({ state: entries[index] }));
  const history = {
    get state() {
      return entries[index];
    },
    pushState(state: unknown) {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    },
    back() {
      queued++;
    },
  };
  // Lands every queued back() as one traversal, one event.
  const settle = () => {
    while (queued) {
      const n = queued;
      queued = 0;
      index = Math.max(0, index - n);
      fire();
    }
  };
  const userBack = () => {
    index = Math.max(0, index - 1);
    fire();
    settle();
  };
  return {
    history,
    settle,
    userBack,
    index: () => index,
    addEventListener: (_: string, l: (e: { state: unknown }) => void) => listeners.push(l),
  };
}

let h: ReturnType<typeof fakeHistory>;
async function fresh() {
  vi.resetModules();
  h = fakeHistory();
  vi.stubGlobal("window", { history: h.history, addEventListener: h.addEventListener });
  return await import("./backStack");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("backStack", () => {
  it("Back closes the topmost surface only", async () => {
    const { pushBack } = await fresh();
    const deck = vi.fn();
    const filters = vi.fn();
    pushBack(deck);
    pushBack(filters);
    h.userBack();
    expect(filters).toHaveBeenCalledTimes(1);
    expect(deck).not.toHaveBeenCalled();
    h.userBack();
    expect(deck).toHaveBeenCalledTimes(1);
  });

  it("two releases landing as one traversal leave Back working (Picks → open a place)", async () => {
    const { pushBack } = await fresh();
    const releaseDeck = pushBack(vi.fn());
    const releasePicks = pushBack(vi.fn());
    releaseDeck(); // non-top first
    releasePicks();
    h.settle();
    expect(h.index()).toBe(0);

    const next = vi.fn();
    pushBack(next);
    h.userBack();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("a release still in flight when a new surface opens does not close it", async () => {
    const { pushBack } = await fresh();
    const release = pushBack(vi.fn());
    release();
    const reopened = vi.fn();
    pushBack(reopened); // before the release's traversal lands
    h.settle();
    expect(reopened).not.toHaveBeenCalled();
    h.userBack();
    expect(reopened).toHaveBeenCalledTimes(1);
  });

  it("a closed surface's release after Back took it is a no-op", async () => {
    const { pushBack } = await fresh();
    const release = pushBack(vi.fn());
    h.userBack();
    release();
    h.settle();
    expect(h.index()).toBe(0);
  });
});
