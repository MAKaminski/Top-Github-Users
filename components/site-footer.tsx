import Link from "next/link";
import { ScrollVelocityMarquee } from "./patterns/scroll-velocity-marquee";
import { NAV_LINKS } from "@/components/nav-links";
import { PRODUCT_HUNT } from "@/lib/site";
import { exact } from "@/lib/format";
import type { LeaderboardEntry, Manifest } from "@/lib/types";

export function SiteFooter({
  manifest,
  topLogins,
}: {
  manifest: Manifest;
  topLogins: LeaderboardEntry[];
}) {
  return (
    <footer className="relative mt-[var(--space-xl)] border-t border-rule">
      {/* The marquee is the end-of-page gesture: still moving, but finished. */}
      <ScrollVelocityMarquee
        items={topLogins.map((entry) => `@${entry.login}`)}
        className="border-b border-rule text-muted"
      />

      <div className="shell grid gap-[var(--space-lg)] py-[var(--space-lg)] md:grid-cols-[2fr_1fr_1fr]">
        <div className="flex flex-col items-start gap-[var(--space-xs)]">
          <p className="mono text-caption uppercase tracking-[var(--tracking-caption)]">
            Commitgraph
          </p>
          <p className="prose text-caption text-muted">
            {exact(manifest.counts.users)} developers across {manifest.counts.countries} countries
            and {manifest.counts.cities} cities. Snapshot {manifest.generatedAt}.
          </p>

          {/*
            Product Hunt's own badge, rendered only once PRODUCT_HUNT is set.

            A plain <img> rather than next/image: the badge is served by Product
            Hunt and carries a live upvote count, so routing it through the
            image optimiser would cache a number that is meant to move, and
            would need their host added to remotePatterns for one 250px asset.

            `theme=neutral` reads against both the dark and light states this
            site switches between; the light-only badge vanishes into the
            footer on the dark theme.
          */}
          {PRODUCT_HUNT ? (
            <a
              href={`https://www.producthunt.com/posts/${PRODUCT_HUNT.slug}?embed=true&utm_source=badge-featured&utm_medium=badge`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-[var(--space-2xs)] inline-block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=${PRODUCT_HUNT.postId}&theme=neutral`}
                alt="Commitgraph on Product Hunt"
                width={250}
                height={54}
                loading="lazy"
                decoding="async"
              />
            </a>
          ) : null}
        </div>

        <nav aria-label="Footer">
          <ul className="flex flex-col gap-[var(--space-2xs)]">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-caption text-muted transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-col gap-[var(--space-2xs)] text-caption text-muted">
          <a
            href="https://github.com/MAKaminski/Top-Github-Users"
            className="transition-colors hover:text-ink"
          >
            Source on GitHub
          </a>
          <Link href="/methodology" className="transition-colors hover:text-ink">
            How these numbers are made
          </Link>
          <span>
            Motion patterns from{" "}
            <a
              href="https://rejouice-patterns.vercel.app"
              className="underline underline-offset-2 transition-colors hover:text-ink"
            >
              rejouice-patterns
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
