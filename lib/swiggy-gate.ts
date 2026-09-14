// One gate for all four /api/swiggy/* routes.
//
// Every Swiggy call this app makes runs on a single access token minted from
// Keerthan's own phone-and-OTP consent (SWIGGY_MCP_TOKEN). There is no per-user
// Swiggy identity anywhere in the system, so a booking made by a visitor is a
// booking made AS HIM, against his account, on his consent.
//
// Before this gate the routes were reachable by anyone who knew the domain —
// `crossOrigin()` alone, which by design passes any request without an Origin
// header. That is three separate problems under the Integration Agreement:
//
//   Cl. 4(viii)   — rate limits, request quotas, payload sizes and concurrency
//                   exist as CATEGORIES with no numbers, "notified from time to
//                   time". Cl. 13.3(ii) makes breaching Cl. 4 an immediate-
//                   termination trigger. An unknown ceiling that terminates on
//                   contact is one you stay far away from.
//   Cl. 3.3(i)    — Swiggy customer data is purpose-limited to consummating
//                   orders, and data for abandoned orders cannot be stored at
//                   all. Strangers generating half-finished bookings creates
//                   exactly that data.
//   Cl. 5.3(i)    — he signed personally, uncapped, against Swiggy's INR 50,000
//                   cap. There is no company between him and any of it.
//
// So these routes are not "authenticated", they are HIS. A visitor with a
// perfectly valid library of their own is still not allowed through. The
// deliberate consequence: Swiggy discovery and booking work on a device
// connected to Keerthan's own library, and nowhere else.

import { crossOrigin, forbidden, isSiteOwner, ownerOnly, logEvent } from "@/lib/api-guard";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { SwiggyAuthError, SwiggyRateLimitError } from "@/lib/swiggyMcp";

// One answer for a Swiggy failure, shared by the four routes, because two of
// its states are ones the client must ACT on and must not mistake for an
// outage: a 401 (tokens last 5 days — reconnect), and a 429 (Swiggy, or our
// own meter, said stop — wait, for the seconds it named, sent as Retry-After).
// Everything else is the outage it always was.
export function swiggyFailure(err: unknown, route: string, body: Record<string, unknown>): Response {
  if (err instanceof SwiggyAuthError) {
    return Response.json({ error: "swiggy_reauth", ...body }, { status: 401 });
  }
  if (err instanceof SwiggyRateLimitError) {
    logEvent(route, "swiggy_rate_limited", { retryAfter: err.retryAfterSec });
    return Response.json(
      { error: "swiggy_busy", retryAfter: err.retryAfterSec, ...body },
      { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } }
    );
  }
  console.error(`[swiggy] ${route} failed`, err);
  return Response.json({ error: "swiggy_unavailable", ...body }, { status: 502 });
}

// Well under any plausible notified limit. Swipe Mode fetches details per card,
// so a browsing session spends a few dozen; 300/hour leaves room for a long
// session and still bounds a runaway loop.
const SWIGGY = { limit: 300, windowSec: 3600 };

// Returns a Response to send back, or null to proceed.
export async function swiggyGate(request: Request, route: string): Promise<Response | null> {
  if (crossOrigin(request)) return forbidden();

  if (!isSiteOwner(request)) {
    logEvent(route, "owner_only_rejected");
    return ownerOnly();
  }

  const limited = await rateLimit("swiggy:all", SWIGGY.limit, SWIGGY.windowSec);
  if (!limited.ok) {
    // Keyed globally, not per address: the thing being protected is the single
    // shared token's call volume as Swiggy sees it, which is the sum across
    // every device and every address Keerthan uses.
    logEvent(route, "rate_limited", { count: limited.count, limit: limited.limit });
    return tooMany();
  }

  return null;
}
