// Whether swipe mode opens on the two doors ("go wild" / "I know what I
// want") or straight onto the deck. A per-device convenience, so it lives in
// localStorage — and every access is guarded: a private window, blocked site
// data or a preview can throw or come back empty, and the answer then is the
// default (show the doors), never a crash.

const KEY = "wdg.swipe.askOnOpen";

export function askOnOpen(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAskOnOpen(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Not remembered on this device; the doors simply show next time.
  }
}
