import type { Metadata, Viewport } from "next";
import { Sofia_Sans, Sofia_Sans_Condensed } from "next/font/google";
import { Footer } from "@/components/chrome/Footer";
import { Frame } from "@/components/chrome/Frame";
import { Header } from "@/components/chrome/Header";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const text = Sofia_Sans({ subsets: ["latin"], variable: "--font-text", display: "swap" });
const cond = Sofia_Sans_Condensed({ subsets: ["latin"], variable: "--font-cond", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Dialed: read any analog gauge from a phone photo", template: "%s · Dialed" },
  description:
    "Dialed straightens the dial, unrolls the scale and reads the needle with OpenCV 5. Then an agent decides: log the reading, ask for a better photo, or hold a work order until someone signs it off.",
  openGraph: { type: "website", siteName: "Dialed", images: ["/og.png"] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9faf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1318" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${text.variable} ${cond.variable}`}>
      <body style={{ position: "relative", minHeight: "100vh" }}>
        <a href="#main" className="skip">Skip to content</a>
        <Frame />
        <Header />
        <main id="main" style={{ position: "relative", zIndex: 1 }}>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
