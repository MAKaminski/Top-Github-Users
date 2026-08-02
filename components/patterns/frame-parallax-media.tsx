"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "./use-reduced-motion";
import { PARALLAX_DEPTH } from "@/lib/motion";

/**
 * frame-parallax-media — an image drifts slowly inside a fixed frame as the
 * page scrolls, so frame and contents move at different rates.
 *
 * Corpus obligations honoured here:
 * - Under reduced motion the image sits centred and static; the layout is
 *   identical, only the drift is gone.
 * - Parallax is decorative and never the only cue that a section changed.
 * - Overscale is at least 1 + 2*depth, or the image edge is exposed at the
 *   extremes.
 * - width/height are set to reserve space and avoid layout shift.
 * - Translation is computed in a rAF loop from a cached rect, not on scroll.
 * - background-attachment: fixed is not used — it repaints the whole layer.
 */
export function FrameParallaxMedia({
  src,
  alt,
  className = "",
  depth = PARALLAX_DEPTH,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  depth?: number;
  /** Set on the one instance above the fold. Corpus rule: fetchpriority high
   *  belongs only on the first bleed above the fold, lazy on everything else. */
  eager?: boolean;
}) {
  const reduced = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const overscale = 1 + 2 * depth;

  useEffect(() => {
    if (reduced) return;
    const frameEl = frame.current;
    const imageEl = image.current;
    if (!frameEl || !imageEl) return;

    let raf = 0;
    let visible = false;

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(frameEl);

    const tick = () => {
      if (visible) {
        const rect = frameEl.getBoundingClientRect();
        const centre = rect.top + rect.height / 2 - window.innerHeight / 2;
        imageEl.style.transform = `translate3d(0, ${-centre * depth}px, 0) scale(${overscale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduced, depth, overscale]);

  return (
    <div
      ref={frame}
      className={`relative overflow-hidden bg-surface ${className}`}
      style={{ aspectRatio: "1 / 1" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={src}
        alt={alt}
        width={480}
        height={480}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        className="absolute inset-0 size-full object-cover"
        style={{ transform: reduced ? "none" : `scale(${overscale})` }}
      />
    </div>
  );
}
