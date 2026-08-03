import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LeaderboardHeader, LeaderboardRow } from "@/components/leaderboard-rows";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { ScrollProgressRule } from "@/components/patterns/scroll-progress-rule";
import { FollowersScatter } from "@/components/charts/scatter";
import { StructuredData } from "@/components/structured-data";
import { getCountryBoard, getManifest } from "@/lib/data";
import { breadcrumbSchema, placeSchema } from "@/lib/structured-data";
import { flagOf } from "@/scripts-shared/flags";
import { abbreviate, exact } from "@/lib/format";

export async function generateStaticParams() {
  const manifest = await getManifest();
  return manifest.countries.map((place) => ({ id: place.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const manifest = await getManifest();
  const place = manifest.countries.find((p) => p.id === id);
  if (!place) return {};
  const description =
    `The ${place.userCount.toLocaleString("en-US")} most active GitHub developers in ` +
    `${place.name}, ranked by contributions over the trailing twelve months.`;

  return {
    title: `${place.name} leaderboard`,
    description,
    alternates: { canonical: `/countries/${place.id}` },
    openGraph: { title: `Top GitHub developers in ${place.name}`, description, url: `/countries/${place.id}` },
  };
}

export default async function CountryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [manifest, board] = await Promise.all([getManifest(), getCountryBoard(id)]);
  const place = manifest.countries.find((p) => p.id === id);
  if (!place || !board) notFound();

  const cities = manifest.cities.filter((city) => city.countryId === id);

  return (
    <>
      <StructuredData
        data={[
          placeSchema(place, "country", `/countries/${place.id}`),
          breadcrumbSchema([
            { name: "Commitgraph", path: "/" },
            { name: "Countries", path: "/countries" },
            { name: place.name, path: `/countries/${place.id}` },
          ]),
        ]}
      />
      <ScrollProgressRule />

      <section className="shell py-[var(--space-lg)]">
        <Link href="/countries" className="eyebrow underline underline-offset-4">
          ← All countries
        </Link>

        <div className="egrid mt-[var(--space-sm)] items-end">
          <div className="col-span-full lg:col-span-8">
            <h1 className="flex items-center gap-[var(--space-xs)] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
              <span aria-hidden="true">{flagOf(place.iso2)}</span>
              {place.name}
            </h1>
          </div>
          <dl className="col-span-full mt-[var(--space-sm)] grid grid-cols-3 gap-[var(--space-sm)] lg:col-span-4 lg:mt-0">
            <div>
              <dt className="eyebrow">Developers</dt>
              <dd className="mono text-h2">{exact(place.userCount)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Contributions</dt>
              <dd className="mono text-h2">
                {abbreviate(place.totalContributions)}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Followers</dt>
              <dd className="mono text-h2">{abbreviate(place.totalFollowers)}</dd>
            </div>
          </dl>
        </div>

        {cities.length > 0 ? (
          <ul className="mt-[var(--space-md)] flex flex-wrap gap-[var(--space-2xs)]">
            {cities.map((city) => (
              <li key={city.id}>
                <Link
                  href={`/cities/${city.id}`}
                  className="mono block border border-rule px-[var(--space-xs)] py-1 text-caption transition-colors hover:border-ink"
                >
                  {city.name} · {city.userCount}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-[var(--space-lg)]">
          <LeaderboardHeader />
          <ViewportStaggerReveal>
            {board.entries.map((entry) => (
              <LeaderboardRow key={entry.login} entry={entry} sparkline={false} />
            ))}
          </ViewportStaggerReveal>
        </div>

        {/* This page is a ranked head, not the whole country. Search carries the
            tail, because it reads the index rather than this board file. */}
        <p className="prose mt-[var(--space-md)] text-caption text-muted">
          Showing the top {exact(board.entries.length)} in {place.name}.{" "}
          <Link
            href={`/search?country=${place.id}&sort=contributions`}
            className="underline underline-offset-4"
          >
            Search every tracked developer here
          </Link>
          , including those ranked below this page.
        </p>
      </section>

      <section className="shell border-t border-rule py-[var(--space-lg)]">
        <h2 className="mb-[var(--space-md)] text-h1 tracking-[var(--tracking-display)]">
          Reach against output in {place.name}
        </h2>
        <FollowersScatter entries={board.entries} highlight={4} />
      </section>
    </>
  );
}
