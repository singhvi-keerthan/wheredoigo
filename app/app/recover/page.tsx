import type { Metadata } from "next";
import RecoverShell from "@/components/RecoverShell";

// /app/recover — the screen for the day something is missing.
//
// Reached from the Menu, under Backup. It shipped unlinked, on the theory that
// a screen for a bad day should not take a row on a good one — and that theory
// held for about an hour, until Keerthan asked the question that breaks it: the
// places were added through the installed PWA. A home-screen web clip has no
// address bar, so from there the URL cannot be typed; and iOS gives the clip
// its own storage container, so running the scan from Safari instead reads a
// different, near-empty store and honestly reports finding nothing. Unlinked
// made it unreachable from the app and misleading from outside it.
export const metadata: Metadata = {
  title: "Recovery — wheredoigo",
  description: "Look for places and photos this device still has but the map isn’t showing.",
  robots: { index: false, follow: false },
};

export default function RecoverPage() {
  return <RecoverShell />;
}
