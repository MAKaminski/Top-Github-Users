import type { LeaderboardEntry, Manifest, Place, RankedUser } from "@/lib/types";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";

/**
 * Schema.org graphs, assembled from the same snapshot the page renders.
 *
 * This is the part of "AI SEO" that is not a euphemism. An assistant answering
 * "who are the most active developers on GitHub" is far more likely to quote a
 * source that hands it a typed `ItemList` of names and numbers than one that
 * makes it infer a table from styled divs. The same markup drives Google's rich
 * results, so there is no tradeoff to weigh.
 *
 * Two rules hold everywhere in this file:
 *
 * 1. **Never assert what the page does not show.** Every value here is read from
 *    the snapshot. No invented ratings, no `aggregateRating`, no fake dates.
 * 2. **Match the visible page.** Structured data that disagrees with the
 *    rendered content is a manual-action risk with Google and, worse, a way to
 *    get misquoted by an assistant that trusted it.
 */

type Json = Record<string, unknown>;

/** The site itself, plus the search action that lets a result carry its own
 *  search box. `/search?q=` is a real server-rendered route, so this describes
 *  something that genuinely works rather than an aspiration. */
export function websiteSchema(): Json {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": absoluteUrl("/#website"),
    url: SITE_URL,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: absoluteUrl("/search?q={search_term_string}"),
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * The corpus as a citable dataset.
 *
 * This is the single most valuable object on the site for machine readers: it
 * names the licence, the update cadence, the measurement window and — through
 * `distribution` — the two endpoints that serve the same numbers. An assistant
 * that reads this knows it can fetch the data directly instead of scraping.
 */
export function datasetSchema(manifest: Manifest): Json {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "@id": absoluteUrl("/#dataset"),
    name: `${SITE_NAME} GitHub contribution rankings`,
    description:
      `Rankings of ${manifest.counts.users.toLocaleString("en-US")} GitHub developers by public ` +
      "and private contributions over the trailing twelve months, grouped worldwide and by " +
      `${manifest.counts.countries} countries and ${manifest.counts.cities} cities. ` +
      `${manifest.sourceNote}`,
    url: SITE_URL,
    // No `license` field until the repository actually carries a LICENSE. An
    // earlier draft asserted MIT here, which was a licence this project has
    // never declared — and a fabricated licence in machine-readable metadata is
    // exactly the kind of claim the rest of the site exists to avoid. Add the
    // field back the moment a real one is chosen.
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
    dateModified: manifest.generatedAt,
    temporalCoverage: `${manifest.generatedAt}/P12M`,
    measurementTechnique:
      "GitHub GraphQL contributionsCollection over a trailing 365-day window, with candidate " +
      "discovery from the GH Archive public event stream",
    variableMeasured: [
      { "@type": "PropertyValue", name: "contributions", description: "Public plus private contributions over the trailing twelve months" },
      { "@type": "PropertyValue", name: "followers", description: "GitHub follower count at snapshot time" },
      { "@type": "PropertyValue", name: "streak", description: "Longest and current daily contribution streak; estimated below profile depth and labelled as such" },
    ],
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: absoluteUrl("/api/v1/leaderboard/worldwide"),
        name: "REST API",
      },
      {
        "@type": "DataDownload",
        encodingFormat: "application/json",
        contentUrl: absoluteUrl("/api/openapi.json"),
        name: "OpenAPI description",
      },
    ],
  };
}

/**
 * A leaderboard as an ordered list.
 *
 * Capped deliberately: a 250,000-item `ItemList` would be megabytes of JSON in
 * a `<script>` tag, slowing the page for every human to serve a machine that
 * stops reading long before the end. The head of the list is what gets quoted;
 * `/api/v1` is where the tail lives, and the Dataset object above points there.
 */
export function leaderboardSchema(options: {
  entries: LeaderboardEntry[];
  path: string;
  name: string;
  description: string;
  limit?: number;
}): Json {
  const limit = options.limit ?? 100;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": absoluteUrl(`${options.path}#leaderboard`),
    name: options.name,
    description: options.description,
    url: absoluteUrl(options.path),
    numberOfItems: options.entries.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: options.entries.slice(0, limit).map((entry) => ({
      "@type": "ListItem",
      position: entry.rank,
      item: {
        "@type": "Person",
        name: entry.name ?? entry.login,
        alternateName: entry.login,
        url: entry.hasProfile
          ? absoluteUrl(`/u/${entry.login}`)
          : `https://github.com/${entry.login}`,
        image: entry.avatarUrl,
        ...(entry.company ? { worksFor: { "@type": "Organization", name: entry.company } } : {}),
        ...(entry.location ? { homeLocation: { "@type": "Place", name: entry.location } } : {}),
      },
    })),
  };
}

/**
 * A developer's profile page.
 *
 * `interactionStatistic` is the honest home for a contribution count: it is a
 * measured interaction total, not a rating or a review score. Resisting the
 * temptation to emit `aggregateRating` here matters — it would win a star
 * snippet and would be a fabrication.
 */
export function personSchema(user: RankedUser, manifest: Manifest): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": absoluteUrl(`/u/${user.login}#profile`),
    url: absoluteUrl(`/u/${user.login}`),
    dateModified: manifest.generatedAt,
    mainEntity: {
      "@type": "Person",
      name: user.name ?? user.login,
      alternateName: user.login,
      identifier: user.login,
      url: `https://github.com/${user.login}`,
      image: user.avatarUrl,
      ...(user.bio ? { description: user.bio } : {}),
      ...(user.company ? { worksFor: { "@type": "Organization", name: user.company } } : {}),
      ...(user.location ? { homeLocation: { "@type": "Place", name: user.location } } : {}),
      sameAs: [`https://github.com/${user.login}`],
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/WriteAction",
          userInteractionCount: user.contributions.total,
          name: "Contributions in the trailing twelve months",
        },
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/FollowAction",
          userInteractionCount: user.followers,
          name: "GitHub followers",
        },
      ],
    },
  };
}

/** A place board. `about` carries the real geography so a model can tell
 *  "Georgia the country" from "Georgia the state" without guessing. */
export function placeSchema(place: Place, kind: "country" | "city", path: string): Json {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": absoluteUrl(`${path}#leaderboard`),
    name: `Most active GitHub developers in ${place.name}`,
    url: absoluteUrl(path),
    numberOfItems: place.userCount,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    about: {
      "@type": kind === "country" ? "Country" : "City",
      name: place.name,
      ...(place.iso2 ? { identifier: place.iso2 } : {}),
    },
  };
}

/** Breadcrumbs. Cheap, and it is what turns a bare URL in a search result into
 *  a readable path — which matters most on the deep pages nobody links to. */
export function breadcrumbSchema(trail: { name: string; path: string }[]): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: absoluteUrl(step.path),
    })),
  };
}
