// The Android share sheet → the app. The manifest's share_target sends a
// share to /app?shared_title=…&shared_text=…&shared_url=… (GET; names
// prefixed so they can't collide with anything else /app reads).
//
// Instagram rarely fills `url`: a shared reel arrives as text — a caption,
// or "Check out this reel", with the link inside it — so every field is
// searched for a link. An Instagram link wins over any other, and its
// tracking query (igsh, utm_*) goes: it identifies who shared it, not the reel.

export const SHARE_PARAMS = ["shared_title", "shared_text", "shared_url"] as const;

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

function clean(link: string): string {
  const trimmed = link.replace(/[).,!?]+$/, "");
  try {
    const u = new URL(trimmed);
    if (/(^|\.)instagram\.com$/i.test(u.hostname)) {
      u.search = "";
      u.hash = "";
    }
    return u.toString();
  } catch {
    return trimmed;
  }
}

export function sharedLink(params: URLSearchParams): string | null {
  const found: string[] = [];
  for (const key of ["shared_url", "shared_text", "shared_title"]) {
    const v = params.get(key);
    if (v) found.push(...(v.match(URL_IN_TEXT) ?? []));
  }
  if (!found.length) return null;
  const insta = found.find((l) => /^https?:\/\/([a-z0-9-]+\.)*instagram\.com\//i.test(l));
  return clean(insta ?? found[0]);
}

// The same address without the share's own parameters — so a reload, or Back,
// doesn't open the add sheet a second time.
export function withoutShare(href: string): string {
  const u = new URL(href);
  for (const k of SHARE_PARAMS) u.searchParams.delete(k);
  return u.pathname + (u.search === "?" ? "" : u.search) + u.hash;
}

export function hasShare(params: URLSearchParams): boolean {
  return SHARE_PARAMS.some((k) => params.has(k));
}

// The share waiting for its place, per tab. sessionStorage, not local: a
// share belongs to the moment it was made, not to every later launch.
const PENDING_KEY = "wdg.share.pending";

export function readPendingShare(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

export function writePendingShare(link: string | null): void {
  try {
    if (link) sessionStorage.setItem(PENDING_KEY, link);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Not kept; the share still opens, it just won't survive a reload.
  }
}
