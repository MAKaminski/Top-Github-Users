/**
 * Crawler entry point.
 *
 *   pnpm crawl --tier=countries --shard=2/6 --limit=20
 *   pnpm crawl:fixtures            # offline, recorded responses
 *
 * The work is split into tiers because the places differ wildly in how fast
 * they change and how much budget they cost: the worldwide board and the large
 * countries are worth a daily pass, the long tail of countries a weekly one,
 * cities monthly. Each tier is independently shardable so a GitHub Actions
 * matrix can run several in parallel without any of them fighting over the
 * search rate limit.
 *
 * A run never crawls more than its budget allows. Where it stopped is recorded
 * in `data/_state.json`, and the next run resumes from there — see state.ts.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJson, DATA_DIR } from "../lib/io.ts";
import { COUNTRIES, COUNTRY_BY_SLUG, type CountryDef } from "../lib/countries.ts";
import type {
  Leaderboard,
  LeaderboardEntry,
  Manifest,
  Organization,
  Place,
  RankedUser,
  Repository,
} from "../../lib/types.ts";
import {
  contributionWindow,
  locationQuery,
  requireToken,
  GitHubClient,
  SEARCH_RESULT_CAP,
  type GitHubApi,
  type SearchUser,
} from "./github.ts";
import { loadFixtureClient } from "./fixtures.ts";
import {
  assignRanks,
  byEntryRank,
  shardOf,
  toLeaderboardEntry,
  toRankedUser,
  type RankField,
} from "./transform.ts";
import { previousRanks, readHistory, updateHistory } from "./history.ts";
import { isDue, orderByStaleness, readState, recordCompletion, writeState } from "./state.ts";

/** Board depths. Larger than the seeder's — the crawler pays for its own data
 *  and can afford to keep more of it. */
const WORLDWIDE_SIZE = 500;
const USERS_PER_COUNTRY = 150;
const USERS_PER_CITY = 75;
const MIN_USERS_FOR_CITY = 8;
const TOP_REPOSITORIES = 120;
const TOP_ORGANIZATIONS = 120;

/** Profile pages exist for the worldwide list plus each place's leaders. */
const PROFILE_COUNTRY_DEPTH = 25;
const PROFILE_CITY_DEPTH = 10;

/**
 * `scripts/lib/countries.ts` is written largest developer population first, so
 * the head of the list is the set worth a daily pass. Everything after it moves
 * slowly enough for a weekly sweep, which is what the `--shard` legs cover.
 */
const DAILY_COUNTRIES = 40;

/** Re-crawl intervals, in days, per tier. */
const FRESHNESS: Record<Tier, number> = {
  worldwide: 1,
  countries: 1,
  cities: 25,
  orgs: 6,
  repos: 6,
};

/**
 * Wall-clock budget. A job that runs long is a job that gets cancelled halfway
 * through writing, so the run stops itself between places and leaves the rest
 * for next time.
 */
const BUDGET_MS = 50 * 60_000;

const TIERS = ["worldwide", "countries", "cities", "orgs", "repos"] as const;
export type Tier = (typeof TIERS)[number];

interface Shard {
  index: number;
  total: number;
}

export interface Options {
  fixtures: boolean;
  tier: Tier;
  shard: Shard | null;
  limit: number | null;
}

export function parseOptions(argv: string[]): Options {
  const options: Options = { fixtures: false, tier: "worldwide", shard: null, limit: null };

  for (const arg of argv) {
    if (arg === "--fixtures") {
      options.fixtures = true;
      continue;
    }

    const [flag, raw] = splitFlag(arg);
    if (flag === "--tier") {
      if (!isTier(raw)) throw new Error(`--tier must be one of ${TIERS.join(", ")}`);
      options.tier = raw;
    } else if (flag === "--shard") {
      options.shard = parseShard(raw);
    } else if (flag === "--limit") {
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
      options.limit = limit;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function splitFlag(arg: string): [string, string] {
  const at = arg.indexOf("=");
  if (at === -1) return [arg, ""];
  return [arg.slice(0, at), arg.slice(at + 1)];
}

function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

function parseShard(raw: string): Shard {
  const [index, total] = raw.split("/").map(Number);
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
    throw new Error("--shard must look like 2/6, with a 1-based index");
  }
  return { index, total };
}

/**
 * Contiguous alphabetical slices rather than a modulo stripe: a shard then
 * covers a readable range of the list, which is what makes a failed matrix leg
 * obvious from its name alone.
 */
export function selectShard<T>(items: T[], shard: Shard | null): T[] {
  if (!shard) return items;
  const size = Math.ceil(items.length / shard.total);
  return items.slice((shard.index - 1) * size, shard.index * size);
}

// ---- Disk helpers ---------------------------------------------------------

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readBoards(dataDir: string, kind: "country" | "city"): Promise<Leaderboard[]> {
  let names: string[];
  try {
    names = await readdir(path.join(dataDir, kind));
  } catch {
    return [];
  }

  const boards: Leaderboard[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    const board = await readJsonFile<Leaderboard>(path.join(dataDir, kind, name));
    if (board?.entries) boards.push(board);
  }
  return boards;
}

// ---- Run context ----------------------------------------------------------

interface Context {
  api: GitHubApi;
  dataDir: string;
  date: string;
  deadline: number;
  limit: number | null;
  /** Every login that has a profile page, so rows can link honestly. */
  profiles: Set<string>;
  processed: number;
}

function outOfBudget(context: Context): boolean {
  if (context.limit !== null && context.processed >= context.limit) return true;
  return Date.now() > context.deadline;
}

async function writeProfiles(context: Context, users: RankedUser[]): Promise<void> {
  for (const user of users) {
    await writeJson(
      path.join(context.dataDir, "user", shardOf(user.login), `${user.login}.json`),
      user,
    );
    context.profiles.add(user.login);
  }
}

async function writeProfileIndex(context: Context): Promise<void> {
  await writeJson(
    path.join(context.dataDir, "user", "index.json"),
    [...context.profiles].sort((a, b) => a.localeCompare(b)),
  );
}

// ---- Crawling -------------------------------------------------------------

interface PlaceTarget {
  /** State key and, for countries and cities, the file name of the board. */
  key: string;
  name: string;
  query: string;
  country: CountryDef | null;
  /** Cities only: keep just the users whose parsed city is actually this one. */
  cityId?: string;
}

/**
 * Search for a place, enrich everyone it found, and return ranked users.
 * Flagged accounts are separated here rather than filtered later so the caller
 * can publish them on /methodology instead of dropping them on the floor.
 */
async function crawlPlace(
  context: Context,
  target: PlaceTarget,
  depth: number,
): Promise<{ users: RankedUser[]; flagged: RankedUser[]; skipped: string[] }> {
  // Search can only order by followers, and we rank by contributions, so the
  // candidate pool has to be several times the board depth for the ordering to
  // survive the change of metric. Three times is where the extra enrichment
  // stops buying new names in practice.
  const found: SearchUser[] = await context.api.searchUsers(target.query, {
    max: Math.min(SEARCH_RESULT_CAP, Math.max(depth * 3, 100)),
  });

  const avatars = new Map(found.map((user) => [user.login, user.avatarUrl]));
  const window = contributionWindow(new Date(`${context.date}T00:00:00Z`));
  const enriched = await context.api.enrichUsers(
    found.map((user) => user.login),
    window,
  );

  const mapped = enriched.users
    .map((user) =>
      toRankedUser(user, { country: target.country, avatarUrl: avatars.get(user.login) }),
    )
    .filter((user) => user.contributions.total > 0)
    .filter((user) => !target.cityId || user.cityId === target.cityId);

  return {
    users: mapped.filter((user) => !user.flagged),
    flagged: mapped.filter((user) => user.flagged),
    skipped: enriched.skipped,
  };
}

/** Writes a place's board, its profiles and its history in one go. */
async function publishPlace(
  context: Context,
  options: {
    scope: string;
    file: string;
    name: string;
    users: RankedUser[];
    rankField: RankField;
    depth: number;
    profileDepth: number;
    history?: string;
  },
): Promise<LeaderboardEntry[]> {
  const ranked = assignRanks(options.users, options.rankField).slice(0, options.depth);
  await writeProfiles(context, ranked.slice(0, options.profileDepth));

  const previous = options.history
    ? previousRanks(await readHistory(options.history, context.dataDir))
    : new Map<string, number>();

  const entries = ranked.map((user, index) =>
    toLeaderboardEntry(user, index + 1, {
      previousRank: previous.get(user.login) ?? null,
      hasProfile: context.profiles.has(user.login),
    }),
  );

  await writeJson(path.join(context.dataDir, options.file), {
    scope: options.scope,
    name: options.name,
    generatedAt: context.date,
    entries,
  } satisfies Leaderboard);

  if (options.history) {
    await updateHistory({
      file: options.history,
      scope: options.scope,
      date: context.date,
      points: entries.map((entry) => ({
        login: entry.login,
        rank: entry.rank,
        total: entry.total,
      })),
      dataDir: context.dataDir,
    });
  }

  return entries;
}

// ---- Tiers ----------------------------------------------------------------

/**
 * The worldwide board is the union of every place we hold, re-ranked. Search
 * offers no global "most contributions" ordering, so the tier also refreshes
 * the most-followed accounts — the one global ordering it does offer — to catch
 * developers whose location string names no country we track.
 */
async function runWorldwide(context: Context, flagged: RankedUser[]): Promise<void> {
  const global = await crawlPlace(
    context,
    {
      key: "worldwide",
      name: "Worldwide",
      query: "followers:>=1000 type:user",
      country: null,
    },
    WORLDWIDE_SIZE,
  );
  flagged.push(...global.flagged);
  context.processed += 1;

  const fresh = new Map<string, LeaderboardEntry>();
  for (const user of global.users) fresh.set(user.login, toLeaderboardEntry(user, 0));

  // Everything already on disk counts too — a developer ranked 900th in India
  // belongs on the worldwide board whether or not this run re-crawled them.
  for (const board of await readBoards(context.dataDir, "country")) {
    for (const entry of board.entries) {
      if (!fresh.has(entry.login)) fresh.set(entry.login, entry);
    }
  }

  const ordered = [...fresh.values()].sort(byEntryRank).slice(0, WORLDWIDE_SIZE);
  const onBoard = new Set(ordered.map((entry) => entry.login));
  await writeProfiles(
    context,
    global.users.filter((user) => onBoard.has(user.login)),
  );

  const previous = previousRanks(await readHistory("worldwide", context.dataDir));
  const entries = ordered.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    previousRank: previous.get(entry.login) ?? null,
    hasProfile: context.profiles.has(entry.login),
  }));

  await writeJson(path.join(context.dataDir, "leaderboard", "worldwide.json"), {
    scope: "worldwide",
    name: "Worldwide",
    generatedAt: context.date,
    entries,
  } satisfies Leaderboard);

  await updateHistory({
    file: "worldwide",
    scope: "worldwide",
    date: context.date,
    points: entries.map((entry) => ({ login: entry.login, rank: entry.rank, total: entry.total })),
    dataDir: context.dataDir,
  });
}

/**
 * Which countries a run is responsible for.
 *
 * Unsharded means the daily set: the head of the registry, in registry order,
 * so a truncated run still leaves the biggest boards fresh. Sharded means the
 * long tail, sorted alphabetically first so every matrix leg owns a range you
 * can name from the job title alone.
 */
export function countryTargets(shard: Shard | null): string[] {
  if (!shard) return COUNTRIES.slice(0, DAILY_COUNTRIES).map((country) => country.slug);
  return selectShard(
    COUNTRIES.slice(DAILY_COUNTRIES)
      .map((country) => country.slug)
      .sort((a, b) => a.localeCompare(b)),
    shard,
  );
}

async function runCountries(
  context: Context,
  shard: Shard | null,
  flagged: RankedUser[],
): Promise<string[]> {
  const state = await readState(context.dataDir);
  const slugs = countryTargets(shard);

  const touched: string[] = [];
  for (const slug of orderByStaleness(state, slugs)) {
    if (outOfBudget(context)) break;
    if (!isDue(state, slug, FRESHNESS.countries)) continue;

    const country = COUNTRY_BY_SLUG.get(slug);
    if (!country) continue;

    const result = await crawlPlace(
      context,
      { key: slug, name: country.name, query: locationQuery(country.name), country },
      USERS_PER_COUNTRY,
    );
    flagged.push(...result.flagged);
    context.processed += 1;

    if (result.users.length === 0) {
      // An empty result is far more likely to be a bad day for the API than a
      // country that lost every developer, so the existing board stays put.
      console.warn(`  ! ${slug}: no users returned, keeping the previous board`);
      continue;
    }

    await publishPlace(context, {
      scope: `country:${slug}`,
      file: path.join("country", `${slug}.json`),
      name: country.name,
      users: result.users,
      rankField: "country",
      depth: USERS_PER_COUNTRY,
      profileDepth: PROFILE_COUNTRY_DEPTH,
      history: `country-${slug}`,
    });

    recordCompletion(state, slug, context.date);
    touched.push(slug);
    console.log(`  ${slug.padEnd(24)} ${String(result.users.length).padStart(4)} users`);
  }

  await writeState(state, context.dataDir);
  return touched;
}

/**
 * City targets come from the manifest rather than a hand-kept list: the places
 * we already know hold developers are exactly the ones worth re-crawling, and
 * new ones arrive through the country tier's parsed locations.
 */
async function runCities(
  context: Context,
  shard: Shard | null,
  flagged: RankedUser[],
): Promise<string[]> {
  const manifest = await readJsonFile<Manifest>(path.join(context.dataDir, "manifest.json"));
  const known = manifest?.cities ?? [];
  const state = await readState(context.dataDir);

  const targets = selectShard(
    [...known].sort((a, b) => a.id.localeCompare(b.id)),
    shard,
  );
  const byId = new Map(targets.map((city) => [city.id, city]));

  const touched: string[] = [];
  for (const id of orderByStaleness(
    state,
    targets.map((city) => city.id),
  )) {
    if (outOfBudget(context)) break;
    if (!isDue(state, id, FRESHNESS.cities)) continue;

    const city = byId.get(id);
    const country = city?.countryId ? COUNTRY_BY_SLUG.get(city.countryId) : null;
    if (!city || !country) continue;

    const result = await crawlPlace(
      context,
      {
        key: id,
        name: city.name,
        query: locationQuery(city.name),
        country,
        cityId: id,
      },
      USERS_PER_CITY,
    );
    flagged.push(...result.flagged);
    context.processed += 1;

    // A city that has thinned out below the threshold is dropped from the
    // manifest by the rebuild below rather than left as a near-empty page.
    if (result.users.length < MIN_USERS_FOR_CITY) continue;

    await publishPlace(context, {
      scope: `city:${id}`,
      file: path.join("city", `${id}.json`),
      name: city.name,
      users: result.users,
      rankField: "city",
      depth: USERS_PER_CITY,
      profileDepth: PROFILE_CITY_DEPTH,
    });

    recordCompletion(state, id, context.date);
    touched.push(id);
    console.log(`  ${id.padEnd(28)} ${String(result.users.length).padStart(4)} users`);
  }

  await writeState(state, context.dataDir);
  return touched;
}

/**
 * Organisations are ranked by the aggregate contributions of the tracked
 * developers who list them, not by follower count — a different and, for this
 * site, more interesting metric, and the same one the seeder used, so the two
 * sources stay comparable. It needs no API calls at all: the `company` field is
 * already on every board we hold.
 */
async function runOrganizations(context: Context): Promise<Organization[]> {
  const boards = await readBoards(context.dataDir, "country");
  const totals = new Map<
    string,
    { login: string; total: number; followers: number; members: number; avatarUrl: string }
  >();
  const counted = new Set<string>();

  for (const board of boards) {
    for (const entry of board.entries) {
      if (counted.has(entry.login)) continue;
      counted.add(entry.login);

      const company = normaliseCompany(entry.company);
      if (!company) continue;

      const existing = totals.get(company.key);
      if (existing) {
        existing.total += entry.total;
        existing.followers += entry.followers;
        existing.members += 1;
      } else {
        totals.set(company.key, {
          login: company.display,
          total: entry.total,
          followers: entry.followers,
          members: 1,
          avatarUrl: entry.avatarUrl,
        });
      }
    }
  }

  const organizations: Organization[] = [...totals.values()]
    .filter((org) => org.members >= 3)
    .sort((a, b) => b.total - a.total || a.login.localeCompare(b.login))
    .slice(0, TOP_ORGANIZATIONS)
    .map((org, index) => ({
      rank: index + 1,
      login: org.login,
      name: `${org.members} tracked developer${org.members === 1 ? "" : "s"}`,
      avatarUrl: org.avatarUrl,
      location: null,
      followers: org.followers,
      publicRepos: org.total,
    }));

  await writeJson(path.join(context.dataDir, "org", "top.json"), organizations);
  return organizations;
}

/** Must stay in step with scripts/bootstrap-seed.ts, or the org list reshuffles
 *  the first time the crawler replaces the seed. */
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

async function runRepositories(context: Context): Promise<Repository[]> {
  const found = await context.api.searchRepositories("stars:>10000", { max: TOP_REPOSITORIES });
  context.processed += 1;

  const repositories: Repository[] = found
    .sort((a, b) => b.stars - a.stars || a.nameWithOwner.localeCompare(b.nameWithOwner))
    .slice(0, TOP_REPOSITORIES)
    .map((repo, index) => ({
      rank: index + 1,
      nameWithOwner: repo.nameWithOwner,
      description: repo.description,
      stars: repo.stars,
      forks: repo.forks,
      language: repo.language,
      ownerAvatarUrl: repo.ownerAvatarUrl,
    }));

  await writeJson(path.join(context.dataDir, "repo", "top.json"), repositories);
  return repositories;
}

// ---- Manifest -------------------------------------------------------------

function placeFrom(
  base: Omit<Place, "userCount" | "totalContributions" | "totalFollowers" | "top">,
  entries: LeaderboardEntry[],
): Place {
  return {
    ...base,
    userCount: entries.length,
    totalContributions: entries.reduce((sum, entry) => sum + entry.total, 0),
    totalFollowers: entries.reduce((sum, entry) => sum + entry.followers, 0),
    top: entries.slice(0, 3).map((entry) => ({
      login: entry.login,
      avatarUrl: entry.avatarUrl,
      total: entry.total,
    })),
  };
}

/**
 * The manifest is rebuilt from whatever is on disk rather than patched in
 * memory, so a sharded run that only touched a fifth of the countries still
 * leaves the other four fifths described correctly.
 */
async function rebuildManifest(context: Context): Promise<Manifest> {
  const previous = await readJsonFile<Manifest>(path.join(context.dataDir, "manifest.json"));
  const countryBoards = await readBoards(context.dataDir, "country");
  const cityBoards = await readBoards(context.dataDir, "city");

  const countries: Place[] = [];
  for (const board of countryBoards) {
    const slug = board.scope.replace(/^country:/, "");
    const country = COUNTRY_BY_SLUG.get(slug);
    if (!country) continue;
    countries.push(
      placeFrom(
        {
          id: country.slug,
          name: country.name,
          iso2: country.iso2,
          region: country.region,
          countryId: null,
        },
        board.entries,
      ),
    );
  }

  const cities: Place[] = [];
  for (const board of cityBoards) {
    const id = board.scope.replace(/^city:/, "");
    const countryId = board.entries[0]?.countryId ?? null;
    const country = countryId ? COUNTRY_BY_SLUG.get(countryId) : null;
    cities.push(
      placeFrom(
        {
          id,
          name: board.name,
          iso2: country?.iso2 ?? null,
          region: country?.region ?? null,
          countryId: countryId,
        },
        board.entries,
      ),
    );
  }

  // Distinct people, not distinct rows: someone on the worldwide board, their
  // country's and their city's is one developer.
  const worldwide = await readJsonFile<Leaderboard>(
    path.join(context.dataDir, "leaderboard", "worldwide.json"),
  );
  const people = new Map<string, LeaderboardEntry>();
  for (const board of [...countryBoards, ...cityBoards, ...(worldwide ? [worldwide] : [])]) {
    for (const entry of board.entries) people.set(entry.login, entry);
  }

  const flagged = (await readJsonFile<unknown[]>(path.join(context.dataDir, "flagged.json"))) ?? [];
  const organizations =
    (await readJsonFile<unknown[]>(path.join(context.dataDir, "org", "top.json"))) ?? [];
  const repositories =
    (await readJsonFile<unknown[]>(path.join(context.dataDir, "repo", "top.json"))) ?? [];

  const snapshotDates = [...new Set([...(previous?.snapshotDates ?? []), context.date])]
    .sort()
    .slice(-60);

  const manifest: Manifest = {
    generatedAt: context.date,
    source: "crawler",
    sourceNote:
      "Crawled from the GitHub REST search and GraphQL APIs. Search never returns past the " +
      "thousandth result per query, so each place is ranked from its top 1000 accounts by " +
      "followers; the limits are set out on /methodology.",
    counts: {
      users: people.size,
      countries: countries.length,
      cities: cities.length,
      organizations: organizations.length,
      repositories: repositories.length,
      flagged: flagged.length,
    },
    totals: {
      contributions: sumBy(people, (entry) => entry.total),
      publicContributions: sumBy(people, (entry) => entry.public),
      privateContributions: sumBy(people, (entry) => entry.private),
      followers: sumBy(people, (entry) => entry.followers),
    },
    snapshotDates,
    countries: countries.sort(
      (a, b) => b.totalContributions - a.totalContributions || a.id.localeCompare(b.id),
    ),
    cities: cities.sort(
      (a, b) => b.totalContributions - a.totalContributions || a.id.localeCompare(b.id),
    ),
  };

  await writeJson(path.join(context.dataDir, "manifest.json"), manifest);
  return manifest;
}

function sumBy(
  people: Map<string, LeaderboardEntry>,
  pick: (entry: LeaderboardEntry) => number,
): number {
  let total = 0;
  for (const entry of people.values()) total += pick(entry);
  return total;
}

/**
 * Excluded accounts, merged with the ones previous runs found. They are
 * published rather than deleted — a leaderboard that quietly drops accounts is
 * a leaderboard nobody can check.
 */
async function writeFlagged(context: Context, found: RankedUser[]): Promise<number> {
  interface FlaggedAccount {
    login: string;
    avatarUrl: string;
    total: number;
    followers: number;
    countryId: string | null;
  }

  const existing =
    (await readJsonFile<FlaggedAccount[]>(path.join(context.dataDir, "flagged.json"))) ?? [];
  const merged = new Map(existing.map((account) => [account.login, account]));

  for (const user of found) {
    merged.set(user.login, {
      login: user.login,
      avatarUrl: user.avatarUrl,
      total: user.contributions.total,
      followers: user.followers,
      countryId: user.countryId,
    });
  }

  const accounts = [...merged.values()]
    .sort((a, b) => b.total - a.total || a.login.localeCompare(b.login))
    .slice(0, 60);

  await writeJson(path.join(context.dataDir, "flagged.json"), accounts);
  return accounts.length;
}

// ---- Entry point ----------------------------------------------------------

async function openApi(options: Options): Promise<GitHubApi> {
  if (options.fixtures) return loadFixtureClient();
  return new GitHubClient({
    token: requireToken(),
    languages: true,
    log: (message) => console.warn(`  … ${message}`),
  });
}

export async function run(options: Options, dataDir: string = DATA_DIR): Promise<void> {
  const startedAt = Date.now();
  const context: Context = {
    api: await openApi(options),
    dataDir,
    date: new Date().toISOString().slice(0, 10),
    deadline: startedAt + BUDGET_MS,
    limit: options.limit,
    profiles: new Set((await readJsonFile<string[]>(path.join(dataDir, "user", "index.json"))) ?? []),
    processed: 0,
  };

  console.log(
    `Crawling tier ${options.tier}` +
      (options.shard ? ` shard ${options.shard.index}/${options.shard.total}` : "") +
      (options.fixtures ? " (fixtures)" : ""),
  );

  const flagged: RankedUser[] = [];

  switch (options.tier) {
    case "worldwide":
      await runWorldwide(context, flagged);
      break;
    case "countries":
      await runCountries(context, options.shard, flagged);
      break;
    case "cities":
      await runCities(context, options.shard, flagged);
      break;
    case "orgs":
      await runOrganizations(context);
      break;
    case "repos":
      await runRepositories(context);
      break;
  }

  await writeProfileIndex(context);
  const flaggedCount = await writeFlagged(context, flagged);
  const manifest = await rebuildManifest(context);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\n${manifest.counts.users} users · ${manifest.counts.countries} countries · ` +
      `${manifest.counts.cities} cities · ${context.profiles.size} profiles · ` +
      `${flaggedCount} flagged in ${seconds}s`,
  );
}

// Importing this module (the test does) must not start a crawl.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  // A bad flag and a missing token deserve the same one-line message; neither is
  // a bug worth a stack trace.
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  await run(parseOptions(process.argv.slice(2)));
}
