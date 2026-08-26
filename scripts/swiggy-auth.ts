/**
 * Mint a Swiggy MCP access token from scratch.  `npm run swiggy:auth`
 *
 * Swiggy's Builders Club auth is OAuth 2.1 + PKCE with Dynamic Client
 * Registration (RFC 7591). MCP-native clients (Claude Desktop, Cursor) do this
 * invisibly; a server-rendered app has to do it itself, which is what this
 * script is for.
 *
 * Access tokens last 5 days and Swiggy issues no refresh token, so this — phone
 * and an OTP — IS the renewal, every 5 days. scripts/swiggy-oauth.ts records
 * why, and what would have to change on Swiggy's side for the cheaper
 * `npm run swiggy:refresh` path to become the routine one instead.
 *
 * Flow: discover endpoints -> register a client -> PKCE -> browser consent
 * (phone + OTP) -> exchange the code -> print the env lines to paste.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { discover, expiryLine, type TokenResponse } from "./swiggy-oauth";

const PORT = Number(process.env.SWIGGY_AUTH_PORT ?? 8765);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "mcp:tools";

const b64url = (b: Buffer) => b.toString("base64url");

// Always registers a fresh client. The previous version reused SWIGGY_CLIENT_ID
// to "skip re-registering", which was wrong twice over: this script never
// loaded .env.local (no dotenv, and tsx doesn't do it), so the variable was
// unset unless you exported it by hand — and now that the npm script DOES load
// it, reusing that id would hand back a client registered before we started
// asking for the refresh grant. Swiggy won't issue a refresh token to a client
// that never declared it, so a cached id would silently cost you the very thing
// this is for. Registration is one unauthenticated POST; caching saves nothing.
async function register(url: string): Promise<{ clientId: string; clientSecret?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "wheredoigokeerthan",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client — PKCE is the protection
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(`client registration failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!body.client_id) throw new Error("registration returned no client_id");
  return { clientId: body.client_id, clientSecret: body.client_secret };
}

// Serve the redirect once, hand back the authorization code.
function awaitCode(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<body style="font:16px system-ui;padding:3rem">${
          code && state === expectedState
            ? "Swiggy connected. You can close this tab."
            : "Something went wrong — check the terminal."
        }</body>`
      );
      server.close();

      if (error) return reject(new Error(`authorization failed: ${error}`));
      if (state !== expectedState) return reject(new Error("state mismatch — aborting"));
      if (!code) return reject(new Error("no authorization code in callback"));
      resolve(code);
    });
    server.listen(PORT);
    // Codes are single-use and expire in 120s; give the phone + OTP step room.
    setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for the browser callback"));
    }, 5 * 60_000).unref();
  });
}

async function main() {
  const endpoints = await discover();
  const { clientId, clientSecret } = await register(endpoints.registration);

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authUrl = new URL(endpoints.authorization);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  console.log("\nOpening Swiggy consent (phone + OTP):\n" + authUrl.toString() + "\n");
  const pending = awaitCode(state);
  exec(`open "${authUrl.toString()}"`); // macOS; the URL above is the fallback
  const code = await pending;

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  if (clientSecret) form.set("client_secret", clientSecret);

  const res = await fetch(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status}): ${await res.text()}`);

  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) throw new Error("token response had no access_token");

  console.log("\n" + expiryLine(token.access_token) + "\n");
  console.log("Paste into .env.local (and Vercel):\n");
  console.log(`SWIGGY_MCP_TOKEN=${token.access_token}`);
  console.log(`SWIGGY_CLIENT_ID=${clientId}`);
  if (token.refresh_token) {
    console.log(`SWIGGY_REFRESH_TOKEN=${token.refresh_token}`);
    console.log("\nWith those set, `npm run swiggy:refresh` renews the access token");
    console.log("with no phone and no OTP. Run it before the date above.");
  } else {
    console.log("\nNo refresh_token — expected, and not a failure: Swiggy doesn't issue");
    console.log("them (scripts/swiggy-oauth.ts has the evidence). The next renewal is");
    console.log("this same command, OTP included, before the date above.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nswiggy:auth failed —", err instanceof Error ? err.message : err);
  process.exit(1);
});
