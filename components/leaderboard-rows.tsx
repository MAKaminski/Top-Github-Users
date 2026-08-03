import Link from "next/link";
import { Sparkline } from "./charts/sparkline";
import { calendarFor, monthlyFrom } from "@/lib/calendar";
import { abbreviate, movementOf, rankLabel } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/types";

/**
 * The dense leaderboard row used by every index page.
 *
 * A server component with no motion: it must render, and be readable, with
 * JavaScript disabled. Every number is in the DOM as text.
 */

/** Shared between the header and every row so the two cannot drift apart. */
const COLUMNS =
  "grid grid-cols-[4.5ch_1fr_auto] items-center gap-[var(--space-sm)] " +
  "md:grid-cols-[4.5ch_2.5rem_1fr_6rem_5rem_7rem_5.5rem] md:gap-[var(--space-md)]";

export function LeaderboardRow({
  entry,
  sparkline = true,
}: {
  entry: LeaderboardEntry;
  /**
   * Off for everything past the first page.
   *
   * Each sparkline generates a 371-day calendar and an SVG path. That is fine
   * for fifty rows and ruinous for a reader who has scrolled to rank 40,000, so
   * depth trades the chart away and keeps the numbers.
   */
  sparkline?: boolean;
}) {
  const href = entry.hasProfile ? `/u/${entry.login}` : `https://github.com/${entry.login}`;
  const external = !entry.hasProfile;
  const movement = movementOf(entry.rank, entry.previousRank);
  const monthly = sparkline
    ? monthlyFrom(calendarFor(entry.login, entry.total, null).days)
    : null;

  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      data-cursor={external ? "GITHUB" : "PROFILE"}
      className={`${COLUMNS} border-b border-rule py-[var(--space-xs)] transition-colors hover:bg-surface`}
    >
      <span className="mono flex items-center gap-1 text-caption text-muted">
        {rankLabel(entry.rank)}
        {movement.direction === "up" ? (
          <span className="text-[color:var(--level-4)]" aria-label={`up ${movement.delta}`}>
            ▲
          </span>
        ) : movement.direction === "down" ? (
          <span className="text-accent-warm" aria-label={`down ${movement.delta}`}>
            ▼
          </span>
        ) : null}
      </span>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={entry.avatarUrl}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        className="hidden size-10 object-cover md:block"
      />

      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body">{entry.name ?? entry.login}</span>
        <span className="mono truncate text-caption text-muted">
          @{entry.login}
          {entry.company ? ` · ${entry.company}` : ""}
        </span>
      </span>

      <span className="mono hidden text-caption text-muted md:block">
        {abbreviate(entry.followers)}
        <span className="sr-only"> followers</span>
      </span>

      <StreakCell entry={entry} />

      <span className="hidden md:block">
        {monthly ? (
          <Sparkline
            values={monthly}
            width={96}
            height={26}
            label={`${entry.login} trailing activity`}
          />
        ) : null}
      </span>

      <span className="mono text-right tabular-nums">
        {abbreviate(entry.total)}
        <span className="sr-only"> contributions</span>
      </span>
    </Link>
  );
}

/**
 * Longest streak, marked when it is an estimate.
 *
 * The marker is a character in the DOM and a phrase in the screen-reader text,
 * not a colour: a reader who cannot distinguish the muted tone still has to be
 * able to tell a fetched calendar from a derived one. See /methodology.
 */
function StreakCell({ entry }: { entry: LeaderboardEntry }) {
  if (!entry.streak) {
    return (
      <span className="mono hidden text-caption text-muted md:block" aria-hidden="true">
        —
      </span>
    );
  }

  const estimated = entry.calendarMeasured === false;
  return (
    <span
      className="mono hidden text-caption tabular-nums text-muted md:block"
      title={
        estimated
          ? "Estimated from the measured contribution total, not a fetched calendar"
          : "Longest streak, from the fetched contribution calendar"
      }
    >
      {estimated ? <span aria-hidden="true">≈</span> : null}
      {entry.streak.longest}d
      <span className="sr-only">
        {" "}
        longest streak{estimated ? ", estimated rather than measured" : ""}
      </span>
    </span>
  );
}

export function LeaderboardHeader() {
  return (
    <div
      className={`${COLUMNS} mono border-b border-ink pb-[var(--space-2xs)] text-caption uppercase tracking-[var(--tracking-caption)] text-muted`}
    >
      <span>#</span>
      <span className="hidden md:block" />
      <span>Developer</span>
      <span className="hidden md:block">Followers</span>
      <span className="hidden md:block">Streak</span>
      <span className="hidden md:block">Year</span>
      <span className="text-right">Total</span>
    </div>
  );
}
