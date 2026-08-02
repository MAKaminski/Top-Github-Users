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
export function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  const href = entry.hasProfile ? `/u/${entry.login}` : `https://github.com/${entry.login}`;
  const external = !entry.hasProfile;
  const calendar = calendarFor(entry.login, entry.total, null);
  const movement = movementOf(entry.rank, entry.previousRank);

  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      data-cursor={external ? "GITHUB" : "PROFILE"}
      className="grid grid-cols-[3.5ch_1fr_auto] items-center gap-[var(--space-sm)] border-b border-rule py-[var(--space-xs)] transition-colors hover:bg-surface md:grid-cols-[3.5ch_2.5rem_1fr_7rem_7rem_5.5rem] md:gap-[var(--space-md)]"
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

      <span className="hidden md:block">
        <Sparkline
          values={monthlyFrom(calendar.days)}
          width={96}
          height={26}
          label={`${entry.login} trailing activity`}
        />
      </span>

      <span className="mono text-right tabular-nums">
        {abbreviate(entry.total)}
        <span className="sr-only"> contributions</span>
      </span>
    </Link>
  );
}

export function LeaderboardHeader() {
  return (
    <div className="mono grid grid-cols-[3.5ch_1fr_auto] gap-[var(--space-sm)] border-b border-ink pb-[var(--space-2xs)] text-caption uppercase tracking-[var(--tracking-caption)] text-muted md:grid-cols-[3.5ch_2.5rem_1fr_7rem_7rem_5.5rem] md:gap-[var(--space-md)]">
      <span>#</span>
      <span className="hidden md:block" />
      <span>Developer</span>
      <span className="hidden md:block">Followers</span>
      <span className="hidden md:block">Year</span>
      <span className="text-right">Total</span>
    </div>
  );
}
