/**
 * Bootstrap seed builder.
 *
 * The scheduled crawler in scripts/crawler is this project's real data source,
 * but it cannot run everywhere (and has not run yet on a fresh clone). This
 * one-off script maps a public, actively-maintained dataset into our schema so
 * the site renders real rankings from the first `pnpm dev`.
 *
 * Source: github.com/gayanvoice/top-github-users (public). Its `cache/{slug}.json`
 * files carry login, name, avatar, location, company, followers and public /
 * private contribution counts per country. Attribution is shown on /methodology.
 *
 * Everything written here is marked `source: "bootstrap"` in the manifest and is
 * replaced wholesale by the first successful crawler run.
 *
 *   pnpm seed
 */

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { COUNTRIES, type CountryDef } from "./lib/countries.ts";
import { parseCity } from "./lib/city.ts";
import { writeJson, DATA_DIR } from "./lib/io.ts";
import type {
  LeaderboardEntry,
  Manifest,
  Organization,
  Place,
  RankedUser,
} from "../lib/types.ts";

const SOURCE_BASE = "https://raw.githubusercontent.com/gayanvoice/top-github-users/main/cache";

/** Tuning. The crawler raises these; the committed seed stays a few megabytes. */
const USERS_PER_COUNTRY = 75;
const USERS_PER_CITY = 60;
const WORLDWIDE_SIZE = 500;
const MIN_USERS_FOR_CITY = 8;
const CONCURRENCY = 6;

/** Profile pages are generated for the worldwide list plus each place's leaders. */
const PROFILE_COUNTRY_DEPTH = 25;
const PROFILE_CITY_DEPTH = 10;

/**
 * Automation threshold.
 *
 * 300,000 contributions in a twelve-month window is over 820 every single day
 * without a break. The most prolific genuine maintainers on GitHub — people who
 * run automated packaging pipelines under their own name — land in the low
 * hundreds of thousands, so this keeps them and removes only the accounts whose
 * numbers cannot be produced by a person. Excluded accounts are listed openly
 * on /methodology instead of being silently dropped, which is the part every
 * other leaderboard gets wrong.
 */
const AUTOMATION_THRESHOLD = 300_000;

interface SourceUser {
  login: string;
  name?: string;
  avatarUrl?: string;
  location?: string;
  company?: string;
  followers?: number;
  publicContributions?: number;
  privateContributions?: number;
}

/** The upstream encodes missing values as the literal string "undefined value". */
function clean(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  // The upstream encodes absence as the literal "undefined value", and profiles
  // themselves carry placeholder junk. These leak straight into the API and the
  // page as a company called "NULL" unless they are dropped here.
  if (!trimmed) return null;
  if (/^(undefined value|undefined|null|nil|none|n\/?a|-+|\.+|,+)$/i.test(trimmed)) return null;
  return trimmed;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function fetchCountry(country: CountryDef): Promise<SourceUser[] | null> {
  const url = `${SOURCE_BASE}/${country.slug}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as SourceUser[];
      return Array.isArray(body) ? body : null;
    } catch (error) {
      if (attempt === 2) {
        console.warn(`  ! ${country.slug}: ${(error as Error).message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  return null;
}

function toUser(raw: SourceUser, country: CountryDef): RankedUser | null {
  const login = clean(raw.login);
  if (!login) return null;

  const publicContributions = num(raw.publicContributions);
  const privateContributions = num(raw.privateContributions);
  const total = publicContributions + privateContributions;
  if (total <= 0) return null;

  const location = clean(raw.location);
  const city = parseCity(location, country);

  return {
    login,
    name: clean(raw.name),
    // The upstream pins avatars to s=72; ask for a size that survives retina.
    avatarUrl: (clean(raw.avatarUrl) ?? "").replace(/([?&])s=\d+/, "$1s=160"),
    location,
    company: clean(raw.company),
    bio: null,
    followers: num(raw.followers),
    publicRepos: null,
    contributions: {
      total,
      public: publicContributions,
      private: privateContributions,
      commits: null,
      pullRequests: null,
      issues: null,
      reviews: null,
    },
    // Not stored: derived deterministically at render time from login + total.
    calendar: null,
    calendarSource: "estimated",
    languages: [],
    languageSource: "unavailable",
    streak: null,
    rank: { worldwide: null, country: null, city: null },
    countryId: country.slug,
    cityId: city?.id ?? null,
    flagged: total > AUTOMATION_THRESHOLD,
  };
}

/**
 * Deterministic ordering: contributions desc, then followers desc, then login
 * ascending. Ties broken by login means equal-ranked users never swap places
 * between runs, which is what keeps the committed diff small.
 */
function byRank(a: RankedUser, b: RankedUser): number {
  return (
    b.contributions.total - a.contributions.total ||
    b.followers - a.followers ||
    a.login.localeCompare(b.login)
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Two-character shard so no directory holds thousands of files. */
export function shardOf(login: string): string {
  const key = login.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return key.slice(0, 2).padEnd(2, "_");
}

function normaliseCompany(company: string | null): { key: string; display: string } | null {
  if (!company) return null;
  const display = company.replace(/^@/, "").replace(/[.,]$/, "").trim();
  if (display.length < 2 || display.length > 40) return null;
  if (
    /^(freelance|self|independent|none|n\/?a|home|remote|student|unemployed|null|undefined|nil|no|-+|\.+)$/i.test(
      display,
    ) ||
    /^(freelance|self-?employed|independent|looking for)/i.test(display)
  ) {
    return null;
  }
  return { key: display.toLowerCase(), display };
}

function placeFrom(
  base: Omit<Place, "userCount" | "totalContributions" | "totalFollowers" | "top">,
  users: RankedUser[],
): Place {
  return {
    ...base,
    userCount: users.length,
    totalContributions: users.reduce((sum, u) => sum + u.contributions.total, 0),
    totalFollowers: users.reduce((sum, u) => sum + u.followers, 0),
    top: users.slice(0, 3).map((u) => ({
      login: u.login,
      avatarUrl: u.avatarUrl,
      total: u.contributions.total,
    })),
  };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log(`Seeding from ${COUNTRIES.length} candidate countries…`);

  const fetched = await mapWithConcurrency(COUNTRIES, CONCURRENCY, async (country) => {
    const raw = await fetchCountry(country);
    if (!raw) return { country, users: [] as RankedUser[], flagged: [] as RankedUser[] };

    const all = raw
      .map((entry) => toUser(entry, country))
      .filter((user): user is RankedUser => user !== null)
      .sort(byRank);

    const flagged = all.filter((u) => u.flagged);
    const users = all.filter((u) => !u.flagged).slice(0, USERS_PER_COUNTRY);

    console.log(
      `  ${country.slug.padEnd(24)} ${String(users.length).padStart(4)} users` +
        (flagged.length ? `  (${flagged.length} flagged)` : ""),
    );
    return { country, users, flagged };
  });

  const present = fetched.filter((f) => f.users.length > 0);
  if (present.length === 0) {
    throw new Error("No country data could be fetched — refusing to write an empty seed.");
  }

  const generatedAt = new Date().toISOString().slice(0, 10);

  // ---- Rank everything before writing anything ----------------------------
  const allUsers: RankedUser[] = [];
  for (const { users } of present) {
    users.forEach((user, index) => {
      user.rank.country = index + 1;
    });
    allUsers.push(...users);
  }

  const worldwide = [...allUsers].sort(byRank);
  worldwide.forEach((user, index) => {
    user.rank.worldwide = index + 1;
  });

  const cityBuckets = new Map<string, { country: CountryDef; users: RankedUser[] }>();
  for (const { country, users } of present) {
    for (const user of users) {
      if (!user.cityId) continue;
      const bucket = cityBuckets.get(user.cityId);
      if (bucket) bucket.users.push(user);
      else cityBuckets.set(user.cityId, { country, users: [user] });
    }
  }

  const cities: { id: string; name: string; country: CountryDef; users: RankedUser[] }[] = [];
  for (const [id, bucket] of cityBuckets) {
    if (bucket.users.length < MIN_USERS_FOR_CITY) continue;
    const users = bucket.users.sort(byRank).slice(0, USERS_PER_CITY);
    users.forEach((user, index) => {
      user.rank.city = index + 1;
    });
    const name = parseCity(users[0].location, bucket.country)?.name ?? id;
    cities.push({ id, name, country: bucket.country, users });
  }

  // ---- Decide which logins get a page, so rows can link honestly ----------
  const profileLogins = new Set<string>();
  for (const user of worldwide.slice(0, WORLDWIDE_SIZE)) profileLogins.add(user.login);
  for (const user of allUsers) {
    if ((user.rank.country ?? Infinity) <= PROFILE_COUNTRY_DEPTH) profileLogins.add(user.login);
  }
  for (const city of cities) {
    for (const user of city.users.slice(0, PROFILE_CITY_DEPTH)) profileLogins.add(user.login);
  }

  const entryOf = (user: RankedUser, rank: number): LeaderboardEntry => ({
    rank,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    location: user.location,
    company: user.company,
    followers: user.followers,
    total: user.contributions.total,
    public: user.contributions.public,
    private: user.contributions.private,
    countryId: user.countryId,
    cityId: user.cityId,
    previousRank: null,
    hasProfile: profileLogins.has(user.login),
  });

  // ---- Write ---------------------------------------------------------------
  await rm(DATA_DIR, { recursive: true, force: true });
  await mkdir(DATA_DIR, { recursive: true });

  await writeJson(path.join(DATA_DIR, "leaderboard", "worldwide.json"), {
    scope: "worldwide",
    name: "Worldwide",
    generatedAt,
    entries: worldwide.slice(0, WORLDWIDE_SIZE).map((u, i) => entryOf(u, i + 1)),
  });

  const countryPlaces: Place[] = [];
  for (const { country, users } of present) {
    await writeJson(path.join(DATA_DIR, "country", `${country.slug}.json`), {
      scope: `country:${country.slug}`,
      name: country.name,
      generatedAt,
      entries: users.map((u, i) => entryOf(u, i + 1)),
    });
    countryPlaces.push(
      placeFrom(
        {
          id: country.slug,
          name: country.name,
          iso2: country.iso2,
          region: country.region,
          countryId: null,
        },
        users,
      ),
    );
  }

  const cityPlaces: Place[] = [];
  for (const city of cities) {
    await writeJson(path.join(DATA_DIR, "city", `${city.id}.json`), {
      scope: `city:${city.id}`,
      name: city.name,
      generatedAt,
      entries: city.users.map((u, i) => entryOf(u, i + 1)),
    });
    cityPlaces.push(
      placeFrom(
        {
          id: city.id,
          name: city.name,
          iso2: city.country.iso2,
          region: city.country.region,
          countryId: city.country.slug,
        },
        city.users,
      ),
    );
  }

  const byLogin = new Map(allUsers.map((u) => [u.login, u]));
  for (const login of profileLogins) {
    const user = byLogin.get(login);
    if (!user) continue;
    await writeJson(path.join(DATA_DIR, "user", shardOf(login), `${login}.json`), user);
  }
  await writeJson(
    path.join(DATA_DIR, "user", "index.json"),
    [...profileLogins].sort((a, b) => a.localeCompare(b)),
  );

  // ---- Organizations -------------------------------------------------------
  // No org dataset is available upstream, but the `company` field is real. This
  // ranks organisations by the aggregate contributions of the developers who
  // list them — a different and, for this site, more interesting metric than
  // follower count. Documented on /methodology.
  const orgTotals = new Map<
    string,
    { login: string; total: number; followers: number; members: number; avatarUrl: string }
  >();
  for (const user of allUsers) {
    const company = normaliseCompany(user.company);
    if (!company) continue;
    const existing = orgTotals.get(company.key);
    if (existing) {
      existing.total += user.contributions.total;
      existing.followers += user.followers;
      existing.members += 1;
    } else {
      orgTotals.set(company.key, {
        login: company.display,
        total: user.contributions.total,
        followers: user.followers,
        members: 1,
        avatarUrl: user.avatarUrl,
      });
    }
  }

  const organizations: Organization[] = [...orgTotals.values()]
    .filter((org) => org.members >= 3)
    .sort((a, b) => b.total - a.total || a.login.localeCompare(b.login))
    .slice(0, 120)
    .map((org, index) => ({
      rank: index + 1,
      login: org.login,
      name: `${org.members} tracked developer${org.members === 1 ? "" : "s"}`,
      avatarUrl: org.avatarUrl,
      location: null,
      followers: org.followers,
      publicRepos: org.total,
    }));

  await writeJson(path.join(DATA_DIR, "org", "top.json"), organizations);

  // No repository data exists upstream; the crawler produces this file. The
  // route renders an explicit pending state while it is empty.
  await writeJson(path.join(DATA_DIR, "repo", "top.json"), []);

  // ---- Excluded accounts ---------------------------------------------------
  const flaggedAccounts = fetched
    .flatMap((f) => f.flagged)
    .sort((a, b) => b.contributions.total - a.contributions.total || a.login.localeCompare(b.login))
    .slice(0, 60)
    .map((u) => ({
      login: u.login,
      avatarUrl: u.avatarUrl,
      total: u.contributions.total,
      followers: u.followers,
      countryId: u.countryId,
    }));
  await writeJson(path.join(DATA_DIR, "flagged.json"), flaggedAccounts);

  // ---- History -------------------------------------------------------------
  // One snapshot means no movement to plot yet. The charts say so rather than
  // inventing a trend.
  await writeJson(path.join(DATA_DIR, "history", "worldwide.json"), {
    scope: "worldwide",
    dates: [generatedAt],
    series: worldwide.slice(0, 25).map((user) => ({
      login: user.login,
      ranks: [user.rank.worldwide],
      totals: [user.contributions.total],
    })),
  });

  // ---- Manifest ------------------------------------------------------------
  const manifest: Manifest = {
    generatedAt,
    source: "bootstrap",
    sourceNote:
      "Bootstrap snapshot mapped from the public gayanvoice/top-github-users dataset. " +
      "Replaced by this repository's own crawler on its first scheduled run.",
    counts: {
      users: allUsers.length,
      countries: countryPlaces.length,
      cities: cityPlaces.length,
      organizations: organizations.length,
      repositories: 0,
      flagged: fetched.reduce((sum, f) => sum + f.flagged.length, 0),
    },
    totals: {
      contributions: allUsers.reduce((sum, u) => sum + u.contributions.total, 0),
      publicContributions: allUsers.reduce((sum, u) => sum + u.contributions.public, 0),
      privateContributions: allUsers.reduce((sum, u) => sum + u.contributions.private, 0),
      followers: allUsers.reduce((sum, u) => sum + u.followers, 0),
    },
    snapshotDates: [generatedAt],
    countries: countryPlaces.sort(
      (a, b) => b.totalContributions - a.totalContributions || a.id.localeCompare(b.id),
    ),
    cities: cityPlaces.sort(
      (a, b) => b.totalContributions - a.totalContributions || a.id.localeCompare(b.id),
    ),
  };

  await writeJson(path.join(DATA_DIR, "manifest.json"), manifest);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nSeeded ${manifest.counts.users} users · ${manifest.counts.countries} countries · ` +
      `${manifest.counts.cities} cities · ${manifest.counts.organizations} orgs · ` +
      `${profileLogins.size} profiles · ${manifest.counts.flagged} flagged in ${seconds}s`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
