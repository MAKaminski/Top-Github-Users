import type { Metadata } from "next";
import { LeaderboardHeader, LeaderboardRow } from "@/components/leaderboard-rows";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { ScrollProgressRule } from "@/components/patterns/scroll-progress-rule";
import { HeatmapLegend } from "@/components/charts/heatmap";
import { getManifest, getWorldwide } from "@/lib/data";
import { exact } from "@/lib/format";

export const metadata: Metadata = {
  alternates: { canonical: "/leaderboard" },
  title: "Worldwide leaderboard",
  description: "The most active developers on GitHub worldwide, ranked by contributions.",
};

export default async function LeaderboardPage() {
  const [manifest, worldwide] = await Promise.all([getManifest(), getWorldwide()]);

  return (
    <>
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
            {exact(worldwide.entries.length)} developers, ranked by public plus private
            contributions over the trailing twelve months. Ties break on followers, then login, so
            the order is stable between snapshots.
          </p>
        </div>

        <div className="mt-[var(--space-md)] flex justify-end">
          <HeatmapLegend />
        </div>

        <div className="mt-[var(--space-sm)]">
          <LeaderboardHeader />
          <ViewportStaggerReveal>
            {worldwide.entries.map((entry) => (
              <LeaderboardRow key={entry.login} entry={entry} />
            ))}
          </ViewportStaggerReveal>
        </div>
      </section>
    </>
  );
}
