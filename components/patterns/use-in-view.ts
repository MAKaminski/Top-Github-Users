"use client";

import { useEffect, useRef, useState } from "react";

/**
 * One IntersectionObserver, unobserved after firing.
 *
 * The corpus repeats this obligation across viewport-stagger-reveal,
 * masked-line-reveal and odometer-stat: one observer per container, released
 * once it has fired, so callback count stays flat as a list grows.
 */
export function useInView<T extends Element>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer support: show everything rather than leaving it hidden.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          io.unobserve(entry.target);
        }
      }
      // threshold MUST stay 0. A ratio-based threshold is unreachable for any
      // container taller than the viewport — a 500-row leaderboard would need
      // several screens of itself visible at once and would simply never
      // reveal. Trigger on first pixel instead, and let rootMargin do the
      // "wait until it is properly on screen" work.
    }, options ?? { rootMargin: "0px 0px -8% 0px", threshold: 0 });

    io.observe(el);
    return () => io.disconnect();
  }, [options]);

  return { ref, inView };
}
