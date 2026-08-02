"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const TARGET_HASH = "8f3a91c";
const HEX = "0123456789abcdef";

/** Resolve the hash left-to-right in proportion to progress. Called from the
 *  frame loop, never from render — randomness during render is a hydration
 *  mismatch waiting to happen. */
function scrambleHash(progress: number): string {
  const resolved = Math.floor((progress / 100) * TARGET_HASH.length);
  let out = "";
  for (let i = 0; i < TARGET_HASH.length; i++) {
    out += i < resolved ? TARGET_HASH[i] : HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** Hard ceiling. The overlay leaves at this point no matter what. */
const HARD_TIMEOUT = 1800;

/**
 * numeric-preloader — a counter runs 00 to 100 against real asset progress,
 * then the screen lifts away to reveal the hero.
 *
 * Ours counts a resolving commit hash alongside the number, which is the one
 * loading affordance a developer audience actually reads.
 *
 * Corpus obligations honoured here:
 * - A hard timeout is a CORRECTNESS requirement, not a nicety: if an asset
 *   never resolves the overlay must still leave.
 * - The page beneath is fully functional if the overlay is removed by a script
 *   error — it is a sibling overlay, never a gate on interactivity.
 * - Marked aria-hidden and announced once on completion rather than announcing
 *   every integer, which would be unusable.
 * - Removed from the DOM after the exit; a fixed full-screen element left
 *   behind blocks pointer events.
 * - Under reduced motion it is removed without the lift animation.
 * - Progress uses document.fonts.ready and img.decode() rather than the load
 *   event, so "ready" means actually paintable.
 */
export function NumericPreloader() {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(0);
  const [objectId, setObjectId] = useState("0000000");
  const [leaving, setLeaving] = useState(false);
  // Starts `true`: the overlay is a client-only enhancement, so it must not
  // exist in the server-rendered HTML. Rendering it on the server would both
  // put a full-screen panel in the no-JS output and — because the resolving
  // hash is randomised per frame — guarantee a hydration mismatch.
  const [gone, setGone] = useState(true);
  const done = useRef(false);

  useEffect(() => {
    setGone(false);
  }, []);

  useEffect(() => {
    // Session-scoped: the preloader is an entrance, not a toll booth on every
    // route change.
    if (sessionStorage.getItem("cg:booted")) {
      setGone(true);
      return;
    }

    let raf = 0;
    const start = performance.now();

    const finish = () => {
      if (done.current) return;
      done.current = true;
      sessionStorage.setItem("cg:booted", "1");
      setProgress(100);
      setObjectId(TARGET_HASH);
      setLeaving(true);
      setTimeout(() => setGone(true), reduced ? 0 : 700);
    };

    // Real signals: fonts painted, plus any eagerly-loaded image decoded.
    //
    // Lazy images are deliberately excluded. A leaderboard renders hundreds of
    // them below the fold, and decode() on an image the browser has not chosen
    // to fetch never settles — waiting on those turns a 400ms entrance into a
    // full timeout on exactly the pages that carry the most content.
    const signals: Promise<unknown>[] = [document.fonts?.ready ?? Promise.resolve()];
    for (const img of Array.from(document.images)) {
      if (img.loading === "lazy" || !img.decode) continue;
      signals.push(img.decode().catch(() => undefined));
      if (signals.length >= 5) break;
    }
    let settled = 0;
    for (const signal of signals) {
      signal.finally(() => {
        settled++;
      });
    }

    const tick = (now: number) => {
      const real = settled / signals.length;
      // Never let the bar sit still: elapsed time floors it, real progress
      // pulls it up, and it can only move forward.
      const elapsed = Math.min(0.92, (now - start) / HARD_TIMEOUT);
      const value = Math.min(99, Math.round(Math.max(elapsed, real) * 100));
      setProgress((prev) => (value > prev ? value : prev));
      setObjectId(scrambleHash(value));
      if (real >= 1 && now - start > 420) finish();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const timeout = setTimeout(finish, HARD_TIMEOUT);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [reduced]);

  if (gone) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[calc(var(--z-curtain)+1)] flex items-end justify-between bg-paper p-[var(--gutter)]"
      style={{
        transform: leaving && !reduced ? "translate3d(0,-100%,0)" : "none",
        transition: reduced ? "none" : "transform 700ms var(--ease-in-out-quart)",
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <span className="mono text-caption uppercase tracking-[var(--tracking-caption)] text-muted">
        resolving {objectId}
      </span>
      <span className="mono text-display leading-none tracking-[var(--tracking-display)]">
        {String(progress).padStart(3, "0")}
      </span>
    </div>
  );
}

/** Announced once, politely, when the app is interactive. */
export function BootAnnouncer() {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      Commitgraph loaded.
    </p>
  );
}
