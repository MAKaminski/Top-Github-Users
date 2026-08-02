"use client";

import { useEffect, useRef, useState } from "react";

/**
 * scroll-progress-rule — a hairline that fills across the top of the viewport
 * in proportion to reading progress.
 *
 * Corpus obligations honoured here:
 * - Decorative, so aria-hidden: screen readers already report position.
 * - Prefers `animation-timeline: scroll()`, which runs off the main thread; the
 *   rAF path is only a fallback for browsers without it.
 * - Reduced motion does not apply — this tracks input directly rather than
 *   animating on its own.
 * - Only transform is animated, so there is no layout or paint per frame.
 */
export function ScrollProgressRule() {
  const bar = useRef<HTMLDivElement>(null);
  const [native, setNative] = useState(true);

  useEffect(() => {
    const supported =
      typeof CSS !== "undefined" && CSS.supports?.("animation-timeline: scroll()");
    setNative(Boolean(supported));
    if (supported) return;

    let raf = 0;
    const frame = () => {
      const el = bar.current;
      if (el) {
        // Read in the frame, never in a listener — avoids forced sync layout.
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const progress = max > 0 ? window.scrollY / max : 0;
        el.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[calc(var(--z-nav)+1)] h-px bg-transparent"
    >
      <div
        ref={bar}
        data-native={native ? "true" : "false"}
        className="h-full origin-left bg-accent data-[native=true]:[animation:progress-rule_linear_both] data-[native=true]:[animation-timeline:scroll()]"
        style={{ transform: "scaleX(0)" }}
      />
      <style>{`@keyframes progress-rule { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>
    </div>
  );
}
