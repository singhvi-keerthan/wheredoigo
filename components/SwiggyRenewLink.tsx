"use client";

import { useEffect } from "react";
import { startSwiggyRenew } from "@/lib/swiggyClient";

// #renew-swiggy — the deep link the laptop's expiry nudge opens (see
// scripts/swiggy-renew-nudge.sh). It exists because the deck's Reconnect
// button only renders once a search has already FAILED on a dead token;
// the nudge fires before that, while the token is merely dying, and needs a
// way to walk straight into the consent without a hunt through the UI.
//
// On Keerthan's device this starts the renewal and navigates to Swiggy's
// consent page (phone + OTP). Anywhere else the server answers owner_only and
// the hash is simply swallowed. Renders nothing.
export default function SwiggyRenewLink() {
  useEffect(() => {
    if (window.location.hash !== "#renew-swiggy") return;
    // Drop the hash first so a reload after the round-trip doesn't re-fire.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    void startSwiggyRenew().then(({ url }) => {
      if (url) window.location.assign(url);
    });
  }, []);
  return null;
}
