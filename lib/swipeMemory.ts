import type { SwiggyRestaurant } from "./swiggy";

export type SwipeDir = "left" | "right";
export type NewSwipeMemory = Record<string, number>;

const KEY = "wheredoigokeerthan.newSwipeMemory.v1";
// A right swipe is rarer and more deliberate than a left one, so it moves an
// attribute further per swipe. The BOUNDS are what keep that from becoming a
// one-way ratchet: six rights reach the ceiling and six lefts reach the floor,
// so a cuisine you keep passing on can sink as fast as one you keep saving
// rises. (No time decay: nothing here has been measured yet, and a half-life
// picked out of the air would be a knob pretending to be a finding.)
const RIGHT_DELTA = 1;
const LEFT_DELTA = -0.5;
const MIN = -3;
const MAX = 6;
// The map is one localStorage value read on every deck build, and its keys are
// unbounded in principle — every cuisine word Swiggy has ever sent, every
// locality. Cap it and drop the faintest entries first: those are the ones a
// single stray swipe created, and the ones whose loss changes no ordering.
const MAX_KEYS = 120;

// Swiggy quotes cost for two and the app's budget is per head. Lives in this
// leaf module because both the price band below and the deck's rank math need
// it, and lib/swiggy.ts is server-only — importing a value from there would
// drag the MCP client into the browser bundle.
export const PER_PERSON = 2;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function clamp(n: number): number {
  return Math.max(MIN, Math.min(MAX, n));
}

function read(): NewSwipeMemory {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: NewSwipeMemory = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = clamp(value);
    }
    return out;
  } catch {
    return {};
  }
}

function write(memory: NewSwipeMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Storage unavailable means the deck stays non-personalized, not broken.
  }
}

function priceBand(priceForTwo: number | null): string | null {
  if (priceForTwo == null) return null;
  const perHead = priceForTwo / PER_PERSON;
  if (perHead <= 750) return "budget";
  if (perHead <= 1500) return "mid";
  return "premium";
}

export function newSwipeAttributeKeys(r: SwiggyRestaurant): string[] {
  const keys = new Set<string>();
  for (const cuisine of r.cuisines) {
    const key = norm(cuisine);
    if (key) keys.add(`cuisine:${key}`);
  }
  const area = norm(r.area);
  if (area) keys.add(`area:${area}`);
  const band = priceBand(r.priceForTwo);
  if (band) keys.add(`price:${band}`);
  return [...keys];
}

export function readNewSwipeMemory(): NewSwipeMemory {
  return read();
}

// Keep the strongest MAX_KEYS opinions, by absolute value — a -3 dislike is as
// worth keeping as a +3 like.
function prune(memory: NewSwipeMemory): NewSwipeMemory {
  const keys = Object.keys(memory);
  if (keys.length <= MAX_KEYS) return memory;
  const kept = keys
    .sort((a, b) => Math.abs(memory[b]) - Math.abs(memory[a]))
    .slice(0, MAX_KEYS);
  const out: NewSwipeMemory = {};
  for (const key of kept) out[key] = memory[key];
  return out;
}

function apply(r: SwiggyRestaurant, delta: number): NewSwipeMemory {
  const memory = read();
  for (const key of newSwipeAttributeKeys(r)) {
    const next = clamp((memory[key] ?? 0) + delta);
    if (Math.abs(next) < 0.05) delete memory[key];
    else memory[key] = next;
  }
  const pruned = prune(memory);
  write(pruned);
  return pruned;
}

export function recordNewSwipe(r: SwiggyRestaurant, dir: SwipeDir): NewSwipeMemory {
  return apply(r, dir === "right" ? RIGHT_DELTA : LEFT_DELTA);
}

export function undoNewSwipe(r: SwiggyRestaurant, dir: SwipeDir): NewSwipeMemory {
  return apply(r, dir === "right" ? -RIGHT_DELTA : -LEFT_DELTA);
}

export function newSwipeAffinity(memory: NewSwipeMemory, r: SwiggyRestaurant): number {
  return newSwipeAttributeKeys(r).reduce((sum, key) => sum + (memory[key] ?? 0), 0);
}
