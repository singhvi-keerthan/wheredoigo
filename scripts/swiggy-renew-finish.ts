/**
 * The laptop renewal, finishing where prod reads.  `npm run swiggy:renew`
 *
 * Why this exists: Swiggy's consent page validates the redirect domain against
 * a client whitelist — seen 2026-09-30, "Oops, Vercel isn't whitelisted yet" —
 * so the in-app flow (/api/swiggy/renew, phone-friendly, any device) dead-ends
 * at their wall until they whitelist the domain. localhost IS whitelisted,
 * which is why scripts/swiggy-auth.ts still works. This script runs that
 * consent, then does exactly what /api/swiggy/renew/callback would have done:
 * prove the token against the live MCP, store it in the sync database (where
 * every prod lambda reads it — no env add, no redeploy), and keep .env.local's
 * fallback copy fresh for local dev.
 *
 * The only human step remains the phone + OTP in the tab this opens.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { probeBearer } from "../lib/swiggyMcp";
import { saveSwiggyCredentials } from "../lib/swiggyToken";
import { expiryLine, expiryOf } from "./swiggy-oauth";

function grab(out: string, key: string): string | null {
  const m = new RegExp(`^${key}=(.+)$`, "m").exec(out);
  return m ? m[1].trim() : null;
}

// Replace KEY=… in place, or append it — everything else byte-for-byte.
function upsertEnvLine(env: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(env)) return env.replace(re, line);
  return env.endsWith("\n") ? `${env}${line}\n` : `${env}\n${line}\n`;
}

async function main() {
  console.log("Opening the Swiggy consent (phone + OTP) — finish it in the browser tab…");
  const auth = spawnSync("npx", ["tsx", "scripts/swiggy-auth.ts"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    timeout: 6.5 * 60_000,
  });
  const out = auth.stdout ?? "";
  const token = grab(out, "SWIGGY_MCP_TOKEN");
  const refresh = grab(out, "SWIGGY_REFRESH_TOKEN");
  const clientId = grab(out, "SWIGGY_CLIENT_ID");
  if (auth.status !== 0 || !token) {
    console.error("\nswiggy:renew — the consent didn't complete, nothing changed.");
    process.exit(1);
  }

  // The same order the callback route uses: prove it, then store it.
  await probeBearer(token);
  await saveSwiggyCredentials({
    accessToken: token,
    refreshToken: refresh,
    clientId,
    expiresAt: expiryOf(token),
  });

  const envPath = new URL("../.env.local", import.meta.url).pathname;
  let env = readFileSync(envPath, "utf8");
  env = upsertEnvLine(env, "SWIGGY_MCP_TOKEN", token);
  if (refresh) env = upsertEnvLine(env, "SWIGGY_REFRESH_TOKEN", refresh);
  writeFileSync(envPath, env);

  console.log("\n" + expiryLine(token));
  console.log("Verified against the live MCP and stored in the sync DB — prod picks it");
  console.log("up within 60s, no deploy. .env.local's dev fallback is refreshed too.");
}

main().catch((err) => {
  console.error("\nswiggy:renew failed —", err instanceof Error ? err.message : err);
  process.exit(1);
});
