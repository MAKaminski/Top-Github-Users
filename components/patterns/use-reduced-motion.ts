"use client";

import { useEffect, useState } from "react";

/**
 * Tracks prefers-reduced-motion.
 *
 * Starts `true` so the very first client render matches a "no motion" DOM —
 * that way a reduced-motion user never sees a single animated frame before the
 * effect runs, and the server/client markup stays identical.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** True only on devices with a precise pointer. contextual-cursor and
 *  magnetic-cta are gated on this — touch keeps every native behaviour. */
export function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (min-width: 48rem)");
    const sync = () => setFine(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return fine;
}
