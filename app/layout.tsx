import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { Analytics } from "@/components/analytics";

import { CondensingStickyNav } from "@/components/patterns/condensing-sticky-nav";
import { ContextualCursor } from "@/components/patterns/contextual-cursor";
import { CurtainRouteTransition } from "@/components/patterns/curtain-route-transition";
import { NumericPreloader, BootAnnouncer } from "@/components/patterns/numeric-preloader";
import { SiteBackground } from "@/components/background";
import { SiteFooter } from "@/components/site-footer";
import { getManifest, getWorldwide } from "@/lib/data";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

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

export const metadata: Metadata = {
  // Every relative URL in every route's metadata resolves against this. Without
  // it Next emits relative og:image and canonical values, which social scrapers
  // and search engines both reject.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — the most active developers on GitHub`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Terms someone would actually type. Search engines have ignored this tag for
  // years; assistants summarising the page do read it.
  keywords: [
    "most active GitHub developers",
    "GitHub leaderboard",
    "top GitHub contributors",
    "GitHub contributions ranking",
    "top developers by country",
    "top developers by city",
    "GitHub commit statistics",
    "developer rankings API",
    "GitHub MCP server",
  ],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: {
    canonical: "/",
    types: {
      // The machine surfaces, advertised where a crawler already looks.
      "application/json": [{ url: "/api/v1", title: `${SITE_NAME} REST API` }],
      "text/plain": [{ url: "/llms.txt", title: `${SITE_NAME} brief for language models` }],
    },
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — the most active developers on GitHub`,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — the most active developers on GitHub`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Uncapped previews. This is a public dataset that exists to be quoted;
      // truncating our own snippets would only make the result less useful.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  category: "technology",
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

        {/* Suspense because it reads searchParams, which opts its subtree into
            client-side rendering — without the boundary that would deopt every
            static page in the app to dynamic. */}
        <Suspense fallback={null}>
          <Analytics />
        </Suspense>
      </body>
    </html>
  );
}
