import { line, curveMonotoneX } from "d3-shape";
import { scaleLinear, scalePoint } from "d3-scale";
import type { HistorySeries } from "@/lib/types";

const WIDTH = 900;
const HEIGHT = 380;
const PAD = { top: 20, right: 120, bottom: 32, left: 48 };

/**
 * Rank movement over snapshots.
 *
 * This chart is the reason the crawler commits snapshots instead of overwriting
 * a single file — it is the one view no other leaderboard can offer. Until
 * there are at least two snapshots there is nothing to plot, and the component
 * says exactly that rather than inventing a trend.
 */
export function BumpChart({ history }: { history: HistorySeries | null }) {
  if (!history || history.dates.length < 2) {
    return (
      <div className="border border-dashed border-rule p-[var(--space-md)]">
        <p className="eyebrow">Rank movement</p>
        <p className="mt-[var(--space-2xs)] max-w-[42ch] text-caption text-muted">
          {history?.dates.length === 1
            ? "One snapshot recorded. Movement appears here after the second scheduled crawl — this chart plots real history, so it stays empty until there is real history."
            : "No snapshots recorded yet."}
        </p>
      </div>
    );
  }

  const x = scalePoint<string>().domain(history.dates).range([PAD.left, WIDTH - PAD.right]);
  const maxRank = Math.max(
    1,
    ...history.series.flatMap((s) => s.ranks.filter((r): r is number => r !== null)),
  );
  const y = scaleLinear().domain([1, maxRank]).range([PAD.top, HEIGHT - PAD.bottom]);

  const path = line<{ date: string; rank: number }>()
    .x((d) => x(d.date) ?? 0)
    .y((d) => y(d.rank))
    .curve(curveMonotoneX);

  return (
    <figure className="m-0">
      <svg aria-hidden="true" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-auto w-full">
        {history.series.map((series, index) => {
          const points = series.ranks
            .map((rank, i) => (rank === null ? null : { date: history.dates[i], rank }))
            .filter((p): p is { date: string; rank: number } => p !== null);
          if (points.length < 2) return null;
          const d = path(points);
          const last = points[points.length - 1];

          return (
            <g key={series.login}>
              <path
                d={d ?? ""}
                fill="none"
                stroke={`var(--cat-${(index % 8) + 1})`}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <text
                x={(x(last.date) ?? 0) + 10}
                y={y(last.rank)}
                dominantBaseline="middle"
                fill="var(--ink)"
                fontSize={11}
                className="mono"
              >
                {series.login}
              </text>
            </g>
          );
        })}

        {history.dates.map((date) => (
          <text
            key={date}
            x={x(date)}
            y={HEIGHT - 10}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize={11}
            className="mono"
          >
            {date.slice(5)}
          </text>
        ))}
      </svg>
      <figcaption className="sr-only">
        Rank movement across {history.dates.length} snapshots for {history.series.length} developers.
      </figcaption>
    </figure>
  );
}
