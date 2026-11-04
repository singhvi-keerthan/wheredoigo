import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import "./globals.css";

// One family; the width axis does the work (condensed wordmark and drink
// names, normal body).
const sans = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth", "opsz"] });

export const metadata: Metadata = {
  title: "Coffee run",
  description: "The office coffee order",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#2340b8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>{children}</body>
    </html>
  );
}
