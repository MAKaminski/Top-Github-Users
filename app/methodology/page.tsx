import type { Metadata } from "next";
import Link from "next/link";
import { ScrollColorInversion } from "@/components/patterns/scroll-color-inversion";
import { getFlaggedAccounts, getManifest } from "@/lib/data";
import { abbreviate, exact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Methodology",
  description: "How Commitgraph's numbers are produced, and where they are wrong.",
};

export default async function MethodologyPage() {
  const [manifest, flagged] = await Promise.all([getManifest(), getFlaggedAccounts()]);

  return (
    <>
      <section className="shell py-[var(--space-lg)]">
        <p className="eyebrow mb-[var(--space-xs)]">Snapshot {manifest.generatedAt}</p>
        <h1 className="max-w-[20ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          How these numbers are made
        </h1>
        <p className="prose mt-[var(--space-md)] text-muted">
          Every leaderboard in this space presents its ranking as fact. None of them tell you what
          the ranking cannot see. This page does both.
        </p>
      </section>

      {/* full-bleed-break: resets the rhythm between the intro and the detail */}
      <div
        className="bleed my-[var(--space-md)] h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, var(--accent), var(--accent-warm), transparent)",
        }}
      />

      <section className="shell py-[var(--space-lg)]">
        <div className="prose flex flex-col gap-[var(--space-md)]">
          <div>
            <h2 className="text-h2">What is counted</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              A developer&rsquo;s score is their public plus private contributions over the
              trailing twelve months. Private contributions are the count GitHub itself exposes —
              a number, never the underlying work. Ranking uses contributions first, followers
              second, and login alphabetically as the final tie-break, so equal scores never swap
              places between snapshots.
            </p>
          </div>

          <div>
            <h2 className="text-h2">How developers are found</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              Candidates come from{" "}
              <a href="https://www.gharchive.org/" className="underline underline-offset-4">
                GH Archive
              </a>
              , the public record of every public GitHub event. Streaming a rolling seven-day
              window finds everyone who did something visible, costs no API budget at all, and
              takes seconds rather than the hours a search-based sweep needs. Only the filtered
              survivors are then looked up through GitHub&rsquo;s API.
            </p>
            <p className="mt-[var(--space-2xs)] text-muted">
              Every board — worldwide, country and city — is then <em>derived</em> from that single
              hydrated set by grouping it on the parsed location. That is what removed the old
              ceiling: a location-scoped search returns at most a thousand results per query, so
              the previous pipeline could never rank more than a thousand people anywhere, however
              long it ran.
            </p>
            <p className="mt-[var(--space-2xs)] text-muted">
              The limit worth knowing: the archive only records <em>public</em> activity, so
              somebody working almost entirely in private repositories does not appear in it. A
              smaller search pass covers that gap by contributing names for the next hydration to
              fetch. Accounts firing thousands of events at a single repository are dropped as
              automation before anything is looked up.
            </p>
          </div>

          <div>
            <h2 className="text-h2">Where location comes from</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              GitHub has no structured country or city field — only a free-text line that people
              fill in however they like. Both country and city are parsed from that one string,
              and a city is kept only where at least eight tracked developers agree on a name. &ldquo;Earth&rdquo;, &ldquo;remote&rdquo; and &ldquo;/dev/null&rdquo; are
              discarded rather than guessed at. This is the single largest source of error on the
              site, and it affects every competitor equally.
            </p>
          </div>

          <div>
            <h2 className="text-h2">How deep the rankings go</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The board is the whole snapshot, not a top hundred:{" "}
              <Link href="/leaderboard" className="underline underline-offset-4">
                every ranked developer
              </Link>{" "}
              is reachable, sortable by contributions, followers or streak, and searchable by
              login, name, company or location. The ceiling is 250,000 developers, and it is a
              storage decision rather than an API one — snapshots are committed to git so each one
              can be diffed against the day before, and a corpus much past that size would be
              rewritten wholesale on every crawl.
            </p>
          </div>

          <div>
            <h2 className="text-h2">Measured against estimated</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              Contribution <strong>totals</strong> and follower counts are measured, for everyone.
              The day-by-day calendar is not: it is by far the most expensive thing to fetch, so it
              is bought for the top of the board and estimated below that. An estimated calendar is
              derived deterministically from the measured total — the same login always produces
              the same calendar, and the total always matches exactly.
            </p>
            <p className="mt-[var(--space-2xs)] text-muted">
              This matters most for <strong>streaks</strong>, which can only be read off a
              calendar. Ranking by streak therefore ranks measured and estimated values together,
              and every estimated row is marked with <span className="mono">≈</span> — in the text,
              not only in the colour. An estimated streak is a plausible shape, not a fact about
              that person&rsquo;s week. The scheduled crawler replaces estimates with real
              calendars as it reaches them.
            </p>
          </div>

          <div>
            <h2 className="text-h2">Organizations</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The <Link href="/orgs" className="underline underline-offset-4">organization board</Link>{" "}
              ranks employers by the combined contributions of tracked developers who name them in
              their profile, not by follower count. It is drawn from a free-text company field, so
              it reflects what people write, including spelling variants.
            </p>
          </div>
        </div>
      </section>

      {/* The inversion section: the page flips light as this crosses centre. */}
      <ScrollColorInversion theme="light">
        <div className="bleed bg-paper py-[var(--space-lg)] text-ink">
          <div className="shell">
            <h2 className="max-w-[24ch] text-h1 tracking-[var(--tracking-display)]">
              Accounts we exclude, and why we show you anyway
            </h2>
            <p className="prose mt-[var(--space-sm)] text-muted">
              {exact(manifest.counts.flagged)} accounts exceeded 300,000 contributions in twelve
              months — over 820 every day without a break. That is not a person; it is a bot
              committing under a personal account. They are excluded from every ranking. Most
              leaderboards either let these accounts sit at number one or drop them silently. Here
              they are, so you can judge the rule for yourself.
            </p>

            {flagged.length > 0 ? (
              <ul className="mt-[var(--space-md)] grid gap-[var(--space-xs)] sm:grid-cols-2 lg:grid-cols-3">
                {flagged.map((account) => (
                  <li
                    key={account.login}
                    className="flex items-center justify-between gap-[var(--space-xs)] border border-rule p-[var(--space-xs)]"
                  >
                    <a
                      href={`https://github.com/${account.login}`}
                      className="mono truncate text-caption underline underline-offset-4"
                    >
                      @{account.login}
                    </a>
                    <span className="mono shrink-0 tabular-nums">
                      {abbreviate(account.total)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </ScrollColorInversion>

      <section className="shell py-[var(--space-lg)]">
        <div className="prose flex flex-col gap-[var(--space-md)]">
          <div>
            <h2 className="text-h2">Where this snapshot came from</h2>
            <p className="mt-[var(--space-2xs)] text-muted">{manifest.sourceNote}</p>
            {manifest.source === "bootstrap" ? (
              <p className="mt-[var(--space-2xs)] text-muted">
                Bootstrap data is mapped from{" "}
                <a
                  href="https://github.com/gayanvoice/top-github-users"
                  className="underline underline-offset-4"
                >
                  gayanvoice/top-github-users
                </a>
                , a public dataset, with thanks. This repository&rsquo;s own crawler replaces it on
                its first scheduled run.
              </p>
            ) : null}
          </div>

          <div>
            <h2 className="text-h2">Reproducing it</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              The crawler, the schema and this site are all in{" "}
              <a
                href="https://github.com/MAKaminski/Top-Github-Users"
                className="underline underline-offset-4"
              >
                one repository
              </a>
              . Snapshots are committed as JSON, so any ranking on this site can be diffed against
              the day before it.
            </p>
          </div>

          <div>
            <h2 className="text-h2">Design</h2>
            <p className="mt-[var(--space-2xs)] text-muted">
              Motion patterns come from{" "}
              <a
                href="https://rejouice-patterns.vercel.app"
                className="underline underline-offset-4"
              >
                rejouice-patterns
              </a>
              , scaled down deliberately: this is a data site, so the display type is roughly a
              third of the corpus default and density carries the page. Every animation is
              disabled under <code className="mono">prefers-reduced-motion</code>, and every route
              is readable with JavaScript switched off.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
