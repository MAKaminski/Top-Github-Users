import type { ReactNode } from "react";

/**
 * sticky-panel-stack — sequential panels that each stick to the viewport while
 * the next slides up over them, like cards dealt onto a pile.
 *
 * Corpus obligations honoured here:
 * - Pure CSS sticky, zero JavaScript and zero scroll listeners. It degrades to
 *   a normal stacked list, which IS the reduced-motion behaviour, so no extra
 *   handling is needed. That is also why this is a server component.
 * - No backdrop-filter on the panels: compositing a full-viewport blur on every
 *   frame of a sticky scroll is the most common cause of jank in this pattern.
 * - Each panel's content fits within 100svh at the smallest supported width, or
 *   it becomes unreachable.
 * - overflow is not hidden on the wrapper, so keyboard focus can scroll a panel
 *   into view.
 */
export function StickyPanelStack({
  panels,
  label,
}: {
  panels: ReactNode[];
  label: string;
}) {
  return (
    <section aria-label={label} className="relative">
      {panels.map((panel, index) => (
        <div
          key={index}
          className="sticky top-[var(--nav-h-condensed)] mb-[var(--space-md)]"
          style={{ zIndex: index + 1 }}
        >
          <div className="max-h-[calc(100svh-var(--nav-h-condensed)-var(--space-md))] overflow-auto border border-rule bg-paper">
            {panel}
          </div>
        </div>
      ))}
    </section>
  );
}
