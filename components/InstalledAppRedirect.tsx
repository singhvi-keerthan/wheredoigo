"use client";

import { useEffect } from "react";

// Sends an ALREADY-INSTALLED home-screen app from "/" to "/app".
//
// The app used to live at "/", so every install made before the move captured
// `start_url: "/"` — and an installed PWA keeps the start_url it was installed
// with, regardless of what the manifest says now. Without this, tapping the old
// home-screen icon opens the read-only share view: Keerthan's map, none of your
// places, nothing you can edit. It looks exactly like the app lost your data.
//
// `display-mode: standalone` is the discriminator, and it is a narrow one on
// purpose. A friend who taps the link from a story is in a browser and is not
// standalone, so they stay on the share view where they belong. Only something
// launched from a home-screen icon matches — which, at "/", can only be an
// install from before the move.
//
// `replace`, not `push`, so the back button doesn't bounce between the two.
// Once they reinstall, start_url is "/app" and this never fires again.
export default function InstalledAppRedirect() {
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari predates display-mode and still reports it here only.
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) window.location.replace("/app");
  }, []);
  return null;
}
