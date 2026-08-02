/**
 * Crawler entry point.
 *
 *   pnpm crawl --tier=verify                # one point: is the token accepted?
 *   pnpm crawl --tier=discover              # free: GH Archive, no API budget
 *   pnpm crawl --tier=hydrate               # the corpus, batched GraphQL
 *   pnpm crawl --tier=calendars             # the expensive field, profile depth
 *   pnpm crawl --tier=countries --shard=2/6 # supplementary name collection
 *   pnpm crawl:fixtures                     # offline, recorded responses
 *
 * The pipeline is discover -> filter -> hydrate -> derive. Discovery reads GH
 * Archive and costs nothing; hydration pays for the filtered head of it at 100
 * aliases a GraphQL query; every board — worldwide, country, city — is then
 * *derived* by grouping that one hydrated set, which is why none of them carry
 * the search API's 1,000-result ceiling any more.
 *
 * The search-based tiers survive for the one thing the event stream cannot do:
 * find developers whose work is almost entirely private. They contribute names
 * to a supplementary pool that the next hydration pays for, and publish no
 * board of their own.
 *
 * A run never crawls more than its budget allows. Where it stopped is recorded
 * in `data/_state.json`, and the next run resumes from there — see state.ts.
 */

import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeJson, DATA_DIR } from "../lib/io.ts";
import { COUNTRIES, COUNTRY_BY_SLUG } from "../lib/countries.ts";
import { parseCity } from "../lib/city.ts";
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
} from "./github.ts";
import { loadFixtureClient } from "./fixtures.ts";
import {
  assignRanks,
  shardOf,
  toLeaderboardEntry,
  toRankedUser,
  type RankField,
} from "./transform.ts";
import { previousRanks, readHistory, updateHistory } from "./history.ts";
import {
  isDue,
  orderByStaleness,
  pruneHours,
  readState,
  recordCompletion,
  recordHour,
  writeState,
} from "./state.ts";
import { discover, filterCandidates, recentHours } from "./gharchive.ts";
import { assertWithinBudget, estimateBudget, formatBudget } from "./budget.ts";
import { DeadLetter } from "./limiter.ts";

/**
 * Board depths.
 *
 * These were 500 / 150 / 75, sized for a search-driven pipeline where every
 * extra name cost a request against a 30-per-minute limit. Hydration now comes
 * from GH Archive discovery at roughly one GraphQL point per hundred logins, so
 * the binding constraint moved from rate limit to repository size: 250,000
 * developers is about 26 MB of committed index, which git handles; a million is
 * not, and would be rewritten on every crawl.
 *
 * Raising these is a data decision, not a tuning knob. See /methodology, which
 * states the depth publicly.
 */
const WORLDWIDE_SIZE = 250_000;

/**
 * Place boards are sized to what a page can render, not to what the crawl can
 * collect. `/countries/[id]` renders every entry it is given, so a 25,000-row
 * board is 25,000 rows of HTML on each of 88 statically-generated pages. The
 * worldwide board escapes this because it is the one route with an infinite
 * scroll and a jump-to-rank.
 *
 * The tail is not lost: every hydrated developer carries `countryId` and
 * `cityId` in the search index, so `/search?country=india` covers all of them.
 */
const USERS_PER_COUNTRY = 1_000;
const USERS_PER_CITY = 250;

/** How many discovered candidates a hydration pass will pay for. Keep it equal
 *  to WORLDWIDE_SIZE: hydrating names that cannot reach any board is budget
 *  spent on rows nobody will ever see. */
const HYDRATE_LIMIT = WORLDWIDE_SIZE;

/**
 * Profile pages, and therefore fetched calendars.
 *
 * The day-by-day calendar is the expensive selection (371 nodes per login), so
 * it is bought for the depth that has a page to show it on and estimated below
 * that. Every estimate is labelled wherever it appears.
 *
 * The binding constraint is **build time**, not budget: `/u/[login]` has
 * `generateStaticParams` over every profile, so this number is literally the
 * number of pages the site builds. 2,529 profiles is a couple of minutes;
 * 50,000 would not finish inside a Vercel build. Everyone below this depth is
 * still ranked, searchable and linked — out to github.com rather than to a page
 * we did not build.
 */
const PROFILE_DEPTH = 10_000;

/** Rows per board file once a board outgrows a single reviewable JSON file. */
const BOARD_SHARD_SIZE = 25_000;
const MIN_USERS_FOR_CITY = 8;
const TOP_REPOSITORIES = 120;
const TOP_ORGANIZATIONS = 120;

/**
 * `scripts/lib/countries.ts` is written largest developer population first, so
 * the head of the list is the set worth a daily pass. Everything after it moves
 * slowly enough for a weekly sweep, which is what the `--shard` legs cover.
 */
const DAILY_COUNTRIES = 40;

/** Re-crawl intervals, in days, per tier. */
const FRESHNESS: Record<Tier, number> = {
  // Discovery costs no API budget, so it can run as often as the archive
  // publishes. Its own hour cache is what stops it redoing work.
  verify: 0,
  discover: 0,
  hydrate: 1,
  calendars: 1,
  supplement: 7,
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

/** Seven days. Wide enough that anyone meaningfully active appears, and fetched
 *  hours are cached in state so incremental runs pull only what is new. */
const DEFAULT_ARCHIVE_HOURS = 168;
/** Tuned against three real hours of the archive: >=5 events kept ~11,000 of
 *  110,000 actors, which is the right order of magnitude for a hydration pass
 *  that has to fit inside 5,000 points an hour. */
const DEFAULT_MIN_EVENTS = 5;
/**
 * Hours retained in state purely as a record of what was scanned.
 *
 * It is deliberately NOT a skip-list. The window is *rolling*: hours fall out
 * of it as new ones arrive, and a merged actor total can be added to but never
 * subtracted from, so skipping already-seen hours would quietly turn a 7-day
 * window into an all-time one. It would also strand actors below the threshold
 * — someone with four events this window and four the next would be discarded
 * both times and never accumulate to eight.
 *
 * Rescanning is the correct answer because it is cheap: measured at roughly
 * 7 seconds per four hours, a full 7-day window is a few minutes and costs no
 * API budget at all.
 */
const ARCHIVE_HOURS_RETAINED = DEFAULT_ARCHIVE_HOURS * 2;

const TIERS = [
  "verify",
  "discover",
  "hydrate",
  "calendars",
  "supplement",
  "countries",
  "cities",
  "orgs",
  "repos",
] as const;
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
  /** Trailing GH Archive hours to fold into discovery. 168 is seven days. */
  hours: number;
  /** Minimum public authorship events for a login to be worth hydrating. */
  minEvents: number;
}

export function parseOptions(argv: string[]): Options {
  const options: Options = {
    fixtures: false,
    tier: "hydrate",
    shard: null,
    limit: null,
    hours: DEFAULT_ARCHIVE_HOURS,
    minEvents: DEFAULT_MIN_EVENTS,
  };

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
    } else if (flag === "--hours") {
      const hours = Number(raw);
      if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
        throw new Error("--hours must be between 1 and 720");
      }
      options.hours = hours;
    } else if (flag === "--min-events") {
      const min = Number(raw);
      if (!Number.isInteger(min) || min < 1) throw new Error("--min-events must be a positive integer");
      options.minEvents = min;
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
 * The supplementary search pass.
 *
 * GH Archive is a record of *public events*, so a developer who works almost
 * entirely in private repositories never appears in it no matter how much they
 * commit. Search is the only way to find those accounts, and `followers:` is
 * the one global ordering it offers.
 *
 * It deliberately does **not** publish a board any more. It used to, and that
 * was the bug: a search capped at 1,000 results per query cannot describe a
 * corpus of 250,000, so every run of it silently truncated the board hydration
 * had just derived. Now it only contributes *names* — written where the next
 * hydration will pick them up and pay for them properly, alongside everyone
 * discovery found.
 */
async function runSupplement(context: Context): Promise<void> {
  const found = await context.api.searchUsers("followers:>=1000 type:user", {
    max: SEARCH_RESULT_CAP,
  });
  context.processed += 1;

  const total = await mergeSupplementary(
    context,
    found.map((user) => ({
      login: user.login,
      avatarUrl: user.avatarUrl,
      // Not from the event stream, so there is no event count to report. Zero
      // is honest here; `alwaysKeep` is what carries these through the filter.
      events: 0,
      repos: 0,
      lastSeen: context.date,
    })),
  );

  console.log(
    `${found.length} logins from search · ${total} in the supplementary pool ` +
      `(hydration will fetch them)`,
  );
}

/**
 * Folds newly-found logins into the supplementary pool.
 *
 * A union across runs, not a replacement: search returns at most the first
 * 1,000 results for any query, so coverage is accumulated over weeks rather
 * than obtained in one pass. Sorted by login on write, like every other
 * artefact, so a run that finds nothing new produces no diff.
 */
async function mergeSupplementary(context: Context, found: Candidate[]): Promise<number> {
  const file = path.join(context.dataDir, "discovery", "supplementary.json");
  const previous = (await readJsonFile<{ logins: Candidate[] }>(file))?.logins ?? [];

  const merged = new Map(previous.map((candidate) => [candidate.login, candidate]));
  for (const candidate of found) merged.set(candidate.login, candidate);

  await writeJson(file, {
    generatedAt: context.date,
    note:
      "Logins found by search rather than GH Archive, covering developers whose work is mostly " +
      "private and who therefore emit no public events. Hydration merges these into its " +
      "candidate list and pays for them there.",
    logins: [...merged.values()].sort((a, b) => a.login.localeCompare(b.login)),
  });

  return merged.size;
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

/**
 * Location-scoped supplementary search.
 *
 * These used to *publish* the country and city boards. That stopped being
 * correct the moment hydration started deriving those boards by grouping the
 * hydrated corpus: a search is capped at 1,000 results per query, so a run of
 * this tier would replace a 25,000-row derived board with a 150-row one a few
 * minutes after it was written.
 *
 * What it is still uniquely good for is the gap GH Archive cannot cover —
 * developers whose work is almost entirely private, who therefore emit no
 * public events and appear in no archive hour. Search finds them by profile
 * location. So this collects *names* into the same supplementary pool as the
 * global follower query, and the next hydration pays for them properly.
 */
async function collectPlaceNames(
  context: Context,
  shard: Shard | null,
  kind: "countries" | "cities",
): Promise<string[]> {
  const state = await readState(context.dataDir);

  const targets: { key: string; name: string }[] =
    kind === "countries"
      ? countryTargets(shard).flatMap((slug) => {
          const country = COUNTRY_BY_SLUG.get(slug);
          return country ? [{ key: slug, name: country.name }] : [];
        })
      : selectShard(
          [
            ...((await readJsonFile<Manifest>(path.join(context.dataDir, "manifest.json")))
              ?.cities ?? []),
          ].sort((a, b) => a.id.localeCompare(b.id)),
          shard,
        ).map((city) => ({ key: city.id, name: city.name }));

  const found = new Map<string, Candidate>();
  const touched: string[] = [];

  for (const target of orderByStaleness(
    state,
    targets.map((t) => t.key),
  )) {
    if (outOfBudget(context)) break;
    if (!isDue(state, target, FRESHNESS[kind])) continue;

    const place = targets.find((t) => t.key === target);
    if (!place) continue;

    // Search only, no GraphQL: this pass buys names, and hydration buys the
    // data. Half the cost of the old shape for the half of it that was useful.
    const users = await context.api.searchUsers(locationQuery(place.name), {
      max: SEARCH_RESULT_CAP,
    });
    context.processed += 1;

    for (const user of users) {
      found.set(user.login, {
        login: user.login,
        avatarUrl: user.avatarUrl,
        events: 0,
        repos: 0,
        lastSeen: context.date,
      });
    }

    recordCompletion(state, target, context.date);
    touched.push(target);
    console.log(`  ${target.padEnd(28)} ${String(users.length).padStart(4)} logins`);
  }

  await writeState(state, context.dataDir);
  await mergeSupplementary(context, [...found.values()]);
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
      "Candidates discovered from GH Archive's record of public GitHub events, then hydrated " +
      "through batched GraphQL. Country and city boards are derived by grouping that one " +
      "hydrated set, so none of them carry the search API's thousand-result ceiling. Day-by-day " +
      "calendars are fetched for the top of the board and estimated below it; the limits are " +
      "set out on /methodology.",
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

// ---- Hydration ------------------------------------------------------------

/**
 * Append-only record of a hydration pass, so an interrupted run resumes.
 *
 * JSON Lines rather than a JSON array: a crash mid-write costs the last line
 * instead of the whole file, and appending does not require reading back what
 * is already there. It lives under `data/discovery/`, which is gitignored — it
 * is an intermediate, not a snapshot, and the boards derived from it are what
 * get committed.
 *
 * Keyed by snapshot date: a run on a new day starts a fresh journal rather than
 * resuming into yesterday's contribution window.
 */
class HydrationJournal {
  private readonly file: string;

  constructor(dataDir: string, date: string) {
    this.file = path.join(dataDir, "discovery", `hydrated-${date}.jsonl`);
  }

  /** Logins already recorded for this snapshot. */
  async open(): Promise<Set<string>> {
    const logins = new Set<string>();
    for (const user of await this.readAll()) logins.add(user.login);
    return logins;
  }

  async append(users: RankedUser[]): Promise<void> {
    if (users.length === 0) return;
    await mkdir(path.dirname(this.file), { recursive: true });
    await appendFile(this.file, users.map((user) => JSON.stringify(user)).join("\n") + "\n", "utf8");
  }

  async readAll(): Promise<RankedUser[]> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch {
      return [];
    }

    const users: RankedUser[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        users.push(JSON.parse(line) as RankedUser);
      } catch {
        // A truncated final line is the expected shape of an interrupted run,
        // not a corrupt file. Drop it and keep every complete record.
      }
    }
    return users;
  }
}

interface CandidateFile {
  generatedAt: string;
  window: { hours: number; from: string; to: string };
  minEvents: number;
  actorsSeen: number;
  candidates: Candidate[];
}

async function readCandidates(context: Context): Promise<CandidateFile> {
  const file = await readJsonFile<CandidateFile>(
    path.join(context.dataDir, "discovery", "candidates.json"),
  );
  if (!file?.candidates?.length) {
    throw new Error(
      "data/discovery/candidates.json is missing or empty. Run `pnpm crawl --tier=discover` " +
        "first — it costs no API budget and takes minutes. Hydration deliberately refuses to " +
        "fall back to REST search: that path is capped at 1,000 results per query and is what " +
        "held the corpus at a few thousand developers.",
    );
  }
  return file;
}

/**
 * Hydration — turn discovered logins into ranked developers.
 *
 * This is the step that decides how large the site is. Discovery already knows
 * about far more accounts than the API budget can describe, so the ordering it
 * produces (public authorship events in the window) is the filter, and only the
 * head of it is paid for. Everything here runs against §1's batched GraphQL:
 * 100 aliases a query, one point a query, results consumed per batch so an
 * interrupted run resumes instead of restarting.
 *
 * The calendar is deliberately *not* requested. See {@link EnrichOptions} — it
 * is the one field that makes a corpus-wide pass unaffordable, and the
 * `calendars` tier buys it back for the depth that has a page to show it on.
 */
async function runHydrate(context: Context, flagged: RankedUser[]): Promise<void> {
  const file = await readCandidates(context);

  // Everyone the supplementary search found, plus everyone already holding a
  // profile page. Both are carried through the filter regardless of their event
  // count: the first group has none by definition, and the second must not fall
  // off a board because they had a quiet week.
  const supplementary =
    (await readJsonFile<{ logins: Candidate[] }>(
      path.join(context.dataDir, "discovery", "supplementary.json"),
    ))?.logins ?? [];

  const alwaysKeep = new Set([
    ...context.profiles,
    ...supplementary.map((candidate) => candidate.login),
  ]);

  const pool = new Map<string, Candidate>();
  for (const candidate of [...file.candidates, ...supplementary]) {
    if (!pool.has(candidate.login)) pool.set(candidate.login, candidate);
  }

  const { candidates } = filterCandidates(
    [...pool.values()].map((candidate) => ({
      login: candidate.login,
      id: 0,
      avatarUrl: candidate.avatarUrl,
      events: candidate.events,
      lastSeen: candidate.lastSeen,
      repos: candidate.repos,
    })),
    { minEvents: 1, limit: context.limit ?? HYDRATE_LIMIT, alwaysKeep },
  );

  if (supplementary.length > 0) {
    console.log(
      `${file.candidates.length.toLocaleString()} from GH Archive + ` +
        `${supplementary.length.toLocaleString()} from supplementary search`,
    );
  }

  // §8: state the budget before spending any of it, and refuse a plan that
  // cannot finish rather than starting one that will not.
  const estimate = estimateBudget({ usersToHydrate: candidates.length, batchSize: 100 });
  console.log(`\n${formatBudget(estimate)}\n`);
  assertWithinBudget(estimate);

  const avatars = new Map(candidates.map((candidate) => [candidate.login, candidate.avatarUrl]));
  const window = contributionWindow(new Date(`${context.date}T00:00:00Z`));

  // §5: persist after every batch, not at the end. A half-hour pass over a
  // quarter of a million logins WILL be interrupted, and the previous shape —
  // accumulate everything, write once at the end — meant any interruption threw
  // away the whole run's budget. This also keeps the heap bounded.
  const journal = new HydrationJournal(context.dataDir, context.date);
  const done = await journal.open();
  if (done.size > 0) {
    console.log(`Resuming: ${done.size.toLocaleString()} logins already hydrated this snapshot`);
  }

  const remaining = candidates
    .map((candidate) => candidate.login)
    .filter((login) => !done.has(login));

  const skipped: string[] = [];
  let batches = 0;
  let ranked = done.size;

  await context.api.enrichUsers(remaining, window, {
    calendar: false,
    // The heavy sorted connection. Off here and on for the calendars pass —
    // leaving it on is what made this query unservable at any batch size.
    languages: false,
    onBatch: async ({ users: decoded, skipped: missing }) => {
      const batch: RankedUser[] = [];
      for (const user of decoded) {
        const record = toRankedUser(user, { avatarUrl: avatars.get(user.login) });
        if (record.contributions.total <= 0) continue;
        batch.push(record);
      }
      await journal.append(batch);
      ranked += batch.length;
      skipped.push(...missing);

      // One line per batch, as the standing rules require: this is the
      // smallest unit at which a run can be seen going wrong.
      if (++batches % 25 === 0 || decoded.length === 0) {
        console.log(
          `  batch ${String(batches).padStart(5)} · ${ranked.toLocaleString()} ranked · ` +
            `${skipped.length} unresolved`,
        );
      }
    },
  });

  // Read back what was written, including anything an earlier interrupted run
  // contributed. Flagged accounts are separated here rather than at write time
  // so a resumed run classifies the whole set by one rule.
  const all = await journal.readAll();
  const users = all.filter((user) => !user.flagged);
  flagged.push(...all.filter((user) => user.flagged));

  console.log(
    `\nHydrated ${users.length.toLocaleString()} developers ` +
      `(${flagged.length} flagged as automation, ${skipped.length} logins no longer resolve)`,
  );

  await publishHydrated(context, users);
}

/**
 * Derives every board from one hydrated set.
 *
 * Country and city boards used to each run their own location-qualified search,
 * which meant paying separately for people the worldwide pass had already
 * fetched, and inheriting the search API's 1,000-result ceiling per place.
 * Grouping one hydrated set on its parsed location costs nothing extra and has
 * no ceiling.
 */
async function publishHydrated(context: Context, users: RankedUser[]): Promise<void> {
  const worldwide = assignRanks(users, "worldwide").slice(0, WORLDWIDE_SIZE);

  // Registered now, written at the very end.
  //
  // `assignRanks` mutates `rank.country` and `rank.city` on these same objects
  // as the place boards are derived below, so serialising a profile before that
  // happens stores a record whose country and city ranks are permanently null.
  // The set has to be populated up front regardless, because `publishPlace`
  // reads it to decide whether a row links to a profile page or out to GitHub.
  const profiled = worldwide.slice(0, PROFILE_DEPTH);
  for (const user of profiled) context.profiles.add(user.login);

  const previous = previousRanks(await readHistory("worldwide", context.dataDir));
  const entries = worldwide.map((user, index) =>
    toLeaderboardEntry(user, index + 1, {
      previousRank: previous.get(user.login) ?? null,
      hasProfile: context.profiles.has(user.login),
    }),
  );

  await writeBoard(context, path.join("leaderboard", "worldwide.json"), {
    scope: "worldwide",
    name: "Worldwide",
    generatedAt: context.date,
    entries,
  });

  await updateHistory({
    file: "worldwide",
    scope: "worldwide",
    date: context.date,
    // History is the bump chart's input and only ever plots the visible head;
    // recording a quarter of a million tuples a day would dwarf the snapshot it
    // describes.
    points: entries.slice(0, 500).map((entry) => ({
      login: entry.login,
      rank: entry.rank,
      total: entry.total,
    })),
    dataDir: context.dataDir,
  });

  const byCountry = new Map<string, RankedUser[]>();
  const byCity = new Map<string, { name: string; users: RankedUser[] }>();

  for (const user of worldwide) {
    if (user.countryId) {
      const bucket = byCountry.get(user.countryId) ?? [];
      bucket.push(user);
      byCountry.set(user.countryId, bucket);
    }
    if (user.cityId) {
      const country = user.countryId ? COUNTRY_BY_SLUG.get(user.countryId) : null;
      const parsed = country ? parseCity(user.location, country) : null;
      const bucket = byCity.get(user.cityId) ?? { name: parsed?.name ?? user.cityId, users: [] };
      bucket.users.push(user);
      byCity.set(user.cityId, bucket);
    }
  }

  for (const [slug, bucket] of [...byCountry].sort((a, b) => a[0].localeCompare(b[0]))) {
    const country = COUNTRY_BY_SLUG.get(slug);
    if (!country) continue;
    await publishPlace(context, {
      scope: `country:${slug}`,
      file: path.join("country", `${slug}.json`),
      name: country.name,
      users: bucket,
      rankField: "country",
      depth: USERS_PER_COUNTRY,
      profileDepth: 0,
      history: `country-${slug}`,
    });
  }

  let cities = 0;
  for (const [id, bucket] of [...byCity].sort((a, b) => a[0].localeCompare(b[0]))) {
    // A city nobody much lives in is a near-empty page, not a finding. The same
    // threshold the seeder uses, so the two sources stay comparable.
    if (bucket.users.length < MIN_USERS_FOR_CITY) continue;
    await publishPlace(context, {
      scope: `city:${id}`,
      file: path.join("city", `${id}.json`),
      name: bucket.name,
      users: bucket.users,
      rankField: "city",
      depth: USERS_PER_CITY,
      profileDepth: 0,
    });
    cities++;
  }

  // Now that every board has stamped its rank onto these objects.
  await writeProfiles(context, profiled);

  console.log(
    `Derived ${byCountry.size} country boards and ${cities} city boards from the hydrated set`,
  );
}

/**
 * The second pass: buy the day-by-day calendar for the developers who have a
 * profile page.
 *
 * Split from hydration because the cost profile is completely different — 371
 * nodes per login rather than a handful of scalars — so it gets its own job,
 * its own budget line and its own measured cost. Everyone below this depth
 * keeps the site's deterministic estimate, labelled as an estimate.
 */
async function runCalendars(context: Context): Promise<void> {
  const board = await readJsonFile<Leaderboard>(
    path.join(context.dataDir, "leaderboard", "worldwide.json"),
  );
  if (!board?.entries.length) {
    throw new Error(
      "data/leaderboard/worldwide.json is missing or empty. Run `pnpm crawl --tier=hydrate` first.",
    );
  }

  const logins = board.entries.slice(0, context.limit ?? PROFILE_DEPTH).map((entry) => entry.login);

  // The calendar selection is heavier than the scalar one, so its cost is
  // assumed high here and the run reports what it actually measured. If the
  // measurement lands above this, narrow the depth rather than running longer.
  const estimate = estimateBudget({
    usersToHydrate: logins.length,
    batchSize: 25,
    observedCostPerQuery: 5,
  });
  console.log(`\n${formatBudget(estimate)}\n`);
  assertWithinBudget(estimate);

  const window = contributionWindow(new Date(`${context.date}T00:00:00Z`));
  const avatars = new Map(board.entries.map((entry) => [entry.login, entry.avatarUrl]));
  let written = 0;

  await context.api.enrichUsers(logins, window, {
    calendar: true,
    // The one pass that needs it: these are the logins with a profile page, and
    // the page renders a language donut.
    languages: true,
    onBatch: async ({ users }) => {
      for (const user of users) {
        const ranked = toRankedUser(user, { avatarUrl: avatars.get(user.login) });
        if (!ranked.calendar) continue;
        await writeProfiles(context, [ranked]);
        written++;
      }
      if (written % 2_500 === 0 && written > 0) {
        console.log(`  ${written.toLocaleString()} calendars fetched`);
      }
    },
  });

  console.log(`\nFetched ${written.toLocaleString()} measured calendars`);
}

/**
 * Writes a board, splitting it across numbered files once it outgrows one.
 *
 * A single 250,000-row JSON file is not something anybody can review in a pull
 * request, and it is the file a bad crawl would silently replace. Shards keep
 * the diff legible; the head shard keeps the canonical name so every existing
 * reader still finds it.
 */
async function writeBoard(context: Context, file: string, board: Leaderboard): Promise<void> {
  await writeJson(path.join(context.dataDir, file), {
    ...board,
    entries: board.entries.slice(0, BOARD_SHARD_SIZE),
  } satisfies Leaderboard);

  for (let start = BOARD_SHARD_SIZE, part = 2; start < board.entries.length; start += BOARD_SHARD_SIZE, part++) {
    await writeJson(path.join(context.dataDir, file.replace(/\.json$/, `.${part}.json`)), {
      ...board,
      entries: board.entries.slice(start, start + BOARD_SHARD_SIZE),
    } satisfies Leaderboard);
  }
}

// ---- Entry point ----------------------------------------------------------

/** Tiers that never touch the GitHub API, and so must never demand a token. */
const TOKENLESS_TIERS = new Set<Tier>(["discover", "verify"]);

/** Exported so the test asserts the same predicate `openApi` branches on,
 *  rather than a copy of it that can drift. */
export function needsToken(tier: Tier): boolean {
  return !TOKENLESS_TIERS.has(tier);
}

/**
 * Refuses every call rather than holding a half-configured client.
 *
 * Discovery reads GH Archive — public object storage — so requiring a token for
 * it would make the *free* half of the pipeline depend on the credential the
 * paid half needs. The workflow already says as much: the discover job is
 * deliberately not gated on the token check, because knowing the candidate set
 * is most useful precisely when the secret is missing.
 *
 * A stub that throws is better than `null` here: if a tier is ever added to
 * TOKENLESS_TIERS by mistake and does call the API, this says so by name
 * instead of failing as an unexplained TypeError.
 */
function tokenlessApi(tier: Tier): GitHubApi {
  const refuse = (): never => {
    throw new Error(
      `Tier "${tier}" is registered as tokenless but tried to call the GitHub API. ` +
        "Either it does need a token — remove it from TOKENLESS_TIERS — or the call is a bug.",
    );
  };
  return { searchUsers: refuse, searchRepositories: refuse, enrichUsers: refuse };
}

async function openApi(options: Options, dataDir: string): Promise<GitHubApi> {
  if (options.fixtures) return loadFixtureClient();
  if (TOKENLESS_TIERS.has(options.tier)) return tokenlessApi(options.tier);
  return new GitHubClient({
    token: requireToken(),
    // Off by default, and turned on per call by the one pass that needs it.
    // It used to be on for every tier, which is what made the corpus-wide
    // hydration query heavy enough for GitHub to answer with a gateway 502 at
    // every batch size from 100 down to 25. See EnrichOptions.languages.
    languages: false,
    deadLetter: new DeadLetter({ dataDir }),
    log: (message) => console.warn(`  … ${message}`),
  });
}

export async function run(options: Options, dataDir: string = DATA_DIR): Promise<void> {
  const startedAt = Date.now();
  const context: Context = {
    api: await openApi(options, dataDir),
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
    // A one-point preflight, so a rejected credential fails at the top of the
    // job rather than after 3.5 GB of archive download and a printed budget.
    case "verify": {
      const client = new GitHubClient({
        token: requireToken(),
        languages: false,
        log: (m) => console.log(`  … ${m}`),
      });
      await client.verifyToken();

      // Then the query hydration actually sends, for exactly one user. If this
      // fails while the viewer check passed, the problem is the enrichment
      // query or the account — not the batch size, and not the token.
      const probe = await client.probeEnrichment(
        "torvalds",
        contributionWindow(new Date(`${context.date}T00:00:00Z`)),
      );
      console.log(
        `  … single-alias enrichment: ${probe.ok ? "OK" : "FAILED"} · ` +
          `cost ${probe.cost ?? "?"} · contributions ${probe.total ?? "?"} · ${probe.detail}`,
      );
      if (!probe.ok) {
        throw new Error(
          "The token is accepted but a ONE-user enrichment query still failed. That rules out " +
            "batch size, query weight and credentials. Remaining causes are account-level " +
            "secondary limiting or a GitHub-side problem with contributionsCollection — " +
            "neither is fixed by re-running.",
        );
      }
      return;
    }
    case "discover":
      await runDiscovery(context, options);
      return;
    case "hydrate":
      await runHydrate(context, flagged);
      break;
    case "calendars":
      await runCalendars(context);
      break;
    case "supplement":
      await runSupplement(context);
      break;
    // Both now collect names for the next hydration rather than publishing a
    // board of their own — see collectPlaceNames.
    case "countries":
      await collectPlaceNames(context, options.shard, "countries");
      break;
    case "cities":
      await collectPlaceNames(context, options.shard, "cities");
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

export interface Candidate {
  login: string;
  avatarUrl: string;
  events: number;
  repos: number;
  lastSeen: string;
}

/**
 * Discovery — the free half of the pipeline.
 *
 * Spends no API budget at all: GH Archive is public object storage. This is
 * what makes a full refresh timely, because the alternative (REST user search
 * at 30 requests a minute, capped at 1,000 results per query) costs thousands
 * of requests and hours of wall clock before a single profile is hydrated.
 *
 * Writes a ranked candidate list for the hydration tiers to consume, and prints
 * the budget that hydrating it would cost so an oversized set is caught here
 * rather than halfway through an Actions run.
 */
async function runDiscovery(context: Context, options: Options): Promise<void> {
  const state = await readState(context.dataDir);
  const wanted = recentHours(options.hours, new Date());

  console.log(`GH Archive: scanning ${wanted.length} hours (${wanted[wanted.length - 1]} → ${wanted[0]})`);

  let done = 0;
  const result = await discover(wanted, {
    concurrency: 4,
    onHour: (hour) => {
      done++;
      if (hour.status === "ok") recordHour(state, hour.hour, hour.events);
      // One line per hour: the standing rules require per-batch logging, and an
      // hour is the batch.
      console.log(
        `  [${String(done).padStart(3)}/${wanted.length}] ${hour.hour} ${hour.status.padEnd(7)} ` +
          `events=${String(hour.events).padStart(7)} ${(hour.bytes / 1e6).toFixed(1)}MB ` +
          `${(hour.elapsedMs / 1000).toFixed(1)}s${hour.error ? ` — ${hour.error}` : ""}`,
      );
    },
  });

  const missing = result.hours.filter((h) => h.status !== "ok");
  console.log(
    `\n${result.totalEvents.toLocaleString()} authorship events · ` +
      `${result.actors.length.toLocaleString()} distinct actors · ` +
      `${(result.totalBytes / 1e6).toFixed(0)}MB · ` +
      `${(result.elapsedMs / 1000).toFixed(1)}s · 0 API points spent` +
      (missing.length ? ` · ${missing.length} hours unavailable` : ""),
  );

  const { candidates, droppedBots, droppedLoops } = filterCandidates(result.actors, {
    minEvents: options.minEvents,
    limit: context.limit ?? undefined,
    // Anyone already on a board survives regardless of a quiet week, or the
    // leaderboard would churn on nothing.
    alwaysKeep: context.profiles,
  });

  console.log(
    `${candidates.length.toLocaleString()} candidates at >=${options.minEvents} events ` +
      `(dropped ${droppedBots} bots, ${droppedLoops} single-repo loops)`,
  );

  // §8: state the budget before any hydration is attempted.
  const estimate = estimateBudget({ usersToHydrate: candidates.length, batchSize: 100 });
  console.log(`\n${formatBudget(estimate)}`);
  assertWithinBudget(estimate);

  await writeJson(path.join(context.dataDir, "discovery", "candidates.json"), {
    generatedAt: context.date,
    window: { hours: options.hours, from: wanted[wanted.length - 1], to: wanted[0] },
    minEvents: options.minEvents,
    actorsSeen: result.actors.length,
    hoursScanned: result.hours.filter((h) => h.status === "ok").length,
    hoursUnavailable: missing.map((h) => h.hour),
    candidates: candidates.map(
      (a): Candidate => ({
        login: a.login,
        avatarUrl: a.avatarUrl,
        events: a.events,
        repos: a.repos,
        lastSeen: a.lastSeen,
      }),
    ),
  });

  pruneHours(state, ARCHIVE_HOURS_RETAINED);
  await writeState(state, context.dataDir);
}

async function main(): Promise<void> {
  await run(parseOptions(process.argv.slice(2)));
}
