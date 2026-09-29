// Where Swiggy sends the browser after the phone + OTP consent that
// /api/swiggy/renew started. This is the half that used to be the laptop's
// job: exchange the code, prove the token works, store it where every lambda
// reads it (lib/swiggyToken.ts). By the time the success page renders, the
// deck is already live again — nothing else to run, nothing to deploy.
//
// The gate here is the httpOnly cookie the start route set: it carries the
// state and PKCE verifier, so a request that didn't begin as Keerthan's
// renewal has no cookie, fails the state check, and exchanges nothing.

import { logEvent } from "@/lib/api-guard";
import { probeBearer } from "@/lib/swiggyMcp";
import { saveSwiggyCredentials, bustSwiggyTokenCache } from "@/lib/swiggyToken";
import { discover, expiryOf, type TokenResponse } from "@/scripts/swiggy-oauth";

const CLEAR_COOKIE = "swiggy_renew=; Path=/api/swiggy/renew; HttpOnly; SameSite=Lax; Max-Age=0";

const IST = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

// A plain dark page, phone-first — this renders in whatever browser did the
// OTP, most often the phone's. Body is trusted markup built here, never
// echoed request input.
function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;background:#141110;color:#f4f0ee;font:16px/1.5 system-ui;display:grid;min-height:100dvh;place-items:center">
<main style="padding:2rem;max-width:26rem;text-align:center">
<h1 style="font-size:1.2rem;margin:0 0 .5rem">${title}</h1>
<p style="margin:0;color:rgba(244,240,238,.72)">${body}</p>
<p style="margin:2rem 0 0;font-size:.75rem;color:rgba(244,240,238,.45)">Powered by Swiggy Dineout</p>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": CLEAR_COOKIE },
  });
}

interface RenewCookie {
  s: string; // state
  v: string; // PKCE verifier
  c: string; // client id
  r: string; // exact redirect_uri the consent was started with
}

function readCookie(request: Request): RenewCookie | null {
  const header = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)swiggy_renew=([^;]+)/.exec(header);
  if (!match) return null;
  try {
    const parsed = JSON.parse(Buffer.from(match[1], "base64url").toString()) as Partial<RenewCookie>;
    return parsed.s && parsed.v && parsed.c && parsed.r ? (parsed as RenewCookie) : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cookie = readCookie(request);

  if (params.get("error")) {
    logEvent("swiggy/renew", "consent_denied");
    return page("Swiggy said no", "The consent was declined or expired. Open the app and tap Reconnect Swiggy to try again.", 400);
  }
  const code = params.get("code");
  if (!cookie || !code || params.get("state") !== cookie.s) {
    logEvent("swiggy/renew", "callback_rejected");
    return page(
      "This renewal didn’t start from the app",
      "Open the app and tap Reconnect Swiggy — the consent has to begin there.",
      403
    );
  }

  try {
    const endpoints = await discover();
    const res = await fetch(endpoints.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cookie.r,
        client_id: cookie.c,
        code_verifier: cookie.v,
      }),
    });
    if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
    const token = (await res.json()) as TokenResponse;
    if (!token.access_token) throw new Error("token response had no access_token");

    // Prove it before storing it — a mint that can't list tools must fail
    // HERE, on a page someone is looking at, not as the deck's next 401.
    await probeBearer(token.access_token);

    const expiresAt = expiryOf(token.access_token);
    await saveSwiggyCredentials({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      clientId: cookie.c,
      expiresAt,
    });
    bustSwiggyTokenCache();

    const hours = expiresAt ? Math.round((expiresAt.getTime() - Date.now()) / 3.6e6) : null;
    logEvent("swiggy/renew", "renewed", { hoursValid: hours ?? -1 });
    return page(
      "Swiggy reconnected",
      expiresAt
        ? `The new token is verified and live — good until ${IST.format(expiresAt)} IST. You can close this tab.`
        : "The new token is verified and live. You can close this tab."
    );
  } catch (err) {
    console.error("[swiggy] renew callback failed", err);
    return page(
      "Renewal didn’t finish",
      "Swiggy answered, but the exchange or the verification failed — nothing was stored, the old state stands. Open the app and tap Reconnect Swiggy to retry.",
      502
    );
  }
}
