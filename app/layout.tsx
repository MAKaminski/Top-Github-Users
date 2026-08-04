import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { CondensingStickyNav } from "@/components/patterns/condensing-sticky-nav";
import { ContextualCursor } from "@/components/patterns/contextual-cursor";
import { CurtainRouteTransition } from "@/components/patterns/curtain-route-transition";
import { NumericPreloader, BootAnnouncer } from "@/components/patterns/numeric-preloader";
import { SiteBackground } from "@/components/background";
import { SiteFooter } from "@/components/site-footer";
import { getManifest, getWorldwide } from "@/lib/data";
import { REPO_SLUG, SITE_URL } from "@/lib/site";
import { StructuredData } from "@/components/structured-data";

const grotesk = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-grotesk",
  // The hero is the LCP element on almost every page — preload the face.
  preload: true,
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-face",
  preload: true,
});

const DESCRIPTION =
  "Worldwide, country and city leaderboards of the most active developers on GitHub, with contribution heatmaps, rank movement and the charts every other ranking site leaves out.";

export const metadata: Metadata = {
  /**
   * Without this, Next resolves Open Graph and canonical URLs relatively, which
   * means a crawler or a social card renderer receives a path with no origin
   * and silently drops it. It is the single highest-value line in this object.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Commitgraph — the most active developers on GitHub",
    template: "%s · Commitgraph",
  },
  description: DESCRIPTION,
  applicationName: "Commitgraph",
  keywords: [
    "GitHub leaderboard",
    "most active GitHub developers",
    "GitHub contributions ranking",
    "top developers by country",
    "open source contributors",
    "MCP server",
    "Claude connector",
  ],
  authors: [{ name: "Michael Kaminski", url: `https://github.com/${REPO_SLUG.split("/")[0]}` }],
  creator: "Michael Kaminski",
  openGraph: {
    title: "Commitgraph — the most active developers on GitHub",
    description: DESCRIPTION,
    type: "website",
    siteName: "Commitgraph",
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Commitgraph — the most active developers on GitHub",
    description: "The most active developers on GitHub, visualised properly.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  themeColor: "#07070a",
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The background is seeded from the real contribution distribution, so the
  // field behind the page is the dataset rather than decoration.
  const [manifest, worldwide] = await Promise.all([getManifest(), getWorldwide()]);
  const max = Math.max(1, ...worldwide.entries.map((entry) => entry.total));
  const seed = worldwide.entries
    .slice(0, 420)
    .map((entry) => Math.sqrt(entry.total / max));

  return (
    <html lang="en" className={`${grotesk.variable} ${mono.variable}`}>
      <body>
        <StructuredData manifest={manifest} />
        <SiteBackground seed={seed} />
        <NumericPreloader />
        <CurtainRouteTransition />
        <ContextualCursor />
        <BootAnnouncer />

        <a href="#main" className="skip-link mono">
          Skip to content
        </a>

        <CondensingStickyNav />

        <main id="main" className="relative">
          {children}
        </main>

        <SiteFooter manifest={manifest} topLogins={worldwide.entries.slice(0, 18)} />
      </body>
    </html>
  );
}
