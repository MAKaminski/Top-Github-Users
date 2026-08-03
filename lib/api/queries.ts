import {
  getCityBoard,
  getCountryBoard,
  getFlaggedAccounts,
  getHistory,
  getManifest,
  getOrganizations,
  getRepositories,
  getUser,
  getWorldwide,
} from "@/lib/data";
import { calendarFor, monthlyFrom, streaksFrom } from "@/lib/calendar";
import {
  isSort,
  loadIndexOrder,
  loadIndexTable,
  type IndexTable,
  type SearchRow,
  type Sort,
} from "@/lib/api/search-index";
import type {
  HistorySeries,
  Leaderboard,
  LeaderboardEntry,
  Manifest,
  Organization,
  Place,
  RankedUser,
  Repository,
} from "@/lib/types";

/**
 * The one query layer.
 *
 * Both the MCP server (lib/mcp) and the REST mirror (app/api/v1) call these and
 * nothing else, so the two surfaces cannot drift apart. Everything here is a
 * thin composition over lib/data.ts and lib/calendar.ts — no new data logic and
 * no network.
 */

/** Raised from 200 for the infinite-scrolling leaderboard: at 200 a reader
 *  scrolling to rank 100,000 costs 500 round trips. */
export const MAX_PAGE = 500;
export const DEFAULT_PAGE = 50;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function paginate<T>(items: T[], limit = DEFAULT_PAGE, offset = 0): Page<T> {
  const size = Math.min(Math.max(1, limit), MAX_PAGE);
  const start = Math.max(0, offset);
  return {
    items: items.slice(start, start + size),
    total: items.length,
    limit: size,
    offset: start,
    hasMore: start + size < items.length,
  };
}

/* ------------------------------------------------------------------ scopes */

export type Scope =
  | { kind: "worldwide" }
  | { kind: "country"; id: string }
  | { kind: "city"; id: string };

/** Parses `worldwide`, `country:japan`, `city:jp-tokyo`. Bare ids are rejected
 *  rather than guessed at — `japan` and `jp-tokyo` are different namespaces and
 *  silently picking one would make the API lie about what it looked up. */
export function parseScope(scope: string): Scope | { error: string } {
  const value = scope.trim().toLowerCase();
  if (value === "worldwide") return { kind: "worldwide" };

  const [prefix, ...rest] = value.split(":");
  const id = rest.join(":");
  if (prefix === "country" && id) return { kind: "country", id };
  if (prefix === "city" && id) return { kind: "city", id };

  return {
    error:
      `Unrecognised scope "${scope}". Use "worldwide", "country:{id}" or "city:{id}" — ` +
      `call commitgraph_list_places for valid ids.`,
  };
}

/** Turns an index row into a leaderboard row at a given position. */
function entryFromIndex(table: IndexTable, index: number, rank: number, movement: boolean) {
  const row = table.rowAt(index);
  return {
    rank,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatarUrl,
    location: row.location,
    company: row.company,
    followers: row.followers,
    total: row.total,
    public: row.public,
    private: row.private,
    countryId: row.countryId,
    cityId: row.cityId,
    // Movement compares this snapshot's rank with the last one's. That is only
    // meaningful inside the ordering the history was recorded in, so a board
    // sorted by followers or streak shows no arrows rather than comparing a
    // followers position against a contributions position.
    previousRank: movement ? row.previousRank : null,
    hasProfile: row.hasProfile,
    streak: row.streak,
    calendarMeasured: row.calendarMeasured,
  } satisfies LeaderboardEntry;
}

/**
 * A page of a leaderboard, in any of the three orderings.
 *
 * The worldwide board is served from the search index rather than from
 * `data/leaderboard/worldwide.json`, because the index is the only artefact
 * that holds the *whole* corpus: the board file is a ranked head, and reading
 * page 400 out of it would return nothing. Country and city scopes are small
 * enough to sort in place, and are enriched from the index so every scope
 * carries a streak.
 */
export async function getLeaderboard(
  scope: string,
  limit = DEFAULT_PAGE,
  offset = 0,
  sort: Sort = "contributions",
): Promise<
  { board: Leaderboard; page: Page<LeaderboardEntry>; sort: Sort } | { error: string }
> {
  const parsed = parseScope(scope);
  if ("error" in parsed) return parsed;

  const movement = sort === "contributions";

  if (parsed.kind === "worldwide") {
    const [table, order, stored] = await Promise.all([
      loadIndexTable(),
      loadIndexOrder(),
      getWorldwide(),
    ]);

    const ranking = order[sort];
    const size = Math.min(Math.max(1, limit), MAX_PAGE);
    const start = Math.max(0, Math.min(offset, ranking.length));
    const slice = ranking.slice(start, start + size);

    return {
      // `entries` deliberately carries only the requested page: materialising a
      // quarter of a million rows to describe one of them is the exact cost
      // this index exists to avoid. `page.total` is the honest corpus size.
      board: {
        scope: "worldwide",
        name: "Worldwide",
        generatedAt: stored.generatedAt,
        entries: [],
      },
      page: {
        items: slice.map((rowIndex, i) => entryFromIndex(table, rowIndex, start + i + 1, movement)),
        total: ranking.length,
        limit: size,
        offset: start,
        hasMore: start + size < ranking.length,
      },
      sort,
    };
  }

  const board =
    parsed.kind === "country" ? await getCountryBoard(parsed.id) : await getCityBoard(parsed.id);

  if (!board) {
    return {
      error: `No leaderboard for scope "${scope}". Call commitgraph_list_places for valid ids.`,
    };
  }

  const table = await loadIndexTable();
  const enriched = board.entries.map((entry) => {
    const index = table.indexOf(entry.login);
    if (index < 0) return { ...entry, streak: null, calendarMeasured: null };
    const row = table.rowAt(index);
    return { ...entry, streak: row.streak, calendarMeasured: row.calendarMeasured };
  });

  const ordered =
    sort === "contributions"
      ? enriched
      : [...enriched].sort((a, b) =>
          sort === "followers"
            ? b.followers - a.followers || a.login.localeCompare(b.login)
            : (b.streak?.longest ?? 0) - (a.streak?.longest ?? 0) ||
              (b.streak?.current ?? 0) - (a.streak?.current ?? 0) ||
              a.login.localeCompare(b.login),
        );

  const ranked = ordered.map((entry, i) => ({
    ...entry,
    rank: movement ? entry.rank : i + 1,
    previousRank: movement ? entry.previousRank : null,
  }));

  return { board, page: paginate(ranked, limit, offset), sort };
}

export { isSort, type Sort };

/* ------------------------------------------------------------------ places */

export interface PlaceFilters {
  kind?: "country" | "city" | "all";
  region?: string;
  countryId?: string;
  query?: string;
}

export async function listPlaces(
  filters: PlaceFilters = {},
  limit = DEFAULT_PAGE,
  offset = 0,
): Promise<Page<Place & { kind: "country" | "city" }>> {
  const manifest = await getManifest();
  const kind = filters.kind ?? "all";

  const tagged: (Place & { kind: "country" | "city" })[] = [
    ...(kind !== "city" ? manifest.countries.map((p) => ({ ...p, kind: "country" as const })) : []),
    ...(kind !== "country" ? manifest.cities.map((p) => ({ ...p, kind: "city" as const })) : []),
  ];

  const needle = filters.query?.trim().toLowerCase();
  const filtered = tagged.filter((place) => {
    if (filters.region && place.region !== filters.region) return false;
    if (filters.countryId && place.countryId !== filters.countryId) return false;
    if (needle && !`${place.name} ${place.id}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  filtered.sort((a, b) => b.totalContributions - a.totalContributions || a.id.localeCompare(b.id));
  return paginate(filtered, limit, offset);
}

export async function getPlaceDetail(
  id: string,
): Promise<{ place: Place & { kind: "country" | "city" }; board: Leaderboard | null } | null> {
  const manifest = await getManifest();

  const country = manifest.countries.find((p) => p.id === id);
  if (country) {
    return { place: { ...country, kind: "country" }, board: await getCountryBoard(id) };
  }

  const city = manifest.cities.find((p) => p.id === id);
  if (city) return { place: { ...city, kind: "city" }, board: await getCityBoard(id) };

  return null;
}

/* -------------------------------------------------------------- developers */

export interface DeveloperFilters {
  query?: string;
  countryId?: string;
  cityId?: string;
  company?: string;
  minContributions?: number;
  maxContributions?: number;
  minFollowers?: number;
  hasProfile?: boolean;
  sort?: "contributions" | "followers" | "streak" | "rank" | "login";
}

/**
 * Free-text and filtered search across the whole corpus.
 *
 * Matching runs over the index's raw columns and only the returned page is
 * decoded into objects. At 6,000 developers the difference is invisible; at
 * 250,000 it is the difference between a search and an out-of-memory error.
 */
export async function searchDevelopers(
  filters: DeveloperFilters = {},
  limit = DEFAULT_PAGE,
  offset = 0,
): Promise<Page<SearchRow>> {
  const table = await loadIndexTable();
  const needle = filters.query?.trim().toLowerCase();
  const company = filters.company?.trim().toLowerCase();

  const matched: number[] = [];
  for (let i = 0; i < table.count; i++) {
    if (filters.countryId && table.countryAt(i) !== filters.countryId) continue;
    if (filters.cityId && table.cityAt(i) !== filters.cityId) continue;
    if (filters.hasProfile !== undefined && table.hasProfileAt(i) !== filters.hasProfile) continue;

    const total = table.totalAt(i);
    if (filters.minContributions !== undefined && total < filters.minContributions) continue;
    if (filters.maxContributions !== undefined && total > filters.maxContributions) continue;
    if (filters.minFollowers !== undefined && table.followersAt(i) < filters.minFollowers) continue;
    if (company && !table.companyAt(i).toLowerCase().includes(company)) continue;

    if (needle) {
      const haystack =
        `${table.loginAt(i)} ${table.nameAt(i)} ${table.companyAt(i)} ${table.locationAt(i)}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }

    matched.push(i);
  }

  const sort = filters.sort ?? "contributions";
  const login = (i: number) => table.loginAt(i);
  matched.sort((a, b) => {
    if (sort === "followers") {
      return table.followersAt(b) - table.followersAt(a) || login(a).localeCompare(login(b));
    }
    if (sort === "streak") {
      return table.streakLongestAt(b) - table.streakLongestAt(a) || login(a).localeCompare(login(b));
    }
    if (sort === "login") return login(a).localeCompare(login(b));
    if (sort === "rank") {
      return (
        (table.worldwideRankAt(a) ?? Infinity) - (table.worldwideRankAt(b) ?? Infinity) ||
        login(a).localeCompare(login(b))
      );
    }
    return (
      table.totalAt(b) - table.totalAt(a) ||
      table.followersAt(b) - table.followersAt(a) ||
      login(a).localeCompare(login(b))
    );
  });

  const page = paginate(matched, limit, offset);
  return { ...page, items: page.items.map((index) => table.rowAt(index)) };
}

/**
 * A developer's full record.
 *
 * The snapshot ranks far more developers than it stores profile pages for, so a
 * miss here is usually *coverage*, not a bad login. Saying so explicitly — and
 * still returning the leaderboard row we do hold — is the difference between a
 * useful answer and one that reads as "no such user".
 */
export type DeveloperResult =
  | { found: true; user: RankedUser; calendar: ResolvedCalendar; indexRow: SearchRow | null }
  | { found: false; reason: "no-profile"; indexRow: SearchRow; note: string }
  | { found: false; reason: "unknown"; note: string };

export interface ResolvedCalendar {
  days: number[];
  estimated: boolean;
  monthly: number[];
  streak: { current: number; longest: number };
  busiestDay: number;
  activeDays: number;
}

export function resolveCalendar(
  login: string,
  total: number,
  stored: number[] | null,
): ResolvedCalendar {
  const { days, estimated } = calendarFor(login, total, stored);
  return {
    days,
    estimated,
    monthly: monthlyFrom(days),
    streak: streaksFrom(days),
    busiestDay: days.reduce((max, day) => (day > max ? day : max), 0),
    activeDays: days.filter((day) => day > 0).length,
  };
}

export async function getDeveloper(login: string): Promise<DeveloperResult> {
  const table = await loadIndexTable();
  const index = table.indexOf(login);
  const indexRow = index >= 0 ? table.rowAt(index) : null;

  const user = await getUser(indexRow?.login ?? login.replace(/^@/, ""));
  if (user) {
    return {
      found: true,
      user,
      calendar: resolveCalendar(user.login, user.contributions.total, user.calendar),
      indexRow,
    };
  }

  if (indexRow) {
    return {
      found: false,
      reason: "no-profile",
      indexRow,
      note:
        `${indexRow.login} is ranked in this snapshot but has no stored profile record. ` +
        `Profile records are generated for the worldwide top 500 and each place's leaders; ` +
        `everyone else is present as a leaderboard row only. The row is returned above.`,
    };
  }

  return {
    found: false,
    reason: "unknown",
    note:
      `No developer named "${login}" in this snapshot. The snapshot covers a ranked subset of ` +
      `GitHub, not every account — absence here does not mean the account does not exist.`,
  };
}

export async function compareDevelopers(logins: string[]): Promise<DeveloperResult[]> {
  return Promise.all(logins.map((login) => getDeveloper(login)));
}

/* -------------------------------------------------------------- aggregates */

export async function getStatistics() {
  const [manifest, worldwide] = await Promise.all([getManifest(), getWorldwide()]);
  const entries = worldwide.entries;

  const totalPublic = entries.reduce((sum, e) => sum + e.public, 0);
  const totalPrivate = entries.reduce((sum, e) => sum + e.private, 0);

  // Pearson correlation on log10 of both axes — the raw values span five orders
  // of magnitude, so an untransformed r would just describe the outliers.
  const pairs = entries.filter((e) => e.followers > 0 && e.total > 0);
  const xs = pairs.map((e) => Math.log10(e.followers));
  const ys = pairs.map((e) => Math.log10(e.total));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const correlation = dx && dy ? num / Math.sqrt(dx * dy) : 0;

  const byRegion = new Map<string, { countries: number; users: number; contributions: number }>();
  for (const place of manifest.countries) {
    const region = place.region ?? "Unknown";
    const bucket = byRegion.get(region) ?? { countries: 0, users: 0, contributions: 0 };
    bucket.countries += 1;
    bucket.users += place.userCount;
    bucket.contributions += place.totalContributions;
    byRegion.set(region, bucket);
  }

  const sorted = [...entries].map((e) => e.total).sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

  return {
    snapshot: manifest.generatedAt,
    source: manifest.source,
    counts: manifest.counts,
    totals: manifest.totals,
    worldwideSample: entries.length,
    publicPrivateSplit: {
      public: totalPublic,
      private: totalPrivate,
      publicShare: totalPublic + totalPrivate > 0 ? totalPublic / (totalPublic + totalPrivate) : 0,
    },
    followersVsContributions: {
      correlationLogLog: Number(correlation.toFixed(4)),
      sample: pairs.length,
      note:
        "Pearson r on log10 of both axes. A low value is the finding, not a defect: " +
        "reputation and output are close to independent on GitHub.",
    },
    contributionPercentiles: {
      p10: percentile(0.1),
      p25: percentile(0.25),
      p50: percentile(0.5),
      p75: percentile(0.75),
      p90: percentile(0.9),
      p99: percentile(0.99),
    },
    byRegion: [...byRegion.entries()]
      .map(([region, value]) => ({ region, ...value }))
      .sort((a, b) => b.contributions - a.contributions),
  };
}

export async function getRankHistory(scope = "worldwide"): Promise<{
  history: HistorySeries | null;
  plottable: boolean;
  note: string;
}> {
  const history = await getHistory(scope);
  const dates = history?.dates.length ?? 0;
  return {
    history,
    plottable: dates >= 2,
    note:
      dates >= 2
        ? `${dates} snapshots recorded for scope "${scope}".`
        : dates === 1
          ? "One snapshot recorded. Movement needs a second scheduled crawl — this series stays " +
            "empty rather than inventing a trend."
          : `No history recorded for scope "${scope}".`,
  };
}

export {
  getManifest,
  getOrganizations,
  getRepositories,
  getFlaggedAccounts,
  type Manifest,
  type Organization,
  type Repository,
};
