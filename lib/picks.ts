// The picks — the places you said yes to in the deck, kept so a yes leads
// somewhere. Before this a right swipe on a saved card toasted "Already on
// your map" and advanced, and the deck ended on "Start over": interest never
// became a decision. Now a yes adds the place here, the deck's header counts
// them, and the end of the deck is the list itself.
//
// Device-local, like the skip ledger (lib/skips.ts): a shortlist is tonight's
// state, not a fact about the place worth syncing. It persists across reloads
// and across lens changes — a new deck must not lose what the last one earned —
// and holds place ids only. A New card's yes already creates a Place (SwipeMode
// saveNew), so the pick references that record rather than a Swiggy row; no new
// class of Swiggy data is stored (Integration Agreement, see
// lib/swiggy-gate.ts).
//
// Every storage access is guarded: a private window or blocked site data makes
// this an empty list, never a crash.

import { useSyncExternalStore } from "react";

const KEY = "wheredoigokeerthan.picks.v1";

export interface Pick {
  id: string; // Place id
  at: string; // ISO — when it was picked, for ordering and a future "tonight" window
}

const EMPTY: Pick[] = [];
let cache: Pick[] | null = null;
const listeners = new Set<() => void>();

function isPick(v: unknown): v is Pick {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Pick).id === "string" &&
    typeof (v as Pick).at === "string"
  );
}

function read(): Pick[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(parsed) ? parsed.filter(isPick) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: Pick[]): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable — the list still works for this page; it
    // just won't be there after a reload.
  }
  for (const fn of listeners) fn();
}

export function readPicks(): Pick[] {
  return read();
}

export function hasPick(id: string): boolean {
  return read().some((p) => p.id === id);
}

// Returns true when the place was NOT already picked. Undo needs the
// distinction: taking back a swipe that merely re-confirmed an existing pick
// must leave the pick alone.
export function addPick(id: string): boolean {
  const cur = read();
  if (cur.some((p) => p.id === id)) return false;
  write([...cur, { id, at: new Date().toISOString() }]);
  return true;
}

export function removePick(id: string): void {
  const cur = read();
  if (!cur.some((p) => p.id === id)) return;
  write(cur.filter((p) => p.id !== id));
}

export function clearPicks(): void {
  if (read().length === 0) return;
  write([]);
}

export function subscribePicks(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// The list as React state. The server snapshot is a stable empty array so
// hydration never sees a different list from the first client render.
export function usePicks(): Pick[] {
  return useSyncExternalStore(subscribePicks, read, () => EMPTY);
}

// Tests only: forget the in-memory copy so the next read goes to storage.
export function _resetPicksForTests(): void {
  cache = null;
}
