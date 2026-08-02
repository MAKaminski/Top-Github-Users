import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LeaderboardHeader, LeaderboardRow } from "@/components/leaderboard-rows";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { ScrollProgressRule } from "@/components/patterns/scroll-progress-rule";
import { getCityBoard, getManifest } from "@/lib/data";
import { flagOf } from "@/scripts-shared/flags";
import { abbreviate, exact } from "@/lib/format";

export async function generateStaticParams() {
  const manifest = await getManifest();
  return manifest.cities.map((place) => ({ id: place.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const manifest = await getManifest();
  const place = manifest.cities.find((p) => p.id === id);
  if (!place) return {};
  return {
    title: `${place.name} leaderboard`,
    description: `The most active GitHub developers in ${place.name}.`,
  };
}

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [manifest, board] = await Promise.all([getManifest(), getCityBoard(id)]);
  const place = manifest.cities.find((p) => p.id === id);
  if (!place || !board) notFound();

  const country = manifest.countries.find((c) => c.id === place.countryId);

  return (
    <>
      <ScrollProgressRule />

      <section className="shell py-[var(--space-lg)]">
        <Link href="/cities" className="eyebrow underline underline-offset-4">
          ← All cities
        </Link>

        <div className="egrid mt-[var(--space-sm)] items-end">
          <div className="col-span-full lg:col-span-8">
            <h1 className="text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
              {place.name}
            </h1>
            {country ? (
              <Link
                href={`/countries/${country.id}`}
                className="eyebrow underline underline-offset-4"
              >
                <span aria-hidden="true">{flagOf(place.iso2)}</span> {country.name}
              </Link>
            ) : null}
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

        <div className="mt-[var(--space-lg)]">
          <LeaderboardHeader />
          <ViewportStaggerReveal>
            {board.entries.map((entry) => (
              <LeaderboardRow key={entry.login} entry={entry} sparkline={false} />
            ))}
          </ViewportStaggerReveal>
        </div>

        {/* A ranked head, like the country pages. Search reads the index and so
            covers everyone this file leaves out. */}
        <p className="prose mt-[var(--space-md)] text-caption text-muted">
          Showing the top {exact(board.entries.length)} in {place.name}.{" "}
          <Link href={`/search?city=${place.id}`} className="underline underline-offset-4">
            Search every tracked developer here
          </Link>
          .
        </p>
      </section>
    </>
  );
}
