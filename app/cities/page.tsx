import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { getManifest } from "@/lib/data";
import { flagOf } from "@/scripts-shared/flags";
import { abbreviate, exact, rankLabel } from "@/lib/format";

export const metadata: Metadata = {
  title: "Cities",
  description:
    "GitHub contribution leaderboards for every tracked city, kept only where enough developers " +
    "agree on the same place name.",
  alternates: { canonical: "/cities" },
  openGraph: { title: "Top GitHub developers by city · Commitgraph", url: "/cities" },
};

export default async function CitiesPage() {
  const manifest = await getManifest();

  return (
    <section className="shell py-[var(--space-lg)]">
      <p className="eyebrow mb-[var(--space-xs)]">{manifest.counts.cities} cities</p>
      <h1 className="max-w-[20ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
        The cities that ship
      </h1>
      <p className="prose mt-[var(--space-sm)] text-muted">
        Cities are parsed from the free-text location on each profile, and only kept where at
        least eight tracked developers agree on the same name. Ambiguous strings are dropped
        rather than guessed at — {exact(manifest.counts.users)} developers went in, and these are
        the places that survived that rule.
      </p>

      <ViewportStaggerReveal
        className="mt-[var(--space-lg)] grid gap-[var(--grid-gap)] sm:grid-cols-2 lg:grid-cols-3"
        as="div"
      >
        {manifest.cities.map((city, index) => (
          <Link
            key={city.id}
            href={`/cities/${city.id}`}
            data-cursor="OPEN"
            className="flex h-full flex-col justify-between gap-[var(--space-sm)] border border-rule p-[var(--space-sm)] transition-colors hover:border-ink"
          >
            <div className="flex items-start justify-between gap-[var(--space-xs)]">
              <div>
                <p className="text-h2 leading-tight">{city.name}</p>
                <p className="mono text-caption text-muted">
                  <span aria-hidden="true">{flagOf(city.iso2)}</span> {city.userCount} developers
                </p>
              </div>
              <span className="mono text-caption text-muted">
                {rankLabel(index + 1)}
              </span>
            </div>

            <div className="flex items-end justify-between gap-[var(--space-xs)]">
              <ul className="flex -space-x-2">
                {city.top.map((person) => (
                  <li key={person.login}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={person.avatarUrl}
                      alt=""
                      width={28}
                      height={28}
                      loading="lazy"
                      className="size-7 border border-paper object-cover"
                    />
                  </li>
                ))}
              </ul>
              <span className="mono tabular-nums">{abbreviate(city.totalContributions)}</span>
            </div>
          </Link>
        ))}
      </ViewportStaggerReveal>
    </section>
  );
}
