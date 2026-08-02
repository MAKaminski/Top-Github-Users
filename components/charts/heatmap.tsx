import { CALENDAR_WEEKS, levelFor } from "@/lib/calendar";
import { exact } from "@/lib/format";

/**
 * Contribution heatmap — 53 weeks x 7 days.
 *
 * Chart rules for this project, applied here and in every sibling:
 * - Colour comes from the token ramp (--level-0..4); no literals.
 * - The SVG is aria-hidden and the real numbers are exposed in a visually
 *   hidden summary, so a screen reader and a crawler both get the data.
 * - Nothing animates, so there is no reduced-motion branch to get wrong.
 */
export function Heatmap({
  days,
  compact = false,
  label = "Contribution activity",
}: {
  days: number[];
  compact?: boolean;
  label?: string;
}) {
  const cell = compact ? 4 : 11;
  const gap = compact ? 1 : 2;
  const step = cell + gap;
  const max = days.reduce((m, d) => (d > m ? d : m), 0);
  const total = days.reduce((sum, d) => sum + d, 0);
  const active = days.filter((d) => d > 0).length;

  const width = CALENDAR_WEEKS * step;
  const height = 7 * step;

  return (
    <figure className="m-0 w-full">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        className="block h-auto w-full"
        preserveAspectRatio="xMinYMid meet"
        shapeRendering="crispEdges"
      >
        {days.map((count, index) => {
          const week = Math.floor(index / 7);
          const day = index % 7;
          return (
            <rect
              key={index}
              x={week * step}
              y={day * step}
              width={cell}
              height={cell}
              fill={`var(--level-${levelFor(count, max)})`}
              rx={compact ? 0 : 1}
            />
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {label}: {exact(total)} contributions across {exact(active)} active days in the last 53
        weeks. Busiest day: {exact(max)} contributions.
      </figcaption>
    </figure>
  );
}

/** Shared legend, so every heatmap on the site reads the same way. */
export function HeatmapLegend() {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">Less</span>
      <div aria-hidden="true" className="flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className="block size-[10px]"
            style={{ background: `var(--level-${level})` }}
          />
        ))}
      </div>
      <span className="eyebrow">More</span>
    </div>
  );
}
