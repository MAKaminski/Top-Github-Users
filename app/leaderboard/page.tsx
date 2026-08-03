import type { Metadata } from "next";
import Link from "next/link";
import { LeaderboardHeader, LeaderboardRow } from "@/components/leaderboard-rows";
import { LeaderboardInfinite } from "@/components/leaderboard-infinite";
import { ScrollProgressRule } from "@/components/patterns/scroll-progress-rule";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { HeatmapLegend } from "@/components/charts/heatmap";
import { StructuredData } from "@/components/structured-data";
import { getLeaderboard, getManifest, isSort, type Sort } from "@/lib/api/queries";
import { breadcrumbSchema, leaderboardSchema } from "@/lib/structured-data";
import { exact } from "@/lib/format";

/** Rendered on the server. The client continues from here as the reader scrolls. */
const FIRST_PAGE = 100;

/**
 * How deep the paginated series stays indexable.
 *
 * A 250,000-row board is 2,500 offset URLs per sort — 7,500 near-identical
 * pages of a hundred rows each. Left indexable they would swamp the pages worth
 * finding and spend the crawl budget on thin duplicates. The head of each sort
 * is genuinely useful and stays indexed; past that the depth is served by the
 * individually-indexed profile pages, which is where the long tail belongs.
 */
const INDEXABLE_OFFSET = 900;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const raw = params.sort;
  const requested = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  const sort: Sort = requested && isSort(requested) ? requested : "contributions";
  const offsetRaw = params.offset;
  const offset = Math.max(0, Number((Array.isArray(offsetRaw) ? offsetRaw[0] : offsetRaw) ?? 0) || 0);

  // Self-canonical, including the parameters. An offset page holds different
  // developers, and a sort holds a different ordering — collapsing either onto
  // `/leaderboard` would tell Google that pages showing different people are
  // the same page.
  const query = new URLSearchParams();
  if (sort !== "contributions") query.set("sort", sort);
  if (offset > 0) query.set("offset", String(offset));
  const canonical = query.size ? `/leaderboard?${query}` : "/leaderboard";

  const by = { contributions: "contributions", followers: "followers", streak: "streak" }[sort];
  const from = offset > 0 ? ` Ranks ${offset + 1} to ${offset + FIRST_PAGE}.` : "";

  return {
    title: offset > 0 ? `Worldwide leaderboard — from rank ${offset + 1}` : "Worldwide leaderboard",
    description:
      `The most active developers on GitHub worldwide, ranked by ${by} over the trailing ` +
      `twelve months.${from}`,
    alternates: { canonical },
    robots: offset > INDEXABLE_OFFSET ? { index: false, follow: true } : undefined,
  };
}

const SORT_LABELS: Record<Sort, string> = {
  contributions: "Contributions",
  followers: "Followers",
  streak: "Streak",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };

  const requested = read("sort");
  const sort: Sort = requested && isSort(requested) ? requested : "contributions";
  // `?offset=` is what makes "jump to rank" work without JavaScript, and what
  // the client component's jump form navigates to.
  const offset = Math.max(0, Number(read("offset")) || 0);

  const [manifest, result] = await Promise.all([
    getManifest(),
    getLeaderboard("worldwide", FIRST_PAGE, offset, sort),
  ]);

  if ("error" in result) throw new Error(result.error);
  const { page } = result;

  const estimated = page.items.filter((entry) => entry.calendarMeasured === false).length;
  const linkFor = (option: Sort) =>
    option === "contributions" ? "/leaderboard" : `/leaderboard?sort=${option}`;

  return (
    <>
      <StructuredData
        data={[
          leaderboardSchema({
            entries: page.items,
            path: linkFor(sort),
            name: `Most active developers on GitHub worldwide, by ${sort}`,
            description: `Ranks ${offset + 1} to ${offset + page.items.length} of ${page.total}.`,
          }),
          breadcrumbSchema([
            { name: "Commitgraph", path: "/" },
            { name: "Leaderboard", path: "/leaderboard" },
          ]),
        ]}
      />
      <ScrollProgressRule />

      <section className="shell py-[var(--space-lg)]">
        <div className="egrid items-end">
          <div className="col-span-full lg:col-span-8">
            <p className="eyebrow mb-[var(--space-xs)]">Worldwide · {manifest.generatedAt}</p>
            <h1 className="text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
              The leaderboard
            </h1>
          </div>
          <p className="prose col-span-full mt-[var(--space-sm)] text-muted lg:col-span-4 lg:mt-0">
            All {exact(page.total)} developers in the snapshot, ranked by public plus private
            contributions over the trailing twelve months. Ties break on followers, then login, so
            the order is stable between snapshots.
          </p>
        </div>

        {/* Real links, not buttons: sorting is a URL, so it survives a reload,
            a shared link and a browser with JavaScript switched off. */}
        <nav
          aria-label="Sort the leaderboard"
          className="mono mt-[var(--space-md)] flex flex-wrap items-center justify-between gap-[var(--space-xs)] text-caption uppercase tracking-[var(--tracking-caption)] text-muted"
        >
          <span className="flex flex-wrap items-center gap-[var(--space-xs)]">
            <span aria-hidden="true">Sort</span>
            {(Object.keys(SORT_LABELS) as Sort[]).map((option) => (
              <Link
                key={option}
                href={linkFor(option)}
                aria-current={sort === option ? "true" : undefined}
                className="min-h-11 border border-transparent px-2 py-1 transition-colors hover:text-ink aria-[current=true]:border-rule aria-[current=true]:text-ink"
              >
                {SORT_LABELS[option]}
              </Link>
            ))}
          </span>
          <HeatmapLegend />
        </nav>

        {sort === "streak" ? (
          <p className="prose mt-[var(--space-xs)] text-caption text-muted">
            Ranked on the longest streak in the trailing year.{" "}
            {estimated === page.items.length
              ? "Every streak in this snapshot is an estimate"
              : `${exact(estimated)} of the ${exact(page.items.length)} rows on this page are estimates`}
            , derived from the measured contribution total rather than a fetched calendar, and
            marked with ≈. The scheduled crawler replaces them with real ones —{" "}
            <Link href="/methodology" className="underline underline-offset-4">
              how and why
            </Link>
            .
          </p>
        ) : null}

        <div className="mt-[var(--space-sm)]">
          <LeaderboardHeader />

          {/* Only the server-rendered page is staggered. Rows appended by the
              scroll loader arrive already visible — animating them in as they
              land under the reader's eye reads as jitter, not craft. */}
          <ViewportStaggerReveal>
            {page.items.map((entry) => (
              <LeaderboardRow key={entry.login} entry={entry} />
            ))}
          </ViewportStaggerReveal>

          <LeaderboardInfinite
            scope="worldwide"
            sort={sort}
            initial={page.items}
            startRank={offset + 1}
            total={page.total}
          />

          <JumpToRank sort={sort} total={page.total} />
        </div>
      </section>
    </>
  );
}

/**
 * Reaching rank 180,000 by scrolling is not a feature, it is a punishment.
 *
 * A plain GET form: no JavaScript required, and the resulting URL is the same
 * one the sort links produce, so a jumped-to position is shareable.
 */
function JumpToRank({ sort, total }: { sort: Sort; total: number }) {
  return (
    <form
      action="/leaderboard"
      className="mono flex flex-wrap items-center gap-[var(--space-xs)] border-t border-rule py-[var(--space-sm)] text-caption uppercase tracking-[var(--tracking-caption)] text-muted"
    >
      {sort !== "contributions" ? <input type="hidden" name="sort" value={sort} /> : null}
      <label htmlFor="jump-offset">Jump to rank</label>
      <input
        id="jump-offset"
        name="offset"
        type="number"
        min={0}
        max={Math.max(0, total - 1)}
        step={100}
        placeholder="0"
        className="min-h-11 w-28 border border-rule bg-transparent px-2 py-1 text-ink tabular-nums"
      />
      <button
        type="submit"
        className="min-h-11 border border-rule px-3 py-1 transition-colors hover:text-ink"
      >
        Go
      </button>
    </form>
  );
}
