// Start a Swiggy token renewal from ANY device — the cloud half of what
// `npm run swiggy:auth` does on the laptop.
//
// Same OAuth 2.1 + PKCE dance as scripts/swiggy-auth.ts, with one difference
// that changes everything operationally: the redirect_uri is this deployment's
// own /api/swiggy/renew/callback instead of localhost. So the consent (phone +
// OTP — the one step only Keerthan can do) happens in whatever browser called
// this, and the callback lands back on prod, which finishes the whole chain
// server-side. No laptop, no env edit, no redeploy.
//
// The PKCE verifier and state never leave the server unprotected: they ride in
// an httpOnly SameSite=Lax cookie scoped to the callback path, which is also
// the callback's CSRF gate — a hit that didn't start here carries no cookie
// and is refused.

import { randomBytes, createHash } from "node:crypto";
import { swiggyGate } from "@/lib/swiggy-gate";
import { logEvent } from "@/lib/api-guard";
import { discover } from "@/scripts/swiggy-oauth";

const SCOPE = "mcp:tools";
const b64url = (b: Buffer) => b.toString("base64url");

// Same registration scripts/swiggy-auth.ts sends (see there for why caching a
// client id would be wrong), except the redirect points at this deployment.
async function register(url: string, redirectUri: string): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "wheredoigokeerthan",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`client registration failed (${res.status})`);
  const body = (await res.json()) as { client_id?: string };
  if (!body.client_id) throw new Error("registration returned no client_id");
  return body.client_id;
}

export async function POST(request: Request) {
  const gate = await swiggyGate(request, "swiggy/renew");
  if (gate) return gate;

  // The public origin, from the same headers crossOrigin() trusts. The
  // callback recomputes nothing — the exact redirect_uri travels in the
  // cookie, because the token exchange must repeat it byte-for-byte.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return Response.json({ error: "bad_request" }, { status: 400 });
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const redirectUri = `${proto}://${host}/api/swiggy/renew/callback`;

  try {
    const endpoints = await discover();
    const clientId = await register(endpoints.registration, redirectUri);

    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(16));

    const consent = new URL(endpoints.authorization);
    consent.searchParams.set("response_type", "code");
    consent.searchParams.set("client_id", clientId);
    consent.searchParams.set("redirect_uri", redirectUri);
    consent.searchParams.set("scope", SCOPE);
    consent.searchParams.set("state", state);
    consent.searchParams.set("code_challenge", challenge);
    consent.searchParams.set("code_challenge_method", "S256");

    const payload = b64url(
      Buffer.from(JSON.stringify({ s: state, v: verifier, c: clientId, r: redirectUri }))
    );
    // Path covers /api/swiggy/renew/callback; Lax survives the top-level
    // redirect back from Swiggy. 10 minutes is the consent's lifetime here —
    // scripts/swiggy-auth.ts gives the phone + OTP 5.
    const cookie = [
      `swiggy_renew=${payload}`,
      "Path=/api/swiggy/renew",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=600",
      ...(proto === "https" ? ["Secure"] : []),
    ].join("; ");

    logEvent("swiggy/renew", "consent_started");
    return Response.json({ consentUrl: consent.toString() }, { headers: { "Set-Cookie": cookie } });
  } catch (err) {
    console.error("[swiggy] renew start failed", err);
    return Response.json({ error: "swiggy_unavailable" }, { status: 502 });
  }
}