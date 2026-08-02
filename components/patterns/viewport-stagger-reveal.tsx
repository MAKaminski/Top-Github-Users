"use client";

import type { ReactNode } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useInView } from "./use-in-view";
import { staggerDelay } from "@/lib/motion";

/**
 * viewport-stagger-reveal — items rise and fade in sequence as their container
 * enters the viewport, with the stagger driven by index.
 *
 * Corpus obligations honoured here:
 * - One observer for the whole container, not one per child.
 * - Composes opacity and transform only.
 * - The effective index is capped so a long list does not end on a two-second
 *   delay.
 * - Nothing is interactive before it is visible: children keep pointer events
 *   and are never at opacity 0 under reduced motion, so there is no keyboard
 *   trap at opacity 0.
 */
export function ViewportStaggerReveal({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode[];
  className?: string;
  as?: "div" | "ul" | "ol";
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLDivElement>();
  const revealed = reduced || inView;

  return (
    <Tag ref={ref as never} className={className}>
      {children.map((child, index) => (
        <div
          key={index}
          data-reveal
          style={{
            opacity: revealed ? 1 : 0,
            transform: revealed ? "none" : "translate3d(0, 1.25rem, 0)",
            transition: reduced
              ? "none"
              : `opacity var(--dur-base) var(--ease-out-expo) ${staggerDelay(index)}s,` +
                `transform var(--dur-base) var(--ease-out-expo) ${staggerDelay(index)}s`,
          }}
        >
          {child}
        </div>
      ))}
    </Tag>
  );
}
