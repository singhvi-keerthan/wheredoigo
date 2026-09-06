// Shared gates for the API routes: who is calling, are they allowed, and the
// one place that decides what a log line is permitted to say.
//
// Three tiers, and the difference matters:
//
//   crossOrigin()  — cheap, applies to everything. Blocks another site from
//                    embedding our endpoints in their page.
//   ownerFrom()    — the passphrase capability. Identifies a library.
//   isSiteOwner()  — Keerthan specifically, for the Swiggy routes.

// Reject requests that carry a cross-site Origin/Referer. Requests with NEITHER
// header (a script, curl, a PWA fetch) pass — that is the documented limit of
// this check, not an oversight. It stops a foreign page spending our quota; it
// does not stop a determined caller, which is what rateLimit and ownerFrom are
// for.
export function crossOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  for (const header of ["origin", "referer"]) {
    const value = request.headers.get(header);
    if (!value) continue;
    try {
      if (new URL(value).host !== host) return true;
    } catch {
      return true; // malformed header — treat as foreign
    }
  }
  return false;
}

export function forbidden(): Response {
  return Response.json({ error: "forbidden" }, { status: 403 });
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

// sha256(phrase) presented as a bearer token. It IS the capability — holding it
// is holding the library — so it is validated by shape here and never logged in
// full anywhere (see ownerTag).
const BEARER = /^Bearer ([0-9a-f]{64})$/;

export function ownerFrom(request: Request): string | null {
  const m = BEARER.exec(request.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

// Keerthan's own library, resolved server-side. Same value lib/public.ts renders
// the share view from; it never reaches a browser.
function siteOwner(): string | null {
  const raw = process.env.PUBLIC_OWNER_HASH?.trim();
  return raw && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
}

// Constant-time compare. Both strings are fixed-length lowercase hex, so this is
// a plain XOR fold — no timing signal about how many leading characters of a
// guess were right.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True only for the person whose Swiggy consent the MCP token represents.
//
// Every Swiggy route runs on ONE access token minted from Keerthan's own phone-
// and-OTP consent, so every call any visitor makes is a call made AS him. The
// Integration Agreement makes that his problem specifically: Cl. 4(viii) rate
// limits carry no numbers and Cl. 13.3(ii) makes breaching Cl. 4 an immediate-
// termination trigger, and under Cl. 5.3(i) he signed personally with uncapped
// liability. So these routes are not "authenticated" — they are HIS, and a
// visitor with a library of their own is still not allowed through.
export function isSiteOwner(request: Request): boolean {
  const own = ownerFrom(request);
  const site = siteOwner();
  if (!own || !site) return false;
  return sameSecret(own, site);
}

export function ownerOnly(): Response {
  return Response.json({ error: "owner_only" }, { status: 403 });
}

// ---- logging ---------------------------------------------------------------

// The first 8 hex characters of an owner key: enough to tell two libraries apart
// in a log, useless as a credential (the other 56 characters are still 224 bits).
// Nothing else in this app may log an owner value.
export function ownerTag(owner: string | null): string {
  return owner ? owner.slice(0, 8) : "anon";
}

// One structured line per interesting event, for Vercel's runtime logs.
//
// What is deliberately NOT in here: full owner keys, phrases, bearer tokens,
// request bodies, place names, notes, photo bytes, and IP addresses. An IP is
// personal data and this app has no privacy policy that would cover retaining
// it — the rate limiter keys on one in the database and never writes it out.
// `detail` is for counts and reasons, never content.
export function logEvent(route: string, event: string, detail: Record<string, string | number | boolean> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), route, event, ...detail }));
}
