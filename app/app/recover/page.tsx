import type { Metadata } from "next";
import RecoverShell from "@/components/RecoverShell";

// /app/recover — the screen for the day something is missing.
//
// Unlinked on purpose. It reads set-aside copies, orphaned photo bytes and the
// sync queue's leftovers: useful exactly once, alarming as a permanent row in
// a menu, and a URL you can be told over the phone.
export const metadata: Metadata = {
  title: "Recovery — wheredoigo",
  description: "Look for places and photos this device still has but the map isn’t showing.",
  robots: { index: false, follow: false },
};

export default function RecoverPage() {
  return <RecoverShell />;
}
