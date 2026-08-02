"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * drag-inertia-gallery — a horizontal gallery you can throw with the pointer,
 * which keeps moving and decelerates naturally.
 *
 * Corpus obligations honoured here:
 * - Built on a real overflow-x: auto element, so arrow keys, Home/End and
 *   screen-reader scrolling all keep working for free.
 * - Drives scrollLeft rather than a transform, so the browser's own scroll
 *   optimisations apply and the scrollbar stays truthful.
 * - Pointer capture, so a fast drag leaving the element does not strand the
 *   gesture.
 * - preventDefault is NOT called on pointerdown — that would break focus and
 *   text selection outside the gallery.
 * - The momentum loop is cancelled the moment a keyboard or wheel interaction
 *   starts, and stopped at the cutoff rather than idling forever.
 */
export function DragInertiaGallery({
  children,
  label,
  className = "",
}: {
  children: ReactNode[];
  label: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const rail = useRef<HTMLUListElement>(null);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, velocity: 0, lastX: 0 });
  const momentum = useRef(0);

  useEffect(() => {
    const el = rail.current;
    if (!el) return;

    const stopMomentum = () => {
      if (momentum.current) {
        cancelAnimationFrame(momentum.current);
        momentum.current = 0;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") return; // native touch scrolling is better
      stopMomentum();
      drag.current = {
        active: true,
        startX: event.clientX,
        startScroll: el.scrollLeft,
        velocity: 0,
        lastX: event.clientX,
      };
      el.setPointerCapture(event.pointerId);
      el.dataset.dragging = "true";
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag.current.active) return;
      const dx = event.clientX - drag.current.startX;
      el.scrollLeft = drag.current.startScroll - dx;
      drag.current.velocity = event.clientX - drag.current.lastX;
      drag.current.lastX = event.clientX;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag.current.active) return;
      drag.current.active = false;
      delete el.dataset.dragging;
      if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);

      if (reduced) return;
      let velocity = drag.current.velocity;
      const glide = () => {
        velocity *= 0.94;
        el.scrollLeft -= velocity;
        // Stop at the cutoff instead of letting the loop idle forever.
        if (Math.abs(velocity) > 0.4) momentum.current = requestAnimationFrame(glide);
        else momentum.current = 0;
      };
      if (Math.abs(velocity) > 1) momentum.current = requestAnimationFrame(glide);
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    // The two inputs must never fight.
    el.addEventListener("wheel", stopMomentum, { passive: true });
    el.addEventListener("keydown", stopMomentum);

    return () => {
      stopMomentum();
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("wheel", stopMomentum);
      el.removeEventListener("keydown", stopMomentum);
    };
  }, [reduced]);

  return (
    <ul
      ref={rail}
      aria-label={label}
      tabIndex={0}
      data-cursor="DRAG"
      className={`flex gap-[var(--grid-gap)] overflow-x-auto pb-[var(--space-sm)] [scrollbar-width:thin] data-[dragging]:cursor-grabbing ${className}`}
    >
      {children.map((child, index) => (
        <li key={index} className="shrink-0 select-none">
          {child}
        </li>
      ))}
    </ul>
  );
}
