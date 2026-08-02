import { scaleLog } from "d3-scale";
import { abbreviate, exact } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/types";

const WIDTH = 900;
const HEIGHT = 460;
const PAD = { top: 24, right: 24, bottom: 44, left: 56 };

/**
 * Followers against contributions, both on log scales.
 *
 * This is the chart that pays for the whole dataset: it separates the people
 * who are *famous* from the people who are *busy*, and shows how weakly the two
 * correlate. Every other site in this space ranks by one axis and never shows
 * you the other.
 */
export function FollowersScatter({
  entries,
  highlight = 6,
}: {
  entries: LeaderboardEntry[];
  highlight?: number;
}) {
  const points = entries.filter((e) => e.followers > 0 && e.total > 0);
  if (points.length === 0) return null;

  const x = scaleLog()
    .domain([
      Math.max(1, Math.min(...points.map((p) => p.followers))),
      Math.max(...points.map((p) => p.followers)),
    ])
    .range([PAD.left, WIDTH - PAD.right]);

  const y = scaleLog()
    .domain([
      Math.max(1, Math.min(...points.map((p) => p.total))),
      Math.max(...points.map((p) => p.total)),
    ])
    .range([HEIGHT - PAD.bottom, PAD.top]);

  // Label the extremes on each axis: the most-followed and the most-active.
  const labelled = new Set<string>();
  [...points].sort((a, b) => b.followers - a.followers).slice(0, highlight).forEach((p) => labelled.add(p.login));
  [...points].sort((a, b) => b.total - a.total).slice(0, highlight).forEach((p) => labelled.add(p.login));

  const xTicks = x.ticks(5);
  const yTicks = y.ticks(5);

  return (
    <figure className="m-0">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full"
      >
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 10}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--muted)"
              fontSize={11}
              className="mono"
            >
              {abbreviate(tick)}
            </text>
          </g>
        ))}

        {xTicks.map((tick) => (
          <text
            key={`x${tick}`}
            x={x(tick)}
            y={HEIGHT - PAD.bottom + 20}
            textAnchor="middle"
            fill="var(--muted)"
            fontSize={11}
            className="mono"
          >
            {abbreviate(tick)}
          </text>
        ))}

        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 8}
          textAnchor="end"
          fill="var(--muted)"
          fontSize={11}
          className="mono"
        >
          FOLLOWERS →
        </text>
        <text
          x={PAD.left - 10}
          y={PAD.top - 10}
          textAnchor="start"
          fill="var(--muted)"
          fontSize={11}
          className="mono"
        >
          ↑ CONTRIBUTIONS
        </text>

        {points.map((point) => {
          const isLabelled = labelled.has(point.login);
          return (
            <circle
              key={point.login}
              cx={x(point.followers)}
              cy={y(point.total)}
              r={isLabelled ? 4 : 2.5}
              fill={isLabelled ? "var(--accent-warm)" : "var(--accent)"}
              opacity={isLabelled ? 1 : 0.45}
            />
          );
        })}

        {points
          .filter((p) => labelled.has(p.login))
          .map((point) => (
            <text
              key={`label-${point.login}`}
              x={x(point.followers) + 8}
              y={y(point.total) - 6}
              fill="var(--ink)"
              fontSize={11}
              className="mono"
            >
              {point.login}
            </text>
          ))}
      </svg>

      <figcaption className="mt-[var(--space-sm)] text-caption text-muted">
        {exact(points.length)} developers. Both axes are logarithmic. Highlighted points are the
        most-followed and the most-active — note how rarely they are the same people.
      </figcaption>

      <table className="sr-only">
        <caption>Followers against contributions</caption>
        <thead>
          <tr>
            <th scope="col">Developer</th>
            <th scope="col">Followers</th>
            <th scope="col">Contributions</th>
          </tr>
        </thead>
        <tbody>
          {points
            .filter((p) => labelled.has(p.login))
            .map((point) => (
              <tr key={point.login}>
                <th scope="row">{point.login}</th>
                <td>{exact(point.followers)}</td>
                <td>{exact(point.total)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  );
}
