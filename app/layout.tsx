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
  title: "im hungry — where are we eating?",
  description: "A private map of every place you've been and want to go.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "im hungry" },
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
