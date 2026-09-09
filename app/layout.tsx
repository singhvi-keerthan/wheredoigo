import type { Metadata, Viewport } from "next";
import { Spline_Sans_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import RegisterSW from "@/components/RegisterSW";
import SyncBoot from "@/components/SyncBoot";

// Display = Zodiak, UI = General Sans (both Fontshare, loaded via <link>).
// Data = Spline Sans Mono for ratings/prices.
const monoData = Spline_Sans_Mono({
  variable: "--font-mono-data",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Place NAMES only — elegant serif (color-system spec).
const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "wheredoigokeerthan — where are we eating?",
  description: "A private map of every place you've been and want to go.",
  manifest: "/manifest.webmanifest",
  // Every size iOS and Android actually ask for, each carrying its `sizes`
  // attribute. There used to be exactly one apple-touch-icon and it declared no
  // size at all, which leaves the installer guessing from a single unlabelled
  // candidate — and a guess is all it takes to land a blank tile on the home
  // screen. 120/152/167/180 are the iPhone and iPad home-screen sizes, 192 is
  // what Android and Chrome look for, 512 is the splash/store size.
  //
  // The 180 points at /icon-180.png rather than /apple-touch-icon.png, and the
  // rename is the fix, not tidying. Declaring the sizes did not put the icon on
  // Keerthan's home screen, and everything the server controls checks out —
  // every file 200s as a correctly sized RGB PNG with no alpha, the manifest
  // serves as application/manifest+json, and the links are in the HTML. What is
  // left is the one cache no deploy can reach: iOS keys a web-clip icon by URL
  // and keeps it well past the tile being deleted, so a home screen that once
  // fetched a bad /apple-touch-icon.png keeps showing that answer no matter how
  // many times the file behind it is fixed. 180 is the largest candidate and
  // therefore the one iOS reaches for first, so it is the one whose URL has to
  // change. The old path stays on disk — it is the implicit /apple-touch-icon
  // .png that anything ignoring these link tags falls back to.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icon-120.png", sizes: "120x120", type: "image/png" },
      { url: "/icon-152.png", sizes: "152x152", type: "image/png" },
      { url: "/icon-167.png", sizes: "167x167", type: "image/png" },
      { url: "/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "wheredoigo" },
};

export const viewport: Viewport = {
  themeColor: "#080b11",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${monoData.variable} ${serif.variable} h-full`}>
      <head>
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=zodiak@400,500,700&f[]=general-sans@400,500,600&display=swap"
        />
      </head>
      <body className="h-full">
        {children}
        <RegisterSW />
        <SyncBoot />
      </body>
    </html>
  );
}
