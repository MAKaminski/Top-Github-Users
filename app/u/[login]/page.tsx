import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { TextScramble } from "@/components/patterns/text-scramble";
import { OdometerStat } from "@/components/patterns/odometer-stat";
import { FrameParallaxMedia } from "@/components/patterns/frame-parallax-media";
import { Heatmap, HeatmapLegend } from "@/components/charts/heatmap";
import { Sparkline } from "@/components/charts/sparkline";
import { SplitBar } from "@/components/charts/split-bar";
import { StreakRing } from "@/components/charts/streak-ring";
import { getManifest, getProfileLogins, getUser } from "@/lib/data";
import { calendarFor, monthlyFrom, streaksFrom } from "@/lib/calendar";
import { flagOf } from "@/scripts-shared/flags";
import { abbreviate, exact, pseudoHash, rankLabel } from "@/lib/format";

export async function generateStaticParams() {
  const logins = await getProfileLogins();
  return logins.map((login) => ({ login }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ login: string }>;
}): Promise<Metadata> {
  const { login } = await params;
  const user = await getUser(login);
  if (!user) return {};
  return {
    title: `${user.name ?? user.login}`,
    description: `${user.login} made ${exact(user.contributions.total)} contributions in the last twelve months.`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ login: string }> }) {
  const { login } = await params;
  const [user, manifest] = await Promise.all([getUser(login), getManifest()]);
  if (!user) notFound();

  const calendar = calendarFor(user.login, user.contributions.total, user.calendar);
  const streak = user.streak ?? streaksFrom(calendar.days);
  const country = manifest.countries.find((c) => c.id === user.countryId);
  const city = manifest.cities.find((c) => c.id === user.cityId);

  return (
    <article className="shell py-[var(--space-lg)]">
      <div className="egrid items-start gap-y-[var(--space-md)]">
        {/* ---- Identity ---------------------------------------------------- */}
        <div className="col-span-full lg:col-span-4">
          <FrameParallaxMedia
            src={user.avatarUrl}
            alt={`${user.name ?? user.login}'s GitHub avatar`}
            className="w-full max-w-[20rem]"
            eager
          />
          <p className="eyebrow mt-[var(--space-xs)]">
            object {pseudoHash(user.login)} · snapshot {manifest.generatedAt}
          </p>
        </div>

        <div className="col-span-full lg:col-span-8">
          <p className="eyebrow mb-[var(--space-xs)]">
            {user.rank.worldwide ? `Worldwide ${rankLabel(user.rank.worldwide)}` : "Unranked"}
            {country && user.rank.country
              ? ` · ${country.name} ${rankLabel(user.rank.country)}`
              : ""}
            {city && user.rank.city ? ` · ${city.name} ${rankLabel(user.rank.city)}` : ""}
          </p>

          <h1 className="text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
            {user.name ?? user.login}
          </h1>

          <p className="mono mt-[var(--space-2xs)] text-h2 text-accent">
            <TextScramble text={`@${user.login}`} />
          </p>

          <ul className="mt-[var(--space-sm)] flex flex-wrap gap-x-[var(--space-md)] gap-y-1 text-caption text-muted">
            {user.company ? <li>{user.company}</li> : null}
            {user.location ? (
              <li>
                <span aria-hidden="true">{flagOf(country?.iso2 ?? null)}</span> {user.location}
              </li>
            ) : null}
            <li>
              <a
                href={`https://github.com/${user.login}`}
                className="underline underline-offset-4 transition-colors hover:text-ink"
              >
                github.com/{user.login}
              </a>
            </li>
          </ul>

          {user.bio ? <p className="prose mt-[var(--space-sm)]">{user.bio}</p> : null}

          <div className="mt-[var(--space-md)] grid grid-cols-2 gap-[var(--space-md)] sm:grid-cols-4">
            <OdometerStat value={user.contributions.total} label="Contributions" scale="h1" />
            <OdometerStat value={user.followers} label="Followers" scale="h1" />
            <OdometerStat value={streak.longest} label="Longest streak" compact={false} scale="h1" />
            <OdometerStat value={streak.current} label="Current streak" compact={false} scale="h1" />
          </div>
        </div>
      </div>

      {/* ---- The year ------------------------------------------------------ */}
      <section
        aria-labelledby="year-heading"
        className="mt-[var(--space-lg)] border-t border-rule pt-[var(--space-md)]"
      >
        <div className="mb-[var(--space-sm)] flex flex-wrap items-baseline justify-between gap-[var(--space-sm)]">
          <h2 id="year-heading" className="text-h1 tracking-[var(--tracking-display)]">
            The last 53 weeks
          </h2>
          <HeatmapLegend />
        </div>

        <Heatmap days={calendar.days} label={`${user.login} contribution activity`} />

        {calendar.estimated ? (
          <p className="mt-[var(--space-xs)] max-w-[62ch] text-caption text-muted">
            The <strong>total</strong> above is measured. The day-by-day shape is a deterministic
            estimate derived from that total, shown until this repository&rsquo;s own crawler has
            fetched the real calendar. It is labelled everywhere it appears —{" "}
            <Link href="/methodology" className="underline underline-offset-4">
              methodology
            </Link>
            .
          </p>
        ) : null}
      </section>

      {/* ---- Breakdown ----------------------------------------------------- */}
      <section
        aria-labelledby="breakdown-heading"
        className="mt-[var(--space-lg)] grid gap-[var(--space-lg)] border-t border-rule pt-[var(--space-md)] lg:grid-cols-3"
      >
        <h2 id="breakdown-heading" className="sr-only">
          Contribution breakdown
        </h2>

        <div>
          <p className="eyebrow mb-[var(--space-xs)]">Public against private</p>
          <SplitBar
            publicCount={user.contributions.public}
            privateCount={user.contributions.private}
          />
          <p className="mt-[var(--space-xs)] max-w-[38ch] text-caption text-muted">
            {user.contributions.public > user.contributions.private
              ? "Most of this work is visible on public repositories."
              : "Most of this work happens in private repositories."}
          </p>
        </div>

        <div>
          <p className="eyebrow mb-[var(--space-xs)]">Trailing twelve months</p>
          <Sparkline
            values={monthlyFrom(calendar.days)}
            width={280}
            height={72}
            label={`${user.login} monthly activity`}
          />
        </div>

        <div>
          <p className="eyebrow mb-[var(--space-xs)]">Consistency</p>
          <StreakRing current={streak.current} longest={streak.longest} />
        </div>
      </section>

      {/* ---- Context ------------------------------------------------------- */}
      <nav
        aria-label="Related leaderboards"
        className="mt-[var(--space-lg)] flex flex-wrap gap-[var(--space-xs)] border-t border-rule pt-[var(--space-md)]"
      >
        <Link href="/leaderboard" className="mono border border-rule px-[var(--space-xs)] py-2 text-caption transition-colors hover:border-ink">
          Worldwide leaderboard
        </Link>
        {country ? (
          <Link
            href={`/countries/${country.id}`}
            className="mono border border-rule px-[var(--space-xs)] py-2 text-caption transition-colors hover:border-ink"
          >
            {country.name} · {abbreviate(country.totalContributions)}
          </Link>
        ) : null}
        {city ? (
          <Link
            href={`/cities/${city.id}`}
            className="mono border border-rule px-[var(--space-xs)] py-2 text-caption transition-colors hover:border-ink"
          >
            {city.name} · {city.userCount} devs
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
