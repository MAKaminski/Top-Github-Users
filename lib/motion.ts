/**
 * Easing and duration constants mirroring the CSS token block in
 * app/globals.css. The corpus stack guide is explicit: express easings as the
 * same cubic-bezier arrays as the CSS tokens so the two never drift.
 */

export const ease = {
  outExpo: [0.16, 1, 0.3, 1],
  inOutQuart: [0.76, 0, 0.24, 1],
  outQuad: [0.5, 1, 0.89, 1],
} as const;

/** Seconds — Motion takes seconds, the CSS tokens are in ms. */
export const dur = {
  instant: 0.12,
  quick: 0.32,
  base: 0.64,
  slow: 1.1,
} as const;

export const stagger = {
  line: 0.07,
  grid: 0.045,
} as const;

export const PARALLAX_DEPTH = 0.18;

/** Cap the effective stagger index so a long list does not end on a two-second
 *  delay — a corpus performance obligation for viewport-stagger-reveal. */
export function staggerDelay(index: number, step = stagger.grid, cap = 12): number {
  return Math.min(index, cap) * step;
}
