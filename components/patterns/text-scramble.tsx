"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const GLYPHS = "abcdef0123456789_$/<>#@";

/**
 * text-scramble — a label resolves from random characters into its real text.
 *
 * Corpus obligations honoured here:
 * - NEVER mutate the element carrying the accessible name. The real text sits
 *   in a visually hidden span; only an aria-hidden layer scrambles.
 * - Skipped entirely under reduced motion.
 * - Width is held with `ch` sizing so the label does not reflow while resolving.
 * - One rAF per active element, stopped the moment the word resolves, and a run
 *   already in flight is never restarted.
 */
export function TextScramble({
  text,
  className = "",
  trigger = "view",
  speed = 28,
}: {
  text: string;
  className?: string;
  trigger?: "view" | "hover" | "mount";
  speed?: number;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(text);
  const running = useRef(false);
  const hostRef = useRef<HTMLSpanElement>(null);

  const run = () => {
    if (reduced || running.current) return;
    running.current = true;

    let frame = 0;
    let raf = 0;
    const total = text.length * 3;

    const tick = () => {
      const progress = frame / total;
      const settled = Math.floor(progress * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") out += " ";
        else if (i < settled) out += text[i];
        else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      setDisplay(out);
      frame++;
      if (frame <= total) {
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(text);
        running.current = false;
      }
    };

    // speed throttles how many rAF ticks we skip; lower is faster.
    let last = 0;
    const throttled = (now: number) => {
      if (now - last >= speed) {
        last = now;
        tick();
      } else if (running.current) {
        raf = requestAnimationFrame(throttled);
      }
    };
    raf = requestAnimationFrame(throttled);
    return () => cancelAnimationFrame(raf);
  };

  useEffect(() => {
    if (reduced) {
      setDisplay(text);
      return;
    }
    if (trigger === "mount") {
      run();
      return;
    }
    if (trigger !== "view") return;

    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            run();
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, text, trigger]);

  return (
    <span
      ref={hostRef}
      className={className}
      onPointerEnter={trigger === "hover" ? run : undefined}
      style={{ display: "inline-block", minWidth: `${text.length}ch` }}
    >
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
