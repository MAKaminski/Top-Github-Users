"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FullscreenMenuOverlay } from "./fullscreen-menu-overlay";
import { NAV_LINKS } from "@/components/nav-links";

/**
 * condensing-sticky-nav — starts tall and open, condenses to a compact strip
 * once the user scrolls past the hero.
 *
 * Corpus obligations honoured here:
 * - A sentinel is observed with IntersectionObserver; there is no scroll
 *   listener and therefore no per-frame work.
 * - Only height and padding transition, on a small element. No backdrop-filter
 *   transition.
 * - The bar never exceeds ~20% of a short viewport (checked at 400px landscape).
 * - Condensed state keeps a visible focus ring and 44px touch targets.
 * - Anchor targets get scroll-margin equal to the condensed height, set on
 *   :root in globals via --nav-h-condensed.
 */
export function CondensingStickyNav() {
  const [condensed, setCondensed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { rootMargin: "0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="absolute top-0 h-[60vh] w-px" />
      <header
        data-condensed={condensed ? "true" : "false"}
        className="sticky top-0 z-[var(--z-nav)] w-full border-b border-rule bg-[color-mix(in_oklab,var(--paper)_86%,transparent)] backdrop-blur-md transition-[height,padding] duration-[var(--dur-quick)] ease-[var(--ease-out-expo)]"
        style={{ height: condensed ? "var(--nav-h-condensed)" : "var(--nav-h)" }}
      >
        <nav
          aria-label="Primary"
          className="shell flex h-full items-center justify-between gap-[var(--space-md)]"
        >
          <Link
            href="/"
            className="mono flex min-h-11 items-center gap-2 text-caption uppercase tracking-[var(--tracking-caption)]"
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 bg-accent"
              style={{ boxShadow: "0 0 12px var(--accent)" }}
            />
            Commitgraph
          </Link>

          <ul className="hidden items-center gap-[var(--space-md)] lg:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className="mono flex min-h-11 items-center text-caption uppercase tracking-[var(--tracking-caption)] text-muted transition-colors duration-[var(--dur-instant)] hover:text-ink aria-[current=page]:text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <FullscreenMenuOverlay />
        </nav>
      </header>
    </>
  );
}
