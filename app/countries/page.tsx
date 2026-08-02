import type { Metadata } from "next";
import Link from "next/link";
import { StickyPanelStack } from "@/components/patterns/sticky-panel-stack";
import { TileGridMap } from "@/components/charts/tile-grid-map";
import { getManifest } from "@/lib/data";
import { flagOf } from "@/scripts-shared/flags";
import { abbreviate, exact, rankLabel } from "@/lib/format";

export const metadata: Metadata = {
  title: "Countries",
  description:
    "GitHub contribution leaderboards for every tracked country, ranked by the developers who " +
    "list that country on their profile.",
  alternates: { canonical: "/countries" },
  openGraph: { title: "Top GitHub developers by country · Commitgraph", url: "/countries" },
};

export default async function CountriesPage() {
  const manifest = await getManifest();
  const regions = [...new Set(manifest.countries.map((c) => c.region).filter(Boolean))] as string[];

  const panels = regions.map((region) => {
    const places = manifest.countries.filter((place) => place.region === region);
    return (
      <div key={region} className="p-[var(--space-md)]">
        <div className="mb-[var(--space-sm)] flex items-baseline justify-between gap-[var(--space-sm)]">
          <h2 className="text-h1 tracking-[var(--tracking-display)]">{region}</h2>
          <span className="eyebrow">{places.length} countries</span>
        </div>
        <ul>
          {places.map((place, index) => (
            <li key={place.id}>
              <Link
                href={`/countries/${place.id}`}
                data-cursor="OPEN"
                className="grid grid-cols-[3.5ch_1fr_auto_auto] items-center gap-[var(--space-sm)] border-b border-rule py-[var(--space-xs)] transition-colors hover:bg-surface"
              >
                <span className="mono text-caption text-muted">
                  {rankLabel(index + 1, 2)}
                </span>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true">{flagOf(place.iso2)}</span>
                  {place.name}
                </span>
                <span className="mono hidden text-caption text-muted sm:block">
                  {place.userCount} devs
                </span>
                <span className="mono text-right tabular-nums">
                  {abbreviate(place.totalContributions)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  });

  return (
    <>
      <section className="shell py-[var(--space-lg)]">
        <p className="eyebrow mb-[var(--space-xs)]">
          {manifest.counts.countries} countries · {manifest.generatedAt}
        </p>
        <h1 className="max-w-[20ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          Every country, one tile each
        </h1>
        <p className="prose mt-[var(--space-sm)] text-muted">
          {exact(manifest.totals.contributions)} contributions, mapped by where developers say they
          are. Location on GitHub is a free-text field, so these boundaries are self-reported —
          see the methodology.
        </p>

        <div className="mt-[var(--space-lg)]">
          <TileGridMap places={manifest.countries} />
        </div>
      </section>

      <div className="shell pb-[var(--space-xl)]">
        <StickyPanelStack panels={panels} label="Countries by region" />
      </div>
    </>
  );
}
