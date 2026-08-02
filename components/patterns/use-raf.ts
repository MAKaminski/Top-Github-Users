"use client";

import { useEffect, useRef } from "react";

/**
 * One shared rAF loop per consumer, started only when `active`.
 *
 * Several patterns (contextual-cursor, hover-preview-index, frame-parallax-media,
 * scroll-velocity-marquee) need per-frame work. The corpus is consistent about
 * the shape: record input in a passive listener, write style in the frame — never
 * write transforms from the event handler, which forces synchronous layout.
 */
export function useRaf(callback: (dt: number, t: number) => void, active = true): void {
  const cb = useRef(callback);
  cb.current = callback;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(now - last, 64);
      last = now;
      cb.current(dt, now);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/** Tracks the pointer in a ref without causing a render. */
export function usePointerRef() {
  const point = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      point.current.x = event.clientX;
      point.current.y = event.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return point;
}

/** Exponential smoothing that is frame-rate independent. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * (dt / 1000)));
}
