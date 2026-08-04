import type { Metadata } from "next";
import { DragInertiaGallery } from "@/components/patterns/drag-inertia-gallery";
import { ViewportStaggerReveal } from "@/components/patterns/viewport-stagger-reveal";
import { getOrganizations } from "@/lib/data";
import { abbreviate, rankLabel } from "@/lib/format";

export const metadata: Metadata = {
  alternates: { canonical: "/orgs" },
  title: "Organizations",
  description:
    "Organizations ranked by the aggregate contributions of the developers who list them.",
};

export default async function OrgsPage() {
  const organizations = await getOrganizations();
  const podium = organizations.slice(0, 12);

  return (
    <section className="shell py-[var(--space-lg)]">
      <p className="eyebrow mb-[var(--space-xs)]">{organizations.length} organizations</p>
      <h1 className="max-w-[22ch] text-display leading-[var(--leading-display)] tracking-[var(--tracking-display)]">
        Who the busiest people work for
      </h1>
      <p className="prose mt-[var(--space-sm)] text-muted">
        Not a follower count. These are organizations ranked by the{" "}
        <em>combined contributions of the tracked developers who name them</em> in their profile —
        so an employer with three prolific engineers outranks one with three hundred quiet ones.
        Company is a free-text field, so this is what people say, not what a payroll system knows.
      </p>

      <div className="mt-[var(--space-lg)]">
        <p className="eyebrow mb-[var(--space-xs)]">Drag to explore</p>
        <DragInertiaGallery label="Leading organizations">
          {podium.map((org) => (
            <article
              key={org.login}
              className="flex h-full w-[16rem] flex-col justify-between gap-[var(--space-sm)] border border-rule p-[var(--space-sm)]"
            >
              <div className="flex items-start justify-between">
                <span className="mono text-h2 text-accent">
                  {rankLabel(org.rank, 2)}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={org.avatarUrl}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  className="size-11 object-cover"
                  draggable={false}
                />
              </div>
              <div>
                <p className="text-h2 leading-tight">{org.login}</p>
                <p className="mono text-caption text-muted">{org.name}</p>
              </div>
              <p className="mono tabular-nums">
                {abbreviate(org.publicRepos ?? 0)}
                <span className="ml-1 text-caption text-muted">
                  contributions
                </span>
              </p>
            </article>
          ))}
        </DragInertiaGallery>
      </div>

      <div className="mt-[var(--space-lg)]">
        <div className="mono grid grid-cols-[3.5ch_1fr_auto_auto] gap-[var(--space-sm)] border-b border-ink pb-[var(--space-2xs)] text-caption uppercase tracking-[var(--tracking-caption)] text-muted">
          <span>#</span>
          <span>Organization</span>
          <span className="hidden sm:block">Followers</span>
          <span className="text-right">Contributions</span>
        </div>
        <ViewportStaggerReveal>
          {organizations.map((org) => (
            <div
              key={org.login}
              className="grid grid-cols-[3.5ch_1fr_auto_auto] items-center gap-[var(--space-sm)] border-b border-rule py-[var(--space-xs)]"
            >
              <span className="mono text-caption text-muted">
                {rankLabel(org.rank)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{org.login}</span>
                <span className="mono truncate text-caption text-muted">
                  {org.name}
                </span>
              </span>
              <span className="mono hidden text-caption text-muted sm:block">
                {abbreviate(org.followers)}
              </span>
              <span className="mono text-right tabular-nums">
                {abbreviate(org.publicRepos ?? 0)}
              </span>
            </div>
          ))}
        </ViewportStaggerReveal>
      </div>
    </section>
  );
}
