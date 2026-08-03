import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { getRepositories } from "@/lib/data";
import { abbreviate, rankLabel } from "@/lib/format";

export const metadata: Metadata = {
  title: "Repositories",
  description: "The most starred repositories tracked by Commitgraph.",
  alternates: { canonical: "/repos" },
  openGraph: { title: "Top repositories · Commitgraph", url: "/repos" },
};

export default async function ReposPage() {
  const repositories = await getRepositories();

  if (repositories.length === 0) {
    return (
      <section className="shell py-[var(--space-lg)]">
        <p className="eyebrow mb-[var(--space-xs)]">Not yet crawled</p>
        <h1 className="max-w-[20ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
          Repositories
        </h1>
        <div className="mt-[var(--space-md)] max-w-[62ch] border border-dashed border-rule p-[var(--space-md)]">
          <p className="text-muted">
            This board is produced by the scheduled crawler, which has not run yet. It is empty
            rather than filled with placeholder rows, because a leaderboard that invents its own
            data is worse than one that admits it has none.
          </p>
          <p className="mt-[var(--space-sm)] text-muted">
            <Link href="/methodology" className="underline underline-offset-4">
              How the crawler works
            </Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="shell py-[var(--space-lg)]">
      <p className="eyebrow mb-[var(--space-xs)]">{repositories.length} repositories</p>
      <h1 className="max-w-[20ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
        Repositories
      </h1>

      <div className="mt-[var(--space-lg)]">
        <ViewportStaggerReveal>
          {repositories.map((repo) => (
            <a
              key={repo.nameWithOwner}
              href={`https://github.com/${repo.nameWithOwner}`}
              data-cursor="GITHUB"
              className="grid grid-cols-[3.5ch_1fr_auto] items-center gap-[var(--space-sm)] border-b border-rule py-[var(--space-xs)] transition-colors hover:bg-surface"
            >
              <span className="mono text-caption text-muted">
                {rankLabel(repo.rank)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="mono truncate">{repo.nameWithOwner}</span>
                {repo.description ? (
                  <span className="truncate text-caption text-muted">
                    {repo.description}
                  </span>
                ) : null}
              </span>
              <span className="mono text-right tabular-nums">{abbreviate(repo.stars)}</span>
            </a>
          ))}
        </ViewportStaggerReveal>
      </div>
    </section>
  );
}
