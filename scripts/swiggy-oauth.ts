/**
 * The OAuth bits both Swiggy token scripts need.
 *
 * What is actually true of Swiggy's authorization server, verified live on
 * 2026-08-27. Written down because the metadata is misleading and the obvious
 * reading of it costs a phone-and-OTP round trip to disprove:
 *
 * 1. The token endpoint DOES implement the refresh_token grant.
 *      grant_type=refresh_token + junk -> 401 invalid_grant "Refresh token
 *                                         invalid or expired"
 *      grant_type=client_credentials   -> 400 unsupported_grant_type  (control)
 *    An unimplemented grant comes back "unsupported"; refresh reached real
 *    refresh-token validation.
 *
 * 2. It nonetheless issues NO refresh token on the authorization_code exchange.
 *    Confirmed by running the full consent flow with a client registered for the
 *    grant: the token response carried access_token and nothing else.
 *
 * 3. Because Dynamic Client Registration is a stub. Every POST to /auth/register
 *    returns the SAME fixed client_id "swiggy-mcp" — a different client_name,
 *    different redirect_uris, even grant_types absent from their own
 *    grant_types_supported ("password", "implicit") all come back 200 with the
 *    request body echoed verbatim. Nothing is stored, so there is no per-client
 *    record for a declared refresh grant to live in. Do not read that echo as
 *    acceptance; it mirrors whatever you send. /auth/authorize likewise accepts
 *    any client_id at all, and validates no scope (offline_access passes
 *    straight through and does nothing).
 *
 * So the 5-day access token is a RE-CONSENT chore, not a renewal chore, and no
 * parameter on our side changes that. v1.0's docs were right; the metadata
 * advertising refresh_token is not. swiggy-refresh.ts is kept anyway because the
 * grant is live on their side — the day Swiggy starts issuing refresh tokens it
 * works untouched, and swiggy-auth.ts says so when one shows up.
 */

const BASE = process.env.SWIGGY_AUTH_BASE ?? "https://mcp.swiggy.com";

export type Endpoints = { authorization: string; token: string; registration: string };

// RFC 8414 metadata, with the documented paths as a fallback so a discovery
// hiccup doesn't block the whole flow.
export async function discover(): Promise<Endpoints> {
  const fallback: Endpoints = {
    authorization: `${BASE}/auth/authorize`,
    token: `${BASE}/auth/token`,
    registration: `${BASE}/auth/register`,
  };
  try {
    const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
    if (!res.ok) return fallback;
    const meta = (await res.json()) as Record<string, unknown>;
    return {
      authorization: (meta.authorization_endpoint as string) ?? fallback.authorization,
      token: (meta.token_endpoint as string) ?? fallback.token,
      registration: (meta.registration_endpoint as string) ?? fallback.registration,
    };
  } catch {
    return fallback;
  }
}

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

// The access token is an RS256 JWT and `exp` is the honest answer to "when does
// this die" — `expires_in` is relative to a clock we never observed, and Swiggy
// has been seen returning the SAME token (same iat/exp) for a re-authorization
// inside a live session, which makes a fresh-looking "good for 5 days" line a
// lie. Printing the absolute instant makes that visible instead of hiding it.
export function expiryOf(accessToken: string): Date | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { exp?: number };
    return claims.exp ? new Date(claims.exp * 1000) : null;
  } catch {
    return null;
  }
}

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

// One line describing when a freshly-minted access token stops working, in the
// timezone the person reading the terminal is actually in.
export function expiryLine(accessToken: string): string {
  const exp = expiryOf(accessToken);
  if (!exp) return "Token minted (expiry unreadable — not a JWT?).";
  const days = (exp.getTime() - Date.now()) / 86_400_000;
  return `Token valid until ${IST.format(exp)} IST — ${days.toFixed(1)} days from now.`;
}
