/**
 * Mint a Swiggy MCP access token.  `npm run swiggy:auth`
 *
 * Swiggy's Builders Club auth is OAuth 2.1 + PKCE with Dynamic Client
 * Registration (RFC 7591). MCP-native clients (Claude Desktop, Cursor) do this
 * invisibly; a server-rendered app has to do it itself, which is what this
 * script is for.
 *
 * The important constraint, straight from the docs: access tokens last **5
 * days** and there are **no refresh tokens in v1.0** — "always treat 401 as
 * 're-run authorization'". So this isn't a one-time setup step. It's a chore
 * that comes back roughly weekly, which is why it's a script and not a
 * paragraph in the README.
 *
 * Flow: discover endpoints → register a client → PKCE → browser consent
 * (phone + OTP) → exchange the code → print the env line to paste.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";

const BASE = process.env.SWIGGY_AUTH_BASE ?? "https://mcp.swiggy.com";
const PORT = Number(process.env.SWIGGY_AUTH_PORT ?? 8765);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "mcp:tools";

const b64url = (b: Buffer) => b.toString("base64url");

type Endpoints = { authorization: string; token: string; registration: string };

// RFC 8414 metadata, with the documented paths as a fallback so a discovery
// hiccup doesn't block the whole flow.
async function discover(): Promise<Endpoints> {
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

async function register(url: string): Promise<{ clientId: string; clientSecret?: string }> {
  // A client id can be reused across runs — only the token expires. Set
  // SWIGGY_CLIENT_ID to skip re-registering every time.
  if (process.env.SWIGGY_CLIENT_ID) {
    return {
      clientId: process.env.SWIGGY_CLIENT_ID,
      clientSecret: process.env.SWIGGY_CLIENT_SECRET,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "wheredoigokeerthan",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
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

  const token = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("token response had no access_token");

  const days = token.expires_in ? (token.expires_in / 86400).toFixed(1) : "~5";
  console.log(`\nToken good for ${days} days. Add to .env.local (and Vercel):\n`);
  console.log(`SWIGGY_MCP_TOKEN=${token.access_token}`);
  if (!process.env.SWIGGY_CLIENT_ID) {
    console.log(`SWIGGY_CLIENT_ID=${clientId}   # reuse this to skip re-registering`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\nswiggy:auth failed —", err instanceof Error ? err.message : err);
  process.exit(1);
});
