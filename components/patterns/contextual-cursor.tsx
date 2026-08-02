"use client";

import { useEffect, useRef, useState } from "react";
import { useFinePointer, useReducedMotion } from "./use-reduced-motion";
import { damp, useRaf } from "./use-raf";

/**
 * contextual-cursor — a custom cursor that changes size and picks up a text
 * label depending on what it is hovering.
 *
 * Corpus obligations honoured here:
 * - Gated on (pointer: fine); touch devices keep every native behaviour.
 * - The native cursor is never hidden over text inputs or selectable prose —
 *   we only *add* a follower and leave `cursor` alone on those elements.
 * - Every label the cursor shows also exists in the DOM (elements opt in with
 *   data-cursor, whose value duplicates visible or aria text), so the cursor is
 *   never the only route to the information.
 * - One document-level pointermove that records coordinates, one rAF loop that
 *   writes the transform. Under reduced motion the follow smoothing is dropped
 *   and the cursor tracks exactly.
 */
export function ContextualCursor() {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const dot = useRef<HTMLDivElement>(null);
  const target = useRef({ x: -100, y: -100 });
  const current = useRef({ x: -100, y: -100 });
  const [label, setLabel] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!fine) return;

    const onMove = (event: PointerEvent) => {
      target.current.x = event.clientX;
      target.current.y = event.clientY;
      if (!active) setActive(true);
    };

    const onOver = (event: PointerEvent) => {
      const el = (event.target as Element | null)?.closest?.("[data-cursor]");
      setLabel(el instanceof HTMLElement ? el.dataset.cursor || null : null);
    };

    const onLeave = () => setActive(false);

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerover", onOver, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [fine, active]);

  useRaf(
    (dt) => {
      const el = dot.current;
      if (!el) return;
      if (reduced) {
        current.current.x = target.current.x;
        current.current.y = target.current.y;
      } else {
        current.current.x = damp(current.current.x, target.current.x, 22, dt);
        current.current.y = damp(current.current.y, target.current.y, 22, dt);
      }
      el.style.transform = `translate3d(${current.current.x}px, ${current.current.y}px, 0) translate(-50%, -50%)`;
    },
    fine,
  );

  if (!fine) return null;

  return (
    <div
      ref={dot}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[var(--z-cursor)] flex items-center justify-center rounded-full border border-ink mix-blend-difference"
      style={{
        width: label ? "5.5rem" : "1.25rem",
        height: label ? "5.5rem" : "1.25rem",
        opacity: active ? 1 : 0,
        backgroundColor: label ? "var(--ink)" : "transparent",
        transition:
          "width var(--dur-quick) var(--ease-out-expo), height var(--dur-quick) var(--ease-out-expo), opacity var(--dur-quick) linear, background-color var(--dur-quick) linear",
      }}
    >
      {label ? (
        <span className="mono text-[0.625rem] uppercase tracking-[var(--tracking-caption)] text-paper">
          {label}
        </span>
      ) : null}
    </div>
  );
}
