import { line, area, curveMonotoneX } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { exact } from "@/lib/format";

/** A 12-bucket trailing sparkline. Static SVG, no runtime cost. */
export function Sparkline({
  values,
  width = 120,
  height = 32,
  label = "Trailing activity",
  showArea = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  label?: string;
  showArea?: boolean;
}) {
  if (values.length === 0) return null;

  const x = scaleLinear()
    .domain([0, values.length - 1])
    .range([1, width - 1]);
  const y = scaleLinear()
    .domain([0, Math.max(1, ...values)])
    .range([height - 1, 1]);

  const path = line<number>()
    .x((_, i) => x(i))
    .y((d) => y(d))
    .curve(curveMonotoneX)(values);

  const fill = area<number>()
    .x((_, i) => x(i))
    .y0(height)
    .y1((d) => y(d))
    .curve(curveMonotoneX)(values);

  return (
    <figure className="m-0">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block overflow-visible"
      >
        {showArea && fill ? (
          <path d={fill} fill="var(--accent)" opacity={0.14} />
        ) : null}
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <figcaption className="sr-only">
        {label}: {values.map((v) => exact(v)).join(", ")} across {values.length} periods.
      </figcaption>
    </figure>
  );
}
