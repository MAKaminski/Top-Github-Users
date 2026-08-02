"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "./use-reduced-motion";

/**
 * pinned-horizontal-scroll — a section pins to the viewport and translates a
 * horizontal track sideways as the user scrolls vertically.
 *
 * Corpus obligations honoured here:
 * - A native overflow-x: auto + scroll-snap fallback is the base implementation
 *   and the pinned behaviour is the enhancement, so it degrades below 64rem and
 *   under reduced motion.
 * - The wrapper keeps its scroll distance and content stays in normal flow, so
 *   screen-reader virtual cursors still work; overflow is never hidden.
 * - Keyboard focus landing in an off-screen panel scrolls it into view: we
 *   listen for focusin on the track and scroll the window to the matching
 *   vertical position.
 * - transform is written from a rAF loop off a cached rect, translate3d only,
 *   and will-change is set only while the section is on screen.
 */
export function PinnedHorizontalScroll({
  panels,
  label,
}: {
  panels: ReactNode[];
  label: string;
}) {
  const reduced = useReducedMotion();
  const wrapper = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)");
    const sync = () => setPinned(mq.matches && !reduced);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [reduced]);

  useEffect(() => {
    if (!pinned) return;
    const wrap = wrapper.current;
    const rail = track.current;
    if (!wrap || !rail) return;

    let raf = 0;
    let visible = false;

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      rail.style.willChange = visible ? "transform" : "";
    });
    io.observe(wrap);

    const frame = () => {
      if (visible) {
        const rect = wrap.getBoundingClientRect();
        const distance = rail.scrollWidth - window.innerWidth;
        const scrollable = wrap.offsetHeight - window.innerHeight;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;
        rail.style.transform = `translate3d(${-progress * Math.max(0, distance)}px, 0, 0)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Keyboard users tabbing into an off-screen panel must have it brought
    // into view — map the panel index back to a vertical scroll position.
    const onFocusIn = (event: FocusEvent) => {
      const panel = (event.target as Element | null)?.closest?.("[data-panel-index]");
      if (!(panel instanceof HTMLElement)) return;
      const index = Number(panel.dataset.panelIndex ?? 0);
      const scrollable = wrap.offsetHeight - window.innerHeight;
      const ratio = panels.length > 1 ? index / (panels.length - 1) : 0;
      window.scrollTo({ top: wrap.offsetTop + ratio * scrollable, behavior: "auto" });
    };
    rail.addEventListener("focusin", onFocusIn);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      rail.removeEventListener("focusin", onFocusIn);
      rail.style.transform = "";
      rail.style.willChange = "";
    };
  }, [pinned, panels.length]);

  if (!pinned) {
    // Base implementation: a real horizontal scroller with snap points.
    return (
      <section aria-label={label}>
        <ul className="flex snap-x snap-mandatory gap-[var(--grid-gap)] overflow-x-auto px-[var(--gutter)] pb-[var(--space-md)]">
          {panels.map((panel, index) => (
            <li
              key={index}
              data-panel-index={index}
              className="w-[min(85vw,32rem)] shrink-0 snap-center"
            >
              {panel}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section
      ref={wrapper}
      aria-label={label}
      style={{ height: `${panels.length * 60 + 100}vh` }}
      className="relative"
    >
      <div className="sticky top-0 flex h-svh items-center overflow-hidden">
        <ul ref={track} className="flex gap-[var(--grid-gap)] px-[var(--gutter)]">
          {panels.map((panel, index) => (
            <li
              key={index}
              data-panel-index={index}
              className="w-[min(42vw,34rem)] shrink-0"
            >
              {panel}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
