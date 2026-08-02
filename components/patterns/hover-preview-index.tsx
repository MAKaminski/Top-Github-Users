"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFinePointer, useReducedMotion } from "./use-reduced-motion";
import { Heatmap } from "@/components/charts/heatmap";
import { abbreviate, rankLabel } from "@/lib/format";
import { calendarFor } from "@/lib/calendar";
import type { LeaderboardEntry } from "@/lib/types";

/**
 * hover-preview-index — a typographic list where hovering a row reveals its
 * preview floating near the cursor.
 *
 * Our twist: the preview is not a stock thumbnail, it is the developer's avatar
 * *and their contribution heatmap*. The preview shows you something you cannot
 * get from the row, which is the whole point of the pattern.
 *
 * Corpus obligations honoured here:
 * - The preview is decorative enrichment; each row's link text fully identifies
 *   the destination on its own.
 * - Rows are keyboard focusable in order and focusin shows the preview too.
 * - Below the tablet breakpoint the floating preview is not rendered at all.
 * - ONE shared preview element whose contents swap — not one per row.
 * - Position is written from a rAF loop reading a passive pointermove.
 */
export function HoverPreviewIndex({ entries }: { entries: LeaderboardEntry[] }) {
  const fine = useFinePointer();
  const reduced = useReducedMotion();
  const [active, setActive] = useState<LeaderboardEntry | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const point = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!fine) return;
    const onMove = (event: PointerEvent) => {
      point.current.x = event.clientX;
      point.current.y = event.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const frame = () => {
      const el = preview.current;
      if (el) {
        el.style.setProperty("--px", `${point.current.x}px`);
        el.style.setProperty("--py", `${point.current.y}px`);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [fine]);

  const show = (entry: LeaderboardEntry) => setActive(entry);
  const hide = () => setActive(null);

  const calendar = active ? calendarFor(active.login, active.total, null) : null;

  return (
    <>
      <ul className="group/index" onPointerLeave={hide} onBlur={hide}>
        {entries.map((entry) => {
          const href = entry.hasProfile
            ? `/u/${entry.login}`
            : `https://github.com/${entry.login}`;
          const external = !entry.hasProfile;

          return (
            <li key={entry.login}>
              <Link
                href={href}
                {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                data-cursor={external ? "GITHUB" : "PROFILE"}
                onPointerEnter={() => show(entry)}
                onFocus={() => show(entry)}
                className="grid grid-cols-[3.5ch_1fr_auto] items-baseline gap-[var(--space-sm)] border-b border-rule py-[var(--space-sm)] transition-opacity duration-[var(--dur-quick)] ease-[var(--ease-out-expo)] group-hover/index:opacity-35 hover:!opacity-100 focus-visible:!opacity-100 sm:grid-cols-[3.5ch_1fr_auto_auto] sm:gap-[var(--space-md)]"
              >
                <span className="mono text-caption text-muted">
                  {rankLabel(entry.rank)}
                </span>

                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-h2 leading-tight">
                    {entry.name ?? entry.login}
                  </span>
                  <span className="mono truncate text-caption text-muted">
                    @{entry.login}
                    {entry.location ? ` · ${entry.location}` : ""}
                  </span>
                </span>

                <span className="mono hidden text-caption text-muted sm:block">
                  {abbreviate(entry.followers)} followers
                </span>

                <span className="mono text-right text-h2 tabular-nums">
                  {abbreviate(entry.total)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {fine ? (
        <div
          ref={preview}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-50 w-[22rem] border border-rule bg-paper p-[var(--space-sm)]"
          style={{
            opacity: active ? 1 : 0,
            // The translate is positional, not decorative — it is how the
            // preview follows the cursor. Only the scale is an animation, so
            // that is the part reduced motion drops.
            transform: `translate3d(var(--px, 0px), var(--py, 0px), 0) translate(2rem, -50%) scale(${active || reduced ? 1 : 0.96})`,
            transition: reduced
              ? "none"
              : "opacity var(--dur-quick) var(--ease-out-expo), scale var(--dur-quick) var(--ease-out-expo)",
          }}
        >
          {active && calendar ? (
            <div className="flex flex-col gap-[var(--space-xs)]">
              <div className="flex items-center gap-[var(--space-xs)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={active.avatarUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 shrink-0 object-cover"
                  loading="eager"
                />
                <div className="min-w-0">
                  <p className="mono truncate text-caption">@{active.login}</p>
                  <p className="truncate text-caption text-muted">
                    {active.company ?? active.location ?? "—"}
                  </p>
                </div>
              </div>
              <Heatmap days={calendar.days} compact />
              <p className="eyebrow">
                {abbreviate(active.total)} contributions
                {calendar.estimated ? " · shape estimated" : ""}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
