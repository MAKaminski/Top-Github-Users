"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useInView } from "./use-in-view";
import { abbreviate, exact } from "@/lib/format";

/**
 * odometer-stat — a number that counts up when it scrolls into view.
 *
 * Corpus obligations honoured here:
 * - The real value is rendered in the DOM and only *replaced* while animating,
 *   so a crawler, a screen reader, or a failed script all see the true number.
 * - The counting element is aria-hidden; the final value lives in a visually
 *   hidden sibling, otherwise a live region announces every intermediate value.
 * - Reduced motion shows the final value immediately.
 * - tabular-nums (via .mono) prevents per-frame reflow from digit widths.
 */
export function OdometerStat({
  value,
  label,
  sublabel,
  compact = true,
  duration = 1600,
  scale = "display",
}: {
  value: number;
  label: string;
  sublabel?: string;
  compact?: boolean;
  duration?: number;
  /** Step down to "h1" wherever several stats share a row — at display size
   *  four figures will collide before they wrap. */
  scale?: "display" | "h1";
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.4 });
  const [shown, setShown] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    if (reduced || !inView || started.current) return;
    started.current = true;

    let raf = 0;
    const start = performance.now();
    const from = 0;

    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out-expo, matching --ease-out-expo.
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(Math.round(from + (value - from) * eased));
      if (t < 1) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, value, duration]);

  const format = compact ? abbreviate : exact;

  return (
    <div ref={ref} className="flex min-w-0 flex-col gap-[var(--space-2xs)]">
      <span
        className={`mono block truncate leading-[var(--leading-display)] tracking-[var(--tracking-display)] ${
          scale === "display" ? "text-display" : "text-h1"
        }`}
      >
        {/* The animated layer is decorative; the real value is beside it. */}
        <span aria-hidden="true">{format(shown)}</span>
        <span className="sr-only">{exact(value)}</span>
      </span>
      <span className="eyebrow">{label}</span>
      {sublabel ? <span className="text-caption text-muted">{sublabel}</span> : null}
    </div>
  );
}
