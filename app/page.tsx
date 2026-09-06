import type { Metadata } from "next";
import { getPublicLibrary, publicConfigured } from "@/lib/public";
import PublicShell from "@/components/PublicShell";

// The root — the map Keerthan sends when someone asks him where to go.
//
// It was at /go until 2026-09-06, and nothing linked to it, so the link he
// actually handed people (the bare domain) served the owner app instead: a
// friend's phone rendered its own empty IndexedDB as "0 places". The share view
// is what a stranger gets now, and the app moved to /app.
//
// Server-rendered on purpose, and with no matching API route: the records are
// read here, projected here (lib/public.ts), and handed to the client already
// stripped. There is no public endpoint anyone can enumerate, and the owner key
// never crosses to the browser.

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
  // A link he hands out — on a story, in a DM — not a page he publishes. Still
  // one line to flip if he ever wants it in search results; leaving it here
  // means an Instagram link does not also make his library permanently
  // Google-cacheable.
  robots: { index: false, follow: false },
};

export default async function SharePage() {
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
