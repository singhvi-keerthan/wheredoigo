import type { Metadata } from "next";
import AppShell from "@/components/AppShell";

// The app itself — Keerthan's library, and anyone else's who keeps one.
//
// This used to live at "/". It moved here on 2026-09-06 because the root is the
// link he actually sends people: a friend who opened the bare domain got THIS
// screen, read out of their own empty IndexedDB, and saw "0 places · Nothing
// pinned yet". The share view is the root now; the app is one path deeper.
//
// Nothing about the data moved. localStorage and IndexedDB are scoped to the
// ORIGIN, not the path, so every place, photo and sync connection survives the
// move untouched — a device that was connected before is still connected.
export const metadata: Metadata = {
  title: "wheredoigokeerthan — where are we eating?",
  description: "A private map of every place you've been and want to go.",
  robots: { index: false, follow: false }, // someone's private library, never a search result
};

export default function AppPage() {
  return <AppShell />;
}
