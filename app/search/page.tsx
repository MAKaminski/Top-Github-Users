import type { Metadata } from "next";
import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { getManifest, searchDevelopers } from "@/lib/api/queries";
import { abbreviate, exact } from "@/lib/format";

export const metadata: Metadata = {
  title: "Search developers",
  description: "Search every developer in the Commitgraph snapshot by login, name, company or location.",
};

const PAGE = 50;

/**
 * Search, server-rendered.
 *
 * The nav's combobox is the fast path; this is the one that has to work. Every
 * filter is a URL parameter, so a result set is linkable, back-buttonable and
 * reachable with JavaScript switched off — the same obligation every other
 * route on this site carries.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };

  const query = read("q");
  const country = read("country");
  const city = read("city");
  const company = read("company");
  const minFollowers = Number(read("minFollowers")) || undefined;
  const offset = Math.max(0, Number(read("offset")) || 0);
  const sortParam = read("sort");
  const sort =
    sortParam === "followers" || sortParam === "streak" || sortParam === "login"
      ? sortParam
      : "contributions";

  const [manifest, results] = await Promise.all([
    getManifest(),
    query || country || city || company || minFollowers
      ? searchDevelopers(
          { query, countryId: country, cityId: city, company, minFollowers, sort },
          PAGE,
          offset,
        )
      : Promise.resolve(null),
  ]);

  const linkWith = (changes: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const base: Record<string, string | number | undefined> = {
      q: query,
      country,
      city,
      company,
      minFollowers,
      sort: sort === "contributions" ? undefined : sort,
      offset: offset || undefined,
      ...changes,
    };
    for (const [key, value] of Object.entries(base)) {
      if (value !== undefined && value !== "") next.set(key, String(value));
    }
    const search = next.toString();
    return search ? `/search?${search}` : "/search";
  };

  return (
    <section className="shell py-[var(--space-lg)]">
      <p className="eyebrow mb-[var(--space-xs)]">
        {exact(manifest.counts.users)} developers · snapshot {manifest.generatedAt}
      </p>
      <h1 className="text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
        Search
      </h1>

      <div className="mt-[var(--space-md)] max-w-[42rem]">
        <SearchBox />
      </div>
      <p className="prose mt-[var(--space-xs)] text-caption text-muted">
        Matches login, name, company and location. Every developer in the snapshot is searchable,
        including the ones ranked below the visible leaderboard depth.
      </p>

      {results === null ? (
        <p className="prose mt-[var(--space-lg)] text-muted">
          Type at least two characters. You can also filter directly from the URL —{" "}
          <code className="mono">?country=japan</code>,{" "}
          <code className="mono">?company=google</code> or{" "}
          <code className="mono">?minFollowers=1000</code> — and combine them with{" "}
          <code className="mono">?sort=followers</code>.
        </p>
      ) : results.total === 0 ? (
        <div className="mt-[var(--space-lg)] border border-rule p-[var(--space-md)]">
          <p className="text-h2">No developer matches that.</p>
          <p className="prose mt-[var(--space-2xs)] text-muted">
            This snapshot covers {exact(manifest.counts.users)} accounts, not all of GitHub — an
            absence here does not mean the account does not exist. The full corpus and how it is
            selected are set out on{" "}
            <Link href="/methodology" className="underline underline-offset-4">
              /methodology
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <div className="mono mt-[var(--space-md)] flex flex-wrap items-center justify-between gap-[var(--space-xs)] text-caption uppercase tracking-[var(--tracking-caption)] text-muted">
            <span>
              {exact(results.total)} {results.total === 1 ? "match" : "matches"}
            </span>
            <span className="flex gap-[var(--space-xs)]">
              {(["contributions", "followers", "streak", "login"] as const).map((option) => (
                <Link
                  key={option}
                  href={linkWith({ sort: option === "contributions" ? undefined : option, offset: undefined })}
                  aria-current={sort === option ? "true" : undefined}
                  className="transition-colors hover:text-ink aria-[current=true]:text-ink"
                >
                  {option}
                </Link>
              ))}
            </span>
          </div>

          <ul className="mt-[var(--space-sm)]">
            {results.items.map((row) => (
              <li key={row.login}>
                <Link
                  href={row.hasProfile ? `/u/${row.login}` : `https://github.com/${row.login}`}
                  {...(row.hasProfile
                    ? {}
                    : { target: "_blank", rel: "noreferrer noopener" })}
                  data-cursor={row.hasProfile ? "PROFILE" : "GITHUB"}
                  className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-[var(--space-sm)] border-b border-rule py-[var(--space-xs)] transition-colors hover:bg-surface md:grid-cols-[2.5rem_1fr_7rem_6rem_6rem]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.avatarUrl}
                    alt=""
                    width={36}
                    height={36}
                    loading="lazy"
                    className="size-9 object-cover"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body">{row.name ?? row.login}</span>
                    <span className="mono truncate text-caption text-muted">
                      @{row.login}
                      {row.company ? ` · ${row.company}` : ""}
                      {row.location ? ` · ${row.location}` : ""}
                    </span>
                  </span>
                  <span className="mono hidden text-caption text-muted md:block">
                    {abbreviate(row.followers)}
                    <span className="sr-only"> followers</span>
                  </span>
                  <span className="mono hidden text-caption text-muted md:block">
                    {row.streak.longest}d
                    {row.calendarMeasured ? null : (
                      <span title="Estimated from the contribution total, not a fetched calendar">
                        {" "}
                        ≈
                      </span>
                    )}
                    <span className="sr-only">
                      {" "}
                      longest streak{row.calendarMeasured ? "" : ", estimated"}
                    </span>
                  </span>
                  <span className="mono text-right tabular-nums">
                    {abbreviate(row.total)}
                    <span className="sr-only"> contributions</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <nav
            aria-label="Search result pages"
            className="mono mt-[var(--space-md)] flex justify-between text-caption uppercase tracking-[var(--tracking-caption)]"
          >
            {offset > 0 ? (
              <Link href={linkWith({ offset: Math.max(0, offset - PAGE) || undefined })}>
                ← Previous
              </Link>
            ) : (
              <span className="text-muted">← Previous</span>
            )}
            {results.hasMore ? (
              <Link href={linkWith({ offset: offset + PAGE })}>Next →</Link>
            ) : (
              <span className="text-muted">Next →</span>
            )}
          </nav>
        </>
      )}
    </section>
  );
}
