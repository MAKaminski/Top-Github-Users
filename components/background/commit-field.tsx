"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/components/patterns/use-reduced-motion";

/**
 * The commit field.
 *
 * A canvas grid of contribution squares whose brightness is seeded from the
 * project's *real* aggregate contribution distribution, with slow waves of
 * activity propagating across it. The background is literally the dataset —
 * which is the whole idea, and the thing no other leaderboard does.
 *
 * Budget: capped at 30fps, DPR capped at 1.5, paused entirely when off-screen
 * or when the tab is hidden, and reduced to a single static frame under
 * prefers-reduced-motion.
 */
export function CommitField({
  seed,
  cell = 13,
  gap = 4,
  className = "",
}: {
  seed: number[];
  cell?: number;
  gap?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const step = cell + gap;
    let cols = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    let raf = 0;
    let visible = true;
    let last = 0;

    const styles = getComputedStyle(document.documentElement);
    const readRamp = () =>
      [0, 1, 2, 3, 4].map((i) => styles.getPropertyValue(`--level-${i}`).trim() || "#0e4429");
    let ramp = readRamp();

    const resize = () => {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / step) + 1;
      rows = Math.ceil(height / step) + 1;
      ramp = readRamp();
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      const t = time / 1000;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = (row * cols + col) % seed.length;
          const base = seed[index];

          // Two crossing waves give the field a slow, non-repeating shimmer.
          const wave =
            0.5 +
            0.5 *
              Math.sin(col * 0.22 - t * 0.55 + row * 0.13) *
              Math.cos(row * 0.3 + t * 0.24);

          const value = base * 0.62 + wave * 0.38;
          if (value < 0.34) continue;

          const level = value > 0.86 ? 4 : value > 0.72 ? 3 : value > 0.55 ? 2 : 1;
          ctx.fillStyle = ramp[level];
          ctx.globalAlpha = 0.1 + (value - 0.34) * 0.5;
          ctx.fillRect(col * step, row * step, cell, cell);
        }
      }
      ctx.globalAlpha = 1;
    };

    resize();
    draw(0);

    if (reduced) {
      const onResize = () => {
        resize();
        draw(0);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const frame = (now: number) => {
      // 30fps ceiling — this is a background, not the content.
      if (visible && !document.hidden && now - last > 33) {
        last = now;
        draw(now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [seed, cell, gap, reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none block size-full ${className}`}
    />
  );
}
