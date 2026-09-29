// When does the current Swiggy token die? For the laptop's launchd nudge
// (scripts/swiggy-renew-nudge.sh), which curls this twice a day and speaks up
// when the answer is soon — the piece that replaced "notice the deck broke".
//
// Deliberately ungated: the nudge is a bare curl with no owner header, and the
// only thing disclosed is an expiry instant — no token material, nothing about
// the library. hoursLeft < 0 means the token is already dead; null means no
// token is configured at all (or only the env fallback, whose expiry we still
// read so a pre-database deploy reports honestly).

import { storedSwiggyToken } from "@/lib/swiggyToken";
import { expiryOf } from "@/scripts/swiggy-oauth";

export async function GET() {
  const stored = await storedSwiggyToken();
  const envToken = process.env.SWIGGY_MCP_TOKEN?.trim() || null;
  const expiresAt = stored?.expiresAt ?? (envToken ? expiryOf(envToken) : null);
  const hoursLeft = expiresAt ? Math.round(((expiresAt.getTime() - Date.now()) / 3.6e6) * 10) / 10 : null;
  return Response.json({ expiresAt: expiresAt?.toISOString() ?? null, hoursLeft });
}
