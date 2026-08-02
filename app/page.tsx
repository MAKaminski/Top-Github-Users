import Link from "next/link";
import { MaskedLineReveal } from "@/components/patterns/masked-line-reveal";
import { OdometerStat } from "@/components/patterns/odometer-stat";
import { HoverPreviewIndex } from "@/components/patterns/hover-preview-index";
import { MagneticCta } from "@/components/patterns/magnetic-cta";
import { FollowersScatter } from "@/components/charts/scatter";
import { TileGridMap } from "@/components/charts/tile-grid-map";
import { getManifest, getWorldwide } from "@/lib/data";
import { abbreviate, exact } from "@/lib/format";

export default async function HomePage() {
  const [manifest, worldwide] = await Promise.all([getManifest(), getWorldwide()]);
  const top = worldwide.entries.slice(0, 25);

  return (
    <>
      {/* ---- Hero: hero-statement + masked-line-reveal, used once ---------- */}
      <section className="shell flex min-h-[calc(100svh-var(--nav-h))] flex-col justify-between pb-[var(--space-lg)] pt-[var(--space-lg)]">
        <div className="egrid items-end">
          <div className="col-span-full lg:col-span-9">
            <p className="eyebrow mb-[var(--space-sm)]">
              Snapshot {manifest.generatedAt} · {exact(manifest.counts.users)} developers tracked
            </p>
            <MaskedLineReveal
              lines={[
                "Every ranking site",
                "shows you a number.",
                <span key="3" className="text-accent">
                  This one shows the work.
                </span>,
              ]}
              className="text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]"
            />
          </div>

          <p className="prose col-span-full mt-[var(--space-md)] text-muted lg:col-span-3 lg:mt-0">
            Worldwide, country and city leaderboards for the most active developers on GitHub —
            with the heatmaps, distributions and rank movement that a table of follower counts
            can never tell you.
          </p>
        </div>

        <div className="egrid mt-[var(--space-lg)] gap-y-[var(--space-md)]">
          <div className="col-span-2 lg:col-span-3">
            <OdometerStat
              value={manifest.totals.contributions}
              label="Contributions"
              sublabel="trailing twelve months"
            />
          </div>
          <div className="col-span-2 lg:col-span-3">
            <OdometerStat value={manifest.counts.users} label="Developers" sublabel="ranked" />
          </div>
          <div className="col-span-2 lg:col-span-3">
            <OdometerStat
              value={manifest.counts.countries}
              label="Countries"
              sublabel={`${manifest.counts.cities} cities`}
              compact={false}
            />
          </div>
          <div className="col-span-2 lg:col-span-3">
            <OdometerStat
              value={manifest.totals.followers}
              label="Followers"
              sublabel="combined reach"
            />
          </div>
        </div>
      </section>

      {/* ---- The index: hover a row, see that developer's actual year ------ */}
      <section
        aria-labelledby="top-heading"
        className="shell scroll-mt-[var(--nav-h-condensed)] py-[var(--space-lg)]"
      >
        <div className="mb-[var(--space-md)] flex flex-wrap items-baseline justify-between gap-[var(--space-sm)]">
          <h2 id="top-heading" className="text-h1 tracking-[var(--tracking-display)]">
            The top 25
          </h2>
          <p className="eyebrow">Hover a row for that developer&rsquo;s year</p>
        </div>

        <HoverPreviewIndex entries={top} />

        <div className="mt-[var(--space-md)] flex flex-wrap items-center gap-[var(--space-md)]">
          <MagneticCta href="/leaderboard" cursorLabel="OPEN">
            <span className="mono text-caption uppercase tracking-[var(--tracking-caption)]">
              Full leaderboard
            </span>
          </MagneticCta>
          <Link
            href="/podium"
            className="mono text-caption uppercase tracking-[var(--tracking-caption)] text-muted underline underline-offset-4 transition-colors hover:text-ink"
          >
            Walk the top ten
          </Link>
        </div>
      </section>

      {/* ---- The chart that justifies the dataset -------------------------- */}
      <section
        aria-labelledby="scatter-heading"
        className="shell border-t border-rule py-[var(--space-lg)]"
      >
        <div className="egrid mb-[var(--space-md)] items-end">
          <h2
            id="scatter-heading"
            className="col-span-full text-h1 tracking-[var(--tracking-display)] lg:col-span-7"
          >
            Fame and output are different axes
          </h2>
          <p className="prose col-span-full text-muted lg:col-span-5">
            Rank a leaderboard by followers and you measure reputation. Rank it by contributions
            and you measure work. Plot both and the gap is obvious — most of the busiest people on
            GitHub have an audience two orders of magnitude smaller than the famous ones.
          </p>
        </div>

        <FollowersScatter entries={worldwide.entries} />
      </section>

      {/* ---- Where the work happens ---------------------------------------- */}
      <section
        aria-labelledby="map-heading"
        className="shell border-t border-rule py-[var(--space-lg)]"
      >
        <div className="egrid mb-[var(--space-md)] items-end">
          <h2
            id="map-heading"
            className="col-span-full text-h1 tracking-[var(--tracking-display)] lg:col-span-7"
          >
            Where the commits come from
          </h2>
          <p className="prose col-span-full text-muted lg:col-span-5">
            Every country is one tile, positioned by its real centroid. Equal areas, so the map
            shows the data rather than the size of Russia.
          </p>
        </div>

        <TileGridMap places={manifest.countries} />

        <ul className="egrid mt-[var(--space-lg)] gap-y-[var(--space-sm)]">
          {manifest.countries.slice(0, 8).map((place) => (
            <li key={place.id} className="col-span-2 lg:col-span-3">
              <Link
                href={`/countries/${place.id}`}
                data-cursor="OPEN"
                className="flex flex-col gap-1 border-t border-rule pt-[var(--space-2xs)] transition-colors hover:border-ink"
              >
                <span className="text-h2">{place.name}</span>
                <span className="mono text-caption text-muted">
                  {abbreviate(place.totalContributions)} · {place.userCount} devs
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
