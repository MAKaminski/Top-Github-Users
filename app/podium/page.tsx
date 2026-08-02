import type { Metadata } from "next";
import Link from "next/link";
import { PinnedHorizontalScroll } from "@/components/patterns/pinned-horizontal-scroll";
import { Heatmap } from "@/components/charts/heatmap";
import { SplitBar } from "@/components/charts/split-bar";
import { StreakRing } from "@/components/charts/streak-ring";
import { BumpChart } from "@/components/charts/bump-chart";
import { getHistory, getWorldwide } from "@/lib/data";
import { calendarFor, streaksFrom } from "@/lib/calendar";
import { abbreviate, exact, rankLabel } from "@/lib/format";

export const metadata: Metadata = {
  title: "The top ten",
  description: "A panel-by-panel walk through the ten most active developers on GitHub.",
};

export default async function PodiumPage() {
  const [worldwide, history] = await Promise.all([getWorldwide(), getHistory("worldwide")]);
  const top = worldwide.entries.slice(0, 10);

  const panels = top.map((entry) => {
    const calendar = calendarFor(entry.login, entry.total, null);
    const streak = streaksFrom(calendar.days);

    return (
      <article
        key={entry.login}
        className="flex h-full flex-col gap-[var(--space-sm)] border border-rule bg-[color-mix(in_oklab,var(--paper)_70%,transparent)] p-[var(--space-md)] backdrop-blur-sm"
      >
        <div className="flex items-start justify-between gap-[var(--space-sm)]">
          <span className="mono text-h1 leading-none text-accent">
            {rankLabel(entry.rank)}
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={entry.avatarUrl}
            alt=""
            width={72}
            height={72}
            loading="lazy"
            className="size-16 object-cover"
          />
        </div>

        <div>
          <h2 className="text-h2 leading-tight">{entry.name ?? entry.login}</h2>
          <Link
            href={entry.hasProfile ? `/u/${entry.login}` : `https://github.com/${entry.login}`}
            data-cursor="PROFILE"
            className="mono text-caption text-muted underline underline-offset-4 transition-colors hover:text-ink"
          >
            @{entry.login}
          </Link>
          {entry.location ? (
            <p className="mt-1 text-caption text-muted">{entry.location}</p>
          ) : null}
        </div>

        <Heatmap days={calendar.days} label={`${entry.login} contribution activity`} />

        <SplitBar publicCount={entry.public} privateCount={entry.private} />

        <div className="mt-auto grid grid-cols-2 gap-[var(--space-sm)] border-t border-rule pt-[var(--space-sm)]">
          <div>
            <p className="mono text-h2 leading-none">{abbreviate(entry.total)}</p>
            <p className="eyebrow">Contributions</p>
          </div>
          <div>
            <p className="mono text-h2 leading-none">
              {abbreviate(entry.followers)}
            </p>
            <p className="eyebrow">Followers</p>
          </div>
        </div>

        <StreakRing current={streak.current} longest={streak.longest} size={96} />
        {calendar.estimated ? (
          <p className="eyebrow">Daily shape estimated · totals measured</p>
        ) : null}
      </article>
    );
  });

  return (
    <>
      <section className="shell py-[var(--space-lg)]">
        <p className="eyebrow mb-[var(--space-xs)]">Worldwide · positions 1 to 10</p>
        <h1 className="max-w-[18ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          Ten people, one year of work
        </h1>
        <p className="prose mt-[var(--space-sm)] text-muted">
          Scroll to walk sideways through the top ten. Between them they account for{" "}
          {exact(top.reduce((sum, entry) => sum + entry.total, 0))} contributions in the trailing
          twelve months.
        </p>
      </section>

      <PinnedHorizontalScroll panels={panels} label="The top ten developers" />

      <section className="shell border-t border-rule py-[var(--space-lg)]">
        <h2 className="mb-[var(--space-md)] text-h1 tracking-[var(--tracking-display)]">
          Rank movement
        </h2>
        <BumpChart history={history} />
      </section>
    </>
  );
}
