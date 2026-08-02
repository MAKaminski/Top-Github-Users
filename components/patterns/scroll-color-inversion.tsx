"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * scroll-color-inversion — the page flips between light and dark as a marked
 * section crosses the middle of the viewport.
 *
 * Corpus obligations honoured here:
 * - Under reduced motion the switch is instant rather than cross-faded — an
 *   animated full-page colour change is exactly the large-area motion the
 *   preference exists for. The transition lives on `body` in globals.css and is
 *   neutralised by the global reduced-motion rule.
 * - Contrast is verified in both themes, including accent and focus rings; the
 *   [data-theme="light"] block in globals.css redefines the focus colour.
 * - No child may hard-code a colour, or the flip will leave it stranded. The
 *   whole design system forbids literals outside the token block.
 * - One observer with a thin band at the viewport middle, so the callback fires
 *   on crossing rather than continuously.
 */
export function ScrollColorInversion({
  children,
  theme = "light",
  className = "",
}: {
  children: ReactNode;
  theme?: "light" | "dark";
  className?: string;
}) {
  const section = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = section.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) document.documentElement.dataset.theme = theme;
        else delete document.documentElement.dataset.theme;
      },
      // A 1px band across the middle of the viewport.
      { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  return (
    <div ref={section} data-theme={theme} className={className}>
      {children}
    </div>
  );
}
