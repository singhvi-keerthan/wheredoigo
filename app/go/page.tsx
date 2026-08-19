import type { Metadata } from "next";
import { getPublicLibrary, publicConfigured } from "@/lib/public";
import PublicShell from "@/components/PublicShell";

// /go — the link Keerthan sends when someone asks him where to go.
//
// Server-rendered on purpose, and with no matching API route: the records are
// read here, projected here (lib/public.ts), and handed to the client already
// stripped. There is no public endpoint anyone can enumerate, and the owner
// key never crosses to the browser.
//
// The app itself stays exactly where it was at "/" — same bookmark, same
// installed PWA, same passphrase. Nothing on this page can write.

export const dynamic = "force-dynamic"; // the stamp has to be true, not cached

export const metadata: Metadata = {
  title: "wheredoigokeerthan — where should we eat?",
  description:
    "Every place Keerthan has been or wants to go in Bengaluru — what he rated it, what he paid, and the ones he'd skip.",
  openGraph: {
    title: "wheredoigokeerthan",
    description: "Where Keerthan has actually been — rated, priced, and the ones to skip.",
    images: ["/icon.png"],
  },
  // A link he hands to people, not a page he publishes. One line to flip if he
  // ever wants it in search results.
  robots: { index: false, follow: false },
};

export default async function GoPage() {
  if (!publicConfigured) {
    return (
      <main className="grid min-h-dvh place-items-center px-8" style={{ background: "var(--bg-base)" }}>
        <p className="max-w-[320px] text-center text-[14px] leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
          This map isn’t shared yet.
        </p>
      </main>
    );
  }

  const { places, updatedAgo } = await getPublicLibrary();
  return <PublicShell places={places} updatedAgo={updatedAgo} />;
}
