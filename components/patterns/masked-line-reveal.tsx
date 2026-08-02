"use client";

import { useEffect, useState, type ElementType, type ReactNode } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { useInView } from "./use-in-view";

/**
 * masked-line-reveal — each line slides up from behind its own clipping mask,
 * staggered, so the sentence assembles itself.
 *
 * Corpus obligations honoured here:
 * - The visible line breaks are presentational. Lines are inline spans of ONE
 *   heading, so the accessible name is the whole sentence.
 * - Not gated on JavaScript alone: if the observer never fires the text is
 *   still visible (the reveal only ever *removes* a transform).
 * - Under reduced motion the final state shows immediately.
 * - Waits for document.fonts.ready, or the reveal plays against a fallback face.
 * - Animates transform only; will-change is dropped once the run completes.
 */
export function MaskedLineReveal({
  lines,
  as: Tag = "h1",
  className = "",
  lineClassName = "",
  delay = 0,
}: {
  lines: ReactNode[];
  as?: ElementType;
  className?: string;
  lineClassName?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const { ref, inView } = useInView<HTMLElement>();
  const [fontsReady, setFontsReady] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ready = document.fonts?.ready ?? Promise.resolve();
    ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    // Never let a stalled font file hold the headline hostage.
    const timeout = setTimeout(() => setFontsReady(true), 1200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  const revealed = reduced || (inView && fontsReady);

  return (
    <Tag ref={ref} className={className} data-revealed={revealed ? "true" : "false"}>
      {lines.map((line, index) => (
        <span
          key={index}
          className="block overflow-hidden"
          style={{ paddingBottom: "0.08em", marginBottom: "-0.08em" }}
        >
          <span
            data-reveal
            className={`block ${lineClassName}`}
            onTransitionEnd={index === lines.length - 1 ? () => setDone(true) : undefined}
            style={{
              transform: revealed ? "translate3d(0,0,0)" : "translate3d(0,110%,0)",
              transition: reduced
                ? "none"
                : `transform var(--dur-slow) var(--ease-out-expo) ${delay + index * 0.07}s`,
              willChange: done ? undefined : "transform",
            }}
          >
            {line}
          </span>
        </span>
      ))}
    </Tag>
  );
}
