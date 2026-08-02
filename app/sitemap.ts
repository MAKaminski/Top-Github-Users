import type { MetadataRoute } from "next";

import { getCities, getCountries, getManifest, getProfileLogins } from "@/lib/data";
import { absoluteUrl } from "@/lib/site";

/**
 * Sitemap, sharded.
 *
 * The protocol caps a single sitemap file at 50,000 URLs, and this site has one
 * profile page per developer at profile depth — tens of thousands today and
 * more as the corpus fills. `generateSitemaps` makes Next emit a sitemap index
 * plus `/sitemap/N.xml` children, so the count can grow without the file
 * silently truncating.
 *
 * Shard 0 carries the static routes and every place; the rest carry profiles.
 * Keeping the pages that matter most in the first shard means a crawler that
 * fetches one file gets the useful half of the site.
 */
const URLS_PER_SITEMAP = 25_000;

async function profileLogins(): Promise<string[]> {
  return (await getProfileLogins()).slice().sort((a, b) => a.localeCompare(b));
}

export async function generateSitemaps(): Promise<{ id: number }[]> {
  const profiles = await profileLogins();
  const profileShards = Math.max(1, Math.ceil(profiles.length / URLS_PER_SITEMAP));
  return Array.from({ length: profileShards + 1 }, (_, id) => ({ id }));
}

/**
 * Next 16 hands `id` in as a promise, the same way it did to page params. It is
 * typed `number` and arrives as a thenable, so awaiting it is both correct and
 * harmless — and skipping the await is silent: `{} === 0` is false, every
 * branch misses, and both shards render as a valid, empty `<urlset>`. That is
 * exactly what happened here, and nothing failed loudly to say so.
 */
export default async function sitemap({
  id,
}: {
  id: number | Promise<number>;
}): Promise<MetadataRoute.Sitemap> {
  const shard = Number(await id);
  const manifest = await getManifest();
  // Every page is rebuilt from one snapshot, so one date is the honest answer
  // for all of them. A per-page `lastModified` we did not measure would just be
  // the build clock wearing a hat.
  const lastModified = new Date(`${manifest.generatedAt}T00:00:00Z`);

  if (shard === 0) {
    const [countries, cities] = await Promise.all([getCountries(), getCities()]);

    return [
      { url: absoluteUrl("/"), lastModified, changeFrequency: "daily", priority: 1 },
      { url: absoluteUrl("/leaderboard"), lastModified, changeFrequency: "daily", priority: 0.9 },
      {
        url: absoluteUrl("/leaderboard?sort=followers"),
        lastModified,
        changeFrequency: "daily",
        priority: 0.6,
      },
      {
        url: absoluteUrl("/leaderboard?sort=streak"),
        lastModified,
        changeFrequency: "daily",
        priority: 0.6,
      },
      { url: absoluteUrl("/podium"), lastModified, changeFrequency: "daily", priority: 0.7 },
      { url: absoluteUrl("/countries"), lastModified, changeFrequency: "daily", priority: 0.8 },
      { url: absoluteUrl("/cities"), lastModified, changeFrequency: "daily", priority: 0.7 },
      { url: absoluteUrl("/orgs"), lastModified, changeFrequency: "weekly", priority: 0.6 },
      { url: absoluteUrl("/repos"), lastModified, changeFrequency: "weekly", priority: 0.6 },
      { url: absoluteUrl("/search"), lastModified, changeFrequency: "monthly", priority: 0.5 },
      // Rarely changes and is not a ranking, but it is the page that documents
      // what the numbers mean — the one most worth a model reading.
      { url: absoluteUrl("/methodology"), lastModified, changeFrequency: "monthly", priority: 0.8 },
      ...countries.map((place) => ({
        url: absoluteUrl(`/countries/${place.id}`),
        lastModified,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...cities.map((place) => ({
        url: absoluteUrl(`/cities/${place.id}`),
        lastModified,
        changeFrequency: "daily" as const,
        priority: 0.5,
      })),
    ];
  }

  const profiles = await profileLogins();
  const start = (shard - 1) * URLS_PER_SITEMAP;

  return profiles.slice(start, start + URLS_PER_SITEMAP).map((login) => ({
    url: absoluteUrl(`/u/${login}`),
    lastModified,
    changeFrequency: "daily" as const,
    priority: 0.5,
  }));
}
