"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { useFinePointer, useReducedMotion } from "./use-reduced-motion";

/** Travel is capped so the visual never leaves its own hit region. */
const MAX_TRAVEL = 12;

/**
 * magnetic-cta — the button leans toward the cursor and springs back.
 *
 * Corpus obligations honoured here:
 * - The visual moves; the hit region does not. Capping travel at 12px is what
 *   guarantees a user who aims at what they see still hits the link.
 * - Disabled entirely under reduced motion and coarse pointers.
 * - The focus ring is on the element that moves, so focus never looks detached.
 * - Listens on the element, not the document, and writes transform from a
 *   custom property rather than animating left/top.
 */
export function MagneticCta({
  href,
  children,
  className = "",
  cursorLabel,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  cursorLabel?: string;
}) {
  const reduced = useReducedMotion();
  const fine = useFinePointer();
  const inner = useRef<HTMLSpanElement>(null);
  const enabled = fine && !reduced;

  const onMove = (event: React.PointerEvent<HTMLAnchorElement>) => {
    if (!enabled || !inner.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const scale = Math.min(1, distance / (rect.width / 2)) * (MAX_TRAVEL / distance);
    inner.current.style.setProperty("--mx", `${dx * scale}px`);
    inner.current.style.setProperty("--my", `${dy * scale}px`);
  };

  const reset = () => {
    if (!inner.current) return;
    inner.current.style.setProperty("--mx", "0px");
    inner.current.style.setProperty("--my", "0px");
  };

  return (
    <Link
      href={href}
      onPointerMove={onMove}
      onPointerLeave={reset}
      data-cursor={cursorLabel}
      className={`group inline-flex items-center justify-center ${className}`}
    >
      <span
        ref={inner}
        className="inline-flex min-h-12 items-center gap-3 border border-ink px-[var(--space-md)] py-[var(--space-2xs)] transition-[transform,background-color,color] duration-[var(--dur-quick)] ease-[var(--ease-out-expo)] group-hover:bg-ink group-hover:text-paper"
        style={{ transform: "translate3d(var(--mx, 0px), var(--my, 0px), 0)" }}
      >
        {children}
      </span>
    </Link>
  );
}
