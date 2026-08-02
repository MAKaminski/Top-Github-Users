"use client";

import { useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { damp, useRaf } from "./use-raf";

/**
 * scroll-velocity-marquee — a continuously scrolling band of oversized text
 * whose speed and direction respond to how fast the user is scrolling.
 *
 * Corpus obligations honoured here:
 * - WCAG 2.2 SC 2.2.2: motion that starts automatically and runs beyond five
 *   seconds needs a pause mechanism or must be disabled for reduced motion.
 *   This pattern takes the second route — under reduced motion a single static
 *   copy renders and the loop never starts.
 * - The duplicate copies are aria-hidden so the phrase is announced once.
 * - The phrase is duplicated in the DOM once at render, not cloned on resize.
 * - transform is written from one rAF loop; scrollY is read inside the frame.
 */
export function ScrollVelocityMarquee({
  items,
  className = "",
}: {
  items: string[];
  className?: string;
}) {
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const velocity = useRef(0);
  const lastScroll = useRef(0);

  useRaf((dt) => {
    const el = track.current;
    if (!el) return;

    const y = window.scrollY;
    const delta = y - lastScroll.current;
    lastScroll.current = y;

    // Baseline drift plus a kick proportional to scroll speed, damped back.
    velocity.current = damp(velocity.current, delta * 0.9, 6, dt);
    const speed = 0.045 * dt + velocity.current * 0.35;
    offset.current -= speed;

    // The track holds two copies; wrapping at half width makes the loop seamless.
    const half = el.scrollWidth / 2;
    if (half > 0) {
      if (offset.current <= -half) offset.current += half;
      if (offset.current > 0) offset.current -= half;
    }

    el.style.transform = `translate3d(${offset.current}px, 0, 0)`;
  }, !reduced);

  const phrase = items.join("  ·  ");

  if (reduced) {
    return (
      <div className={`overflow-hidden whitespace-nowrap ${className}`}>
        <span className="mono inline-block py-[var(--space-sm)] text-h2 uppercase tracking-[var(--tracking-caption)]">
          {phrase}
        </span>
      </div>
    );
  }

  return (
    <div className={`overflow-hidden ${className}`}>
      <div ref={track} className="flex w-max will-change-transform">
        <span className="mono shrink-0 py-[var(--space-sm)] pr-8 text-h2 uppercase tracking-[var(--tracking-caption)]">
          {phrase}
          {"  ·  "}
        </span>
        <span
          aria-hidden="true"
          className="mono shrink-0 py-[var(--space-sm)] pr-8 text-h2 uppercase tracking-[var(--tracking-caption)]"
        >
          {phrase}
          {"  ·  "}
        </span>
      </div>
    </div>
  );
}
