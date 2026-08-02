"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * curtain-route-transition — a full-bleed panel sweeps across to cover the
 * outgoing page and retracts to reveal the incoming one.
 *
 * Corpus obligations honoured here:
 * - Focus moves to the new page's <h1> (or the main landmark) after the reveal,
 *   or keyboard users are left on a removed element.
 * - The route change is announced through a polite live region — the visual
 *   transition tells sighted users and nothing tells anyone else.
 * - The curtain is aria-hidden and never receives focus.
 * - Under reduced motion the animation is skipped but the focus move and the
 *   announcement still happen.
 * - Animates transform only, and total transition time stays under ~900ms.
 */
export function CurtainRouteTransition() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [sweeping, setSweeping] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  // Track the last pathname we actually transitioned to, rather than a "first
  // run" flag. This effect also depends on `reduced`, which flips from its
  // pessimistic initial value once matchMedia resolves — with a boolean flag
  // that second run looked like a navigation and stole focus to the <h1> on
  // every cold load.
  const settled = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (settled.current === pathname) return;
    if (settled.current === null) {
      settled.current = pathname;
      return;
    }
    settled.current = pathname;

    const focusHeading = () => {
      const heading =
        document.querySelector<HTMLElement>("main h1") ??
        document.querySelector<HTMLElement>("main");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
        setAnnouncement(`${heading.textContent?.trim().slice(0, 80) ?? "Page"} loaded.`);
      } else {
        setAnnouncement("Page loaded.");
      }
    };

    if (reduced) {
      focusHeading();
      return;
    }

    setSweeping(true);
    const retract = setTimeout(() => setSweeping(false), 420);
    const focus = setTimeout(focusHeading, 460);
    return () => {
      clearTimeout(retract);
      clearTimeout(focus);
    };
  }, [pathname, reduced]);

  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[var(--z-curtain)] bg-accent"
        style={{
          transformOrigin: sweeping ? "left" : "right",
          transform: sweeping ? "scaleX(1)" : "scaleX(0)",
          transition: reduced ? "none" : "transform 420ms var(--ease-in-out-quart)",
        }}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
