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
