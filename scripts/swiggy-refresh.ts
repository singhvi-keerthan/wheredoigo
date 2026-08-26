/**
 * Renew the Swiggy MCP access token without a phone or an OTP.
 *   `npm run swiggy:refresh`
 *
 * This is the routine chore. `swiggy:auth` is the first-connection one — it
 * needs browser consent, this doesn't. Needs SWIGGY_CLIENT_ID and
 * SWIGGY_REFRESH_TOKEN in .env.local, both printed by a `swiggy:auth` run.
 *
 * Swiggy registers us as a public client (no client secret — PKCE is the
 * protection), and OAuth 2.1 requires refresh-token ROTATION for public
 * clients: each refresh may invalidate the token you just spent and hand back a
 * new one. So a returned refresh_token isn't optional noise to skip past — miss
 * it and the next run fails with invalid_grant and you're back to the OTP.
 */

import { discover, expiryOf, expiryLine, type TokenResponse } from "./swiggy-oauth";

async function main() {
  const clientId = process.env.SWIGGY_CLIENT_ID;
  const refreshToken = process.env.SWIGGY_REFRESH_TOKEN;

  if (!clientId || !refreshToken) {
    const missing = [
      !clientId && "SWIGGY_CLIENT_ID",
      !refreshToken && "SWIGGY_REFRESH_TOKEN",
    ].filter(Boolean);
    throw new Error(
      `${missing.join(" and ")} missing from .env.local — run \`npm run swiggy:auth\` once to get ${
        missing.length > 1 ? "them" : "it"
      }.`
    );
  }

  const endpoints = await discover();
  const res = await fetch(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    // The expected end-of-life path, not a crash: refresh tokens expire too, and
    // when this one does the only way back is full consent.
    if (body.includes("invalid_grant")) {
      throw new Error(
        "the refresh token is expired or already spent — run `npm run swiggy:auth` for a new pair."
      );
    }
    throw new Error(`refresh failed (${res.status}): ${body}`);
  }

  const token = JSON.parse(body) as TokenResponse;
  if (!token.access_token) throw new Error("refresh response had no access_token");

  // Swiggy has handed back a byte-identical token for a repeat authorization
  // inside a live session. If refresh does the same the renewal bought nothing,
  // and printing a confident "valid until" line over an unchanged expiry would
  // be the lie that hides it — so compare against the token already in the env.
  const before = process.env.SWIGGY_MCP_TOKEN?.trim();
  const oldExp = before ? expiryOf(before) : null;
  const newExp = expiryOf(token.access_token);
  if (before && token.access_token === before) {
    console.log("\nSwiggy returned the SAME access token — expiry did not move.");
    console.log("Nothing to paste. Renewal here is session-bound, so this token has");
    console.log("to actually lapse before a new one is issued.\n");
    return;
  }
  if (oldExp && newExp && newExp.getTime() <= oldExp.getTime()) {
    console.log("\nWarning: the new token expires no later than the old one.\n");
  }

  console.log("\n" + expiryLine(token.access_token) + "\n");
  console.log("Paste into .env.local (and Vercel):\n");
  console.log(`SWIGGY_MCP_TOKEN=${token.access_token}`);
  if (token.refresh_token && token.refresh_token !== refreshToken) {
    console.log(`SWIGGY_REFRESH_TOKEN=${token.refresh_token}`);
    console.log("\nThe refresh token rotated — update it too, or the next run fails.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nswiggy:refresh failed —", err instanceof Error ? err.message : err);
  process.exit(1);
});
