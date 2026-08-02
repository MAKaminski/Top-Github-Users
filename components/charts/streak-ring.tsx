import { exact } from "@/lib/format";

/** Current streak against longest streak, as two concentric arcs. */
export function StreakRing({
  current,
  longest,
  size = 140,
}: {
  current: number;
  longest: number;
  size?: number;
}) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = longest > 0 ? Math.min(1, current / longest) : 0;

  return (
    <figure className="m-0 flex items-center gap-[var(--space-sm)]">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="shrink-0 -rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--level-0)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--level-4)"
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <figcaption className="flex flex-col gap-1">
        <span className="mono text-h1 leading-none">{exact(current)}</span>
        <span className="eyebrow">Current streak</span>
        <span className="text-caption text-muted">
          Longest {exact(longest)} days
        </span>
      </figcaption>
    </figure>
  );
}
