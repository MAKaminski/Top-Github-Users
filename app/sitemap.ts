import type { MetadataRoute } from "next";
import { getCities, getCountries, getManifest, getProfileLogins } from "@/lib/data";
import { SITE_URL } from "@/lib/site";

/**
 * sitemap.xml.
 *
 * Enumerated from the snapshot rather than hand-listed, so a new country or a
 * newly crawled profile appears without anyone remembering to add it.
 *
 * `lastModified` is the snapshot date for every entry, which is the honest
 * answer: these pages are regenerated wholesale by each crawl, and claiming a
 * per-page modification time the project does not track would be invented
 * precision. Profiles use the same date for the same reason.
 *
 * Priorities are relative, not absolute — the leaderboards and the connector
 * page are what the site is for; individual profiles are the long tail.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [manifest, countries, cities, logins] = await Promise.all([
    getManifest(),
    getCountries(),
    getCities(),
    getProfileLogins(),
  ]);

  const lastModified = new Date(manifest.generatedAt);

  const entry = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "weekly",
  ) => ({ url: `${SITE_URL}${path}`, lastModified, changeFrequency, priority });

  return [
    entry("/", 1),
    entry("/leaderboard", 0.9),
    entry("/connect", 0.9),
    entry("/podium", 0.7),
    entry("/countries", 0.8),
    entry("/cities", 0.8),
    entry("/orgs", 0.7),
    entry("/repos", 0.5),
    // The methodology page changes only when the method does, and it is the
    // page this project would most like a reader to find.
    entry("/methodology", 0.8, "monthly"),

    ...countries.map((place) => entry(`/countries/${place.id}`, 0.6)),
    ...cities.map((place) => entry(`/cities/${place.id}`, 0.5)),
    ...logins.map((login) => entry(`/u/${login}`, 0.4)),
  ];
}
